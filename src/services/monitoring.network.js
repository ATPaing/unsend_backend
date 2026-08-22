import fs from 'node:fs/promises';
import env from '../config/env.js';
import { runFixedProcess } from '../utils/runFixedProcess.js';

const SS_TIMEOUT_MS = 2000;

/** Fixed server-side path — never taken from the HTTP request. */
const NGINX_SITE_CONFIG_PATH = '/etc/nginx/sites-enabled/unsend';

const NGINX_HTTP_PORT = 80;
const NGINX_HTTPS_PORT = 443;
const MYSQL_DEFAULT_PORT = 3306;

function networkError(reason) {
  return { status: 'error', reason };
}

/**
 * Expected MySQL TCP port from DATABASE_URL only (never return credentials).
 * mysql://… URLs are rewritten to http:// so URL can parse host/port.
 */
export function getExpectedMysqlPort() {
  try {
    const normalized = String(env.databaseUrl).replace(/^mysql:\/\//i, 'http://');
    const url = new URL(normalized);
    if (url.port) {
      const port = Number(url.port);
      if (Number.isInteger(port) && port > 0 && port <= 65535) {
        return port;
      }
    }
    return MYSQL_DEFAULT_PORT;
  } catch {
    return MYSQL_DEFAULT_PORT;
  }
}

/**
 * Extract the local listen port from an ss Local Address:Port token.
 * Handles 127.0.0.1:3000, 0.0.0.0:80, *:443, [::]:80, [::1]:3306.
 */
function extractLocalListenPort(localAddress) {
  if (typeof localAddress !== 'string' || localAddress.length === 0) {
    return null;
  }

  if (localAddress.startsWith('[')) {
    const match = localAddress.match(/\]:(\d+)$/);
    return match ? Number(match[1]) : null;
  }

  const colon = localAddress.lastIndexOf(':');
  if (colon === -1) {
    return null;
  }

  const port = Number(localAddress.slice(colon + 1));
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

/**
 * Parse `ss -ltn` stdout into a Set of listening TCP port numbers.
 * Ignores peer addresses and does not keep host/IP strings for the API.
 */
export function parseListeningTcpPorts(ssStdout) {
  const ports = new Set();

  for (const line of String(ssStdout).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('LISTEN')) {
      continue;
    }

    // Typical: LISTEN  0  511  127.0.0.1:3000  0.0.0.0:*
    const columns = trimmed.split(/\s+/);
    if (columns.length < 4) {
      continue;
    }

    const port = extractLocalListenPort(columns[3]);
    if (port !== null) {
      ports.add(port);
    }
  }

  return ports;
}

async function readListeningTcpPorts() {
  const { code, stdout } = await runFixedProcess(
    'ss',
    ['-ltn'],
    SS_TIMEOUT_MS,
  );

  if (code !== 0) {
    throw new Error('unavailable');
  }

  return parseListeningTcpPorts(stdout);
}

function listenerResult(port, listeningPorts, ssFailureReason) {
  if (ssFailureReason) {
    return { port, ...networkError(ssFailureReason) };
  }

  return {
    port,
    listening: listeningPorts.has(port),
  };
}

/**
 * Coerce configured Node listen port to a number for Set comparison with ss ports.
 * Returns null when the configured value is not a valid TCP port.
 */
function normalizeExpectedNodePort(configuredPort) {
  const port = Number(configuredPort);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }

  return port;
}

/**
 * Find location /api/ { ... } blocks and read their proxy_pass (brace-depth scan).
 * Avoids treating an arbitrary Certbot server_name block as the app config.
 */
export function extractApiProxyUpstream(nginxConfig) {
  const source = String(nginxConfig);
  const locationPattern = /location\s+\/api\/\s*\{/g;
  const proxyPasses = [];

  let match;
  while ((match = locationPattern.exec(source)) !== null) {
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let i = bodyStart;

    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      i += 1;
    }

    if (depth !== 0) {
      continue;
    }

    const body = source.slice(bodyStart, i - 1);
    const proxyMatch = body.match(/proxy_pass\s+([^;\s]+)\s*;/);
    if (proxyMatch) {
      proxyPasses.push(proxyMatch[1].trim());
    }
  }

  if (proxyPasses.length === 0) {
    return networkError('not_found');
  }

  // V1: use the first location /api/ proxy_pass (typically the real app block).
  return parseProxyPassTarget(proxyPasses[0]);
}

function parseProxyPassTarget(proxyPass) {
  try {
    const url = new URL(proxyPass);
    const host = url.hostname;
    let port = url.port ? Number(url.port) : null;

    if (port === null) {
      if (url.protocol === 'https:') port = 443;
      else if (url.protocol === 'http:') port = 80;
    }

    if (
      typeof host !== 'string' ||
      host.length === 0 ||
      !Number.isInteger(port) ||
      port <= 0
    ) {
      return networkError('unexpected_response');
    }

    // Host is useful to compare loopback vs wrong upstream; no public droplet IP.
    return { host, port };
  } catch {
    return networkError('unexpected_response');
  }
}

async function readNginxUpstream() {
  let configText;
  try {
    configText = await fs.readFile(NGINX_SITE_CONFIG_PATH, 'utf8');
  } catch (error) {
    if (error?.code === 'EACCES' || error?.code === 'EPERM') {
      return networkError('permission_denied');
    }
    // ENOENT, ENOTDIR, EISDIR, etc. — site file missing or unreadable as config.
    return networkError('unavailable');
  }

  if (!configText || configText.trim().length === 0) {
    return networkError('unavailable');
  }

  return extractApiProxyUpstream(configText);
}

/**
 * Runtime network visibility: expected ports vs Linux listen table + Nginx /api/ upstream.
 * Each subsection fails independently; never returns raw ss/nginx output.
 */
export async function collectNetworkVisibility() {
  let listeningPorts = null;
  let ssFailureReason = null;

  try {
    listeningPorts = await readListeningTcpPorts();
  } catch (error) {
    ssFailureReason = error?.message === 'timeout' ? 'timeout' : 'unavailable';
    listeningPorts = new Set();
  }

  const nginxUpstreamPromise = readNginxUpstream();

  const nodePort = normalizeExpectedNodePort(env.port);
  const mysqlPort = getExpectedMysqlPort();

  const nginxUpstream = await nginxUpstreamPromise;

  return {
    node:
      nodePort === null
        ? networkError('invalid_configuration')
        : listenerResult(nodePort, listeningPorts, ssFailureReason),
    mysql: listenerResult(mysqlPort, listeningPorts, ssFailureReason),
    nginx: {
      http: listenerResult(NGINX_HTTP_PORT, listeningPorts, ssFailureReason),
      https: listenerResult(NGINX_HTTPS_PORT, listeningPorts, ssFailureReason),
    },
    nginxUpstream,
  };
}
