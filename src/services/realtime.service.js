const HEARTBEAT_INTERVAL_MS = 25000;

/** @type {Map<number, Set<import('express').Response>>} */
const connectionsByUserId = new Map();

let heartbeatTimer = null;

function isDevelopment() {
  return process.env.NODE_ENV !== 'production';
}

function ensureHeartbeat() {
  if (heartbeatTimer) {
    return;
  }

  heartbeatTimer = setInterval(() => {
    for (const [userId, connections] of connectionsByUserId.entries()) {
      for (const res of [...connections]) {
        try {
          res.write(': heartbeat\n\n');
        } catch {
          removeConnection(userId, res);
        }
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Do not keep the process alive solely for heartbeats.
  if (typeof heartbeatTimer.unref === 'function') {
    heartbeatTimer.unref();
  }
}

function stopHeartbeatIfIdle() {
  if (connectionsByUserId.size > 0 || !heartbeatTimer) {
    return;
  }

  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

export function addConnection(userId, res) {
  const normalizedUserId = Number(userId);

  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return;
  }

  let connections = connectionsByUserId.get(normalizedUserId);

  if (!connections) {
    connections = new Set();
    connectionsByUserId.set(normalizedUserId, connections);
  }

  connections.add(res);
  ensureHeartbeat();

  if (isDevelopment()) {
    console.log(
      `SSE connected: user ${normalizedUserId} (${connections.size} connection(s))`,
    );
  }
}

export function removeConnection(userId, res) {
  const normalizedUserId = Number(userId);
  const connections = connectionsByUserId.get(normalizedUserId);

  if (!connections) {
    return;
  }

  connections.delete(res);

  if (connections.size === 0) {
    connectionsByUserId.delete(normalizedUserId);
  }

  stopHeartbeatIfIdle();

  if (isDevelopment()) {
    const remaining = connectionsByUserId.get(normalizedUserId)?.size ?? 0;
    console.log(
      `SSE disconnected: user ${normalizedUserId} (${remaining} connection(s) remaining)`,
    );
  }
}

/**
 * Send a named SSE event to every active connection for a user.
 * No-ops safely when the user is offline. Never throws for delivery failures.
 */
export function sendToUser(userId, eventName, payload) {
  const normalizedUserId = Number(userId);
  const connections = connectionsByUserId.get(normalizedUserId);

  if (!connections || connections.size === 0) {
    if (isDevelopment()) {
      console.log(
        `SSE skip (offline): user ${normalizedUserId} event ${eventName}`,
      );
    }
    return;
  }

  let data;

  try {
    data = JSON.stringify(payload ?? {});
  } catch (error) {
    if (isDevelopment()) {
      console.error('SSE payload serialization failed', error);
    }
    return;
  }

  const chunk = `event: ${eventName}\ndata: ${data}\n\n`;

  if (isDevelopment()) {
    console.log(
      `SSE send: user ${normalizedUserId} event ${eventName} → ${connections.size} connection(s)`,
    );
  }

  for (const res of [...connections]) {
    try {
      res.write(chunk);
      if (typeof res.flush === 'function') {
        res.flush();
      }
    } catch {
      removeConnection(normalizedUserId, res);
    }
  }
}

export function getConnectionStats() {
  let connectionCount = 0;

  for (const connections of connectionsByUserId.values()) {
    connectionCount += connections.size;
  }

  return {
    userCount: connectionsByUserId.size,
    connectionCount,
  };
}
