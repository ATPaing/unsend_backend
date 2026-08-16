import { createHash, randomBytes } from 'node:crypto';
import env from '../config/env.js';

export function generateSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function getSessionExpiry() {
  return new Date(Date.now() + env.sessionTtlMs);
}

export function createSessionCredentials() {
  const token = generateSessionToken();

  return {
    token,
    hashedToken: hashSessionToken(token),
    expiresAt: getSessionExpiry(),
  };
}
