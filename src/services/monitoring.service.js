import os from 'node:os';
import fs from 'node:fs/promises';
import { HttpError } from '../utils/errors.js';

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

export async function getOverview() {
  const [memory, disk] = await Promise.all([
    readMemoryFromProc(),
    readDiskUsage(),
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
  };
}
