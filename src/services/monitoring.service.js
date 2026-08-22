import os from 'node:os';
import fs from 'node:fs/promises';
import env from '../config/env.js';
import prisma from '../lib/prisma.js';
import { HttpError } from '../utils/errors.js';
import { runFixedProcess } from '../utils/runFixedProcess.js';
import { collectNetworkVisibility } from './monitoring.network.js';

/** Fixed server-side names — never taken from the HTTP request. */
const PM2_APP_NAME = 'unsend-backend';
const NGINX_UNIT = 'nginx';
const MYSQL_UNIT = 'mysql';

const BACKEND_HEALTH_TIMEOUT_MS = 2000;
const SYSTEMD_TIMEOUT_MS = 2000;
const PM2_TIMEOUT_MS = 3000;
const PRISMA_TIMEOUT_MS = 2000;

/**
 * Previous CPU time counters from os.cpus().
 * os.cpus() exposes cumulative times since boot, not instantaneous usage.
 * Utilization requires comparing two snapshots (delta idle / delta total).
 * First request after process start has no prior sample → cpuUsagePercent null.
 */
let previousCpuSnapshot = null;

function roundOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function readCpuSnapshot() {
  let idle = 0;
  let total = 0;

  for (const cpu of os.cpus()) {
    const { user, nice, sys, idle: idleTime, irq } = cpu.times;
    idle += idleTime;
    total += user + nice + sys + idleTime + irq;
  }

  return { idle, total };
}

/**
 * CPU % from counter deltas between this call and the previous call.
 * Does not sleep; first call stores a baseline and returns null.
 */
function getCpuUsagePercent() {
  const current = readCpuSnapshot();

  let cpuUsagePercent = null;

  if (previousCpuSnapshot !== null) {
    const totalDelta = current.total - previousCpuSnapshot.total;
    const idleDelta = current.idle - previousCpuSnapshot.idle;

    if (totalDelta > 0) {
      cpuUsagePercent = roundOneDecimal(
        ((totalDelta - idleDelta) / totalDelta) * 100,
      );
    }
  }

  previousCpuSnapshot = current;
  return cpuUsagePercent;
}

/**
 * Parse MemTotal / MemAvailable from /proc/meminfo (values are kB).
 * Used memory ≈ total − available (available excludes reclaimable cache).
 */
async function readMemoryFromProc() {
  let raw;
  try {
    raw = await fs.readFile('/proc/meminfo', 'utf8');
  } catch {
    throw new HttpError(503, 'Memory metrics unavailable on this host');
  }

  const values = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^(MemTotal|MemAvailable):\s+(\d+)\s+kB/);
    if (match) {
      values[match[1]] = Number(match[2]);
    }
  }

  if (
    typeof values.MemTotal !== 'number' ||
    typeof values.MemAvailable !== 'number' ||
    values.MemTotal <= 0
  ) {
    throw new HttpError(503, 'Memory metrics unavailable on this host');
  }

  const totalBytes = values.MemTotal * 1024;
  const availableBytes = values.MemAvailable * 1024;
  const usedBytes = totalBytes - availableBytes;
  const usedPercent = roundOneDecimal((usedBytes / totalBytes) * 100);

  return {
    totalBytes,
    availableBytes,
    usedBytes,
    usedPercent,
  };
}

/**
 * Root filesystem capacity via fs.statfs("/").
 * blocks × bsize = total; bavail × bsize = available to unprivileged users.
 */
async function readDiskUsage() {
  let stats;
  try {
    stats = await fs.statfs('/');
  } catch {
    throw new HttpError(503, 'Disk metrics unavailable on this host');
  }

  const blockSize = Number(stats.bsize);
  const totalBytes = Number(stats.blocks) * blockSize;
  const availableBytes = Number(stats.bavail) * blockSize;

  if (totalBytes <= 0) {
    throw new HttpError(503, 'Disk metrics unavailable on this host');
  }

  const usedBytes = totalBytes - availableBytes;
  const usedPercent = roundOneDecimal((usedBytes / totalBytes) * 100);

  return {
    totalBytes,
    availableBytes,
    usedBytes,
    usedPercent,
  };
}

function serviceError(reason) {
  return { status: 'error', reason };
}

/**
 * Local loopback check of GET /health (Express on this host's configured port).
 */
async function checkBackendHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(`http://127.0.0.1:${env.port}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      return serviceError('unhealthy');
    }

    let body;
    try {
      body = await response.json();
    } catch {
      return serviceError('unexpected_response');
    }

    if (body?.success === true && body?.data?.status === 'ok') {
      return { status: 'healthy' };
    }

    return serviceError('unexpected_response');
  } catch (error) {
    if (error?.name === 'AbortError') {
      return serviceError('timeout');
    }
    return serviceError('unreachable');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the PM2 daemon for authoritative process state via `pm2 jlist` (JSON).
 * Chosen over a new npm dependency: PM2 is already on the droplet CLI, and
 * jlist is the stable machine-readable interface without shell interpolation.
 */
async function checkPm2() {
  try {
    const { code, stdout } = await runFixedProcess(
      'pm2',
      ['jlist'],
      PM2_TIMEOUT_MS,
    );

    if (code !== 0) {
      return serviceError('unreachable');
    }

    let list;
    try {
      list = JSON.parse(stdout);
    } catch {
      return serviceError('unexpected_response');
    }

    if (!Array.isArray(list)) {
      return serviceError('unexpected_response');
    }

    const app = list.find((entry) => entry?.name === PM2_APP_NAME);

    if (!app) {
      return serviceError('not_found');
    }

    const pm2Status = typeof app.pm2_env?.status === 'string'
      ? app.pm2_env.status
      : 'unknown';

    const result = {
      status: pm2Status,
    };

    if (typeof app.pid === 'number' && app.pid > 0) {
      result.pid = app.pid;
    }

    if (typeof app.pm2_env?.restart_time === 'number') {
      result.restartCount = app.pm2_env.restart_time;
    }

    if (typeof app.pm2_env?.pm_uptime === 'number' && app.pm2_env.pm_uptime > 0) {
      result.uptimeSeconds = Math.max(
        0,
        Math.floor((Date.now() - app.pm2_env.pm_uptime) / 1000),
      );
    }

    return result;
  } catch (error) {
    if (error?.message === 'timeout') {
      return serviceError('timeout');
    }
    return serviceError('unreachable');
  }
}

/**
 * systemd active-state for a fixed unit name (nginx / mysql).
 */
async function checkSystemdUnit(unitName) {
  try {
    const { stdout } = await runFixedProcess(
      'systemctl',
      ['is-active', unitName],
      SYSTEMD_TIMEOUT_MS,
    );

    const status = stdout.trim();

    if (
      status === 'active' ||
      status === 'inactive' ||
      status === 'failed' ||
      status === 'activating' ||
      status === 'deactivating'
    ) {
      return { status };
    }

    if (status.length === 0) {
      return serviceError('unknown');
    }

    // systemctl may print other tokens (e.g. "unknown"); keep them bounded.
    if (/^[a-z-]+$/i.test(status) && status.length <= 32) {
      return { status };
    }

    return serviceError('unknown');
  } catch (error) {
    if (error?.message === 'timeout') {
      return serviceError('timeout');
    }
    return serviceError('unreachable');
  }
}

/**
 * Can this Node process talk to MySQL through Prisma?
 */
async function checkPrisma() {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), PRISMA_TIMEOUT_MS);
      }),
    ]);
    return { status: 'healthy' };
  } catch (error) {
    if (error?.message === 'timeout') {
      return serviceError('timeout');
    }
    return serviceError('unreachable');
  }
}

/**
 * Each check catches its own failures so one bad service cannot reject others.
 */
async function collectServiceHealth() {
  const [backend, pm2, nginx, mysql, prismaHealth] = await Promise.all([
    checkBackendHealth(),
    checkPm2(),
    checkSystemdUnit(NGINX_UNIT),
    checkSystemdUnit(MYSQL_UNIT),
    checkPrisma(),
  ]);

  return {
    backend,
    pm2,
    nginx,
    mysql,
    prisma: prismaHealth,
  };
}

export async function getOverview() {
  // Start service/network checks immediately so they overlap with system metrics I/O.
  const servicesPromise = collectServiceHealth();
  const networkPromise = collectNetworkVisibility();

  const [memory, disk] = await Promise.all([
    readMemoryFromProc(),
    readDiskUsage(),
  ]);

  const [services, network] = await Promise.all([
    servicesPromise,
    networkPromise,
  ]);

  return {
    system: {
      cpuUsagePercent: getCpuUsagePercent(),
      memory,
      disk,
      uptimeSeconds: Math.floor(os.uptime()),
    },
    backend: {
      uptimeSeconds: Math.floor(process.uptime()),
    },
    services,
    network,
  };
}
