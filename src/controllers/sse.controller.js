import {
  addConnection,
  removeConnection,
} from '../services/realtime.service.js';

export function streamEvents(req, res) {
  const userId = req.user.id;

  // Long-lived stream: disable socket idle timeout.
  req.socket.setTimeout(0);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  // Establish the stream before registering so early writes are valid.
  res.write(': connected\n\n');

  addConnection(userId, res);

  const cleanup = () => {
    removeConnection(userId, res);
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
}
