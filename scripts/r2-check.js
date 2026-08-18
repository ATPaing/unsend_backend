import 'dotenv/config';
import { verifyStorageConnection } from '../src/services/storage.service.js';

try {
  const result = await verifyStorageConnection();
  console.log(`R2 connection OK (bucket: ${result.bucket})`);
} catch (error) {
  console.error('R2 connection failed:', error.message);
  if (error.cause) {
    console.error(error.cause.message || error.cause);
  }
  process.exit(1);
}
