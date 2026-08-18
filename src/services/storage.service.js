import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import r2Client, { r2BucketName } from '../lib/r2.js';
import { HttpError } from '../utils/errors.js';

const PRESIGNED_URL_EXPIRES_IN_SECONDS = 300;
export const ENCRYPTED_MEDIA_CONTENT_TYPE = 'application/octet-stream';

const OBJECT_KEY_PATTERN = /^journals\/\d+\/[0-9a-f-]{36}\.bin$/i;

function parseJournalIdForObjectKey(journalId) {
  const id = Number(journalId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'journalId',
        message: 'journalId must be a positive integer',
      },
    ]);
  }

  return id;
}

function assertSafeObjectKey(objectKey, field = 'objectKey') {
  if (typeof objectKey !== 'string' || objectKey.trim().length === 0) {
    throw new HttpError(400, 'Validation failed', [
      { field, message: `${field} is required` },
    ]);
  }

  const key = objectKey.trim();

  if (
    key.startsWith('/') ||
    key.includes('\\') ||
    key.includes('..') ||
    key.length > 512
  ) {
    throw new HttpError(400, 'Validation failed', [
      { field, message: `${field} is invalid` },
    ]);
  }

  if (!OBJECT_KEY_PATTERN.test(key)) {
    throw new HttpError(400, 'Validation failed', [
      {
        field,
        message: `${field} must match journals/<journalId>/<uuid>.bin`,
      },
    ]);
  }

  return key;
}

function storageError(operation, error) {
  const wrapped = new Error(`R2 ${operation} failed`);
  wrapped.name = 'StorageError';
  wrapped.code = 'STORAGE_ERROR';
  wrapped.cause = error;
  return wrapped;
}

/**
 * Build a safe object key for encrypted journal media ciphertext.
 * Format: journals/<journalId>/<uuid>.bin
 */
export function createJournalMediaObjectKey(journalId) {
  const id = parseJournalIdForObjectKey(journalId);
  return `journals/${id}/${randomUUID()}.bin`;
}

/**
 * Presigned PUT URL for encrypted ciphertext upload (private bucket).
 */
export async function createUploadUrl(objectKey) {
  const key = assertSafeObjectKey(objectKey);

  try {
    const command = new PutObjectCommand({
      Bucket: r2BucketName,
      Key: key,
      ContentType: ENCRYPTED_MEDIA_CONTENT_TYPE,
    });

    const uploadUrl = await getSignedUrl(r2Client, command, {
      expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS,
    });

    return {
      uploadUrl,
      objectKey: key,
      expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS,
    };
  } catch (error) {
    throw storageError('createUploadUrl', error);
  }
}

/**
 * Presigned GET URL for encrypted ciphertext download (private bucket).
 */
export async function createDownloadUrl(objectKey) {
  const key = assertSafeObjectKey(objectKey);

  try {
    const command = new GetObjectCommand({
      Bucket: r2BucketName,
      Key: key,
    });

    const downloadUrl = await getSignedUrl(r2Client, command, {
      expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS,
    });

    return {
      downloadUrl,
      objectKey: key,
      expiresIn: PRESIGNED_URL_EXPIRES_IN_SECONDS,
    };
  } catch (error) {
    throw storageError('createDownloadUrl', error);
  }
}

/**
 * Read object metadata from R2 (HeadObject).
 */
export async function getObjectMetadata(objectKey) {
  const key = assertSafeObjectKey(objectKey);

  try {
    const result = await r2Client.send(
      new HeadObjectCommand({
        Bucket: r2BucketName,
        Key: key,
      }),
    );

    return {
      size: Number(result.ContentLength ?? 0),
      contentType: result.ContentType ?? null,
    };
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (error?.name === 'NotFound' || status === 404) {
      const notFound = new Error('Object not found');
      notFound.code = 'STORAGE_NOT_FOUND';
      throw storageError('getObjectMetadata', notFound);
    }

    throw storageError('getObjectMetadata', error);
  }
}

/**
 * Delete one encrypted object from the private bucket.
 */
export async function deleteObject(objectKey) {
  const key = assertSafeObjectKey(objectKey);

  try {
    await r2Client.send(
      new DeleteObjectCommand({
        Bucket: r2BucketName,
        Key: key,
      }),
    );

    return {
      deleted: true,
      objectKey: key,
    };
  } catch (error) {
    throw storageError('deleteObject', error);
  }
}

/**
 * Dev/ops helper: verify bucket access without uploading data.
 */
export async function verifyStorageConnection() {
  try {
    await r2Client.send(
      new HeadBucketCommand({
        Bucket: r2BucketName,
      }),
    );

    return {
      ok: true,
      bucket: r2BucketName,
    };
  } catch (error) {
    throw storageError('verifyStorageConnection', error);
  }
}
