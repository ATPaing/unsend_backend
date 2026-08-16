import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'sid',
  sessionTtlMs: Number(process.env.SESSION_TTL_MS) || 7 * 24 * 60 * 60 * 1000,
};

if (!env.databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

export default env;
