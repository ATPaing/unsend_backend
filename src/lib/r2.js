import { S3Client } from '@aws-sdk/client-s3';

const REQUIRED_R2_VARS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
];

function requireR2Env(name) {
  const value = process.env[name];

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required for Cloudflare R2 storage`);
  }

  return value.trim();
}

function loadR2Config() {
  for (const name of REQUIRED_R2_VARS) {
    requireR2Env(name);
  }

  return {
    accountId: requireR2Env('R2_ACCOUNT_ID'),
    accessKeyId: requireR2Env('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireR2Env('R2_SECRET_ACCESS_KEY'),
    bucketName: requireR2Env('R2_BUCKET_NAME'),
  };
}

const r2Config = loadR2Config();

/** Configured private bucket — not overridable by callers. */
export const r2BucketName = r2Config.bucketName;

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${r2Config.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: r2Config.accessKeyId,
    secretAccessKey: r2Config.secretAccessKey,
  },
});

export default r2Client;
