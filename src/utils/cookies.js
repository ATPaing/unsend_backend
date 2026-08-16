import env from '../config/env.js';

function getSessionCookieOptions() {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: env.nodeEnv === 'production',
    maxAge: env.sessionTtlMs,
  };
}

export function setSessionCookie(res, token) {
  res.cookie(env.sessionCookieName, token, getSessionCookieOptions());
}

export function clearSessionCookie(res) {
  res.clearCookie(env.sessionCookieName, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: env.nodeEnv === 'production',
  });
}
