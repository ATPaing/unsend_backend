import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { decodeBase64, encodeBase64 } from '../utils/base64.js';
import { HttpError } from '../utils/errors.js';
import {
  AES_GCM_NONCE_LENGTH,
  MAX_IMAGE_SIZE_BYTES,
} from '../config/journalLimits.js';
import {
  isTimeCapsuleLocked,
} from './journal.service.js';
import {
  createJournalMediaObjectKey,
  createDownloadUrl,
  createUploadUrl,
  ENCRYPTED_MEDIA_CONTENT_TYPE,
  getObjectMetadata,
} from './storage.service.js';

/**
 * Abandoned PENDING uploads can be cleaned up later by querying
 * `media` where status = PENDING and createdAt is older than a threshold,
 * then deleting each row's storageKey from R2 before removing the row.
 * PENDING media must not be treated as valid journal media in read responses.
 */

function isUniqueConstraintError(error) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function parseJournalId(journalId) {
  const id = Number(journalId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(404, 'Journal not found');
  }

  return id;
}

function parseMediaId(mediaId) {
  const id = Number(mediaId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(404, 'Media not found');
  }

  return id;
}

function decodeRequiredBytes(field, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, 'Validation failed', [
      { field, message: `${field} is required` },
    ]);
  }

  try {
    return decodeBase64(value);
  } catch {
    throw new HttpError(400, 'Validation failed', [
      { field, message: `${field} must be valid Base64` },
    ]);
  }
}

function assertNonce(field, buffer) {
  if (buffer.length !== AES_GCM_NONCE_LENGTH) {
    throw new HttpError(400, 'Validation failed', [
      {
        field,
        message: `${field} must be ${AES_GCM_NONCE_LENGTH} bytes`,
      },
    ]);
  }
}

function parseEncryptedMediaMetadata(body) {
  const encryptedMime = decodeRequiredBytes('encryptedMime', body?.encryptedMime);
  const mimeNonce = decodeRequiredBytes('mimeNonce', body?.mimeNonce);
  const encryptedFileName = decodeRequiredBytes(
    'encryptedFileName',
    body?.encryptedFileName,
  );
  const fileNameNonce = decodeRequiredBytes('fileNameNonce', body?.fileNameNonce);
  const fileNonce = decodeRequiredBytes('fileNonce', body?.fileNonce);

  assertNonce('mimeNonce', mimeNonce);
  assertNonce('fileNameNonce', fileNameNonce);
  assertNonce('fileNonce', fileNonce);

  if (encryptedMime.length === 0) {
    throw new HttpError(400, 'Validation failed', [
      { field: 'encryptedMime', message: 'encryptedMime is required' },
    ]);
  }

  if (encryptedFileName.length === 0) {
    throw new HttpError(400, 'Validation failed', [
      { field: 'encryptedFileName', message: 'encryptedFileName is required' },
    ]);
  }

  const size = Number(body?.size);

  if (!Number.isInteger(size) || size <= 0) {
    throw new HttpError(400, 'Validation failed', [
      { field: 'size', message: 'size must be a positive integer' },
    ]);
  }

  if (size > MAX_IMAGE_SIZE_BYTES) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'size',
        message: `size must not exceed ${MAX_IMAGE_SIZE_BYTES} bytes`,
      },
    ]);
  }

  return {
    encryptedMime,
    mimeNonce,
    encryptedFileName,
    fileNameNonce,
    fileNonce,
    size,
  };
}

async function findOwnedJournalOrThrow(userId, journalId) {
  const id = parseJournalId(journalId);

  const journal = await prisma.journal.findFirst({
    where: {
      id,
      createdBy: userId,
    },
  });

  if (!journal) {
    throw new HttpError(404, 'Journal not found');
  }

  return journal;
}

async function findJournalWithReadAccess(userId, journalId) {
  const id = parseJournalId(journalId);

  const journal = await prisma.journal.findUnique({
    where: { id },
  });

  if (!journal) {
    throw new HttpError(404, 'Journal not found');
  }

  if (journal.createdBy === userId) {
    return journal;
  }

  const accessEntry = await prisma.journalAccess.findUnique({
    where: {
      journalId_userId: {
        journalId: journal.id,
        userId,
      },
    },
  });

  if (!accessEntry) {
    throw new HttpError(404, 'Journal not found');
  }

  return journal;
}

function assertJournalReadable(journal, now = new Date()) {
  if (isTimeCapsuleLocked(journal, now)) {
    throw new HttpError(
      403,
      'Locked time capsules cannot be accessed until they unlock',
    );
  }
}

function isCompatibleEncryptedContentType(contentType) {
  if (contentType == null || contentType === '') {
    return true;
  }

  return contentType.toLowerCase() === ENCRYPTED_MEDIA_CONTENT_TYPE;
}

function mapStorageError(error, notFoundMessage) {
  if (error?.name !== 'StorageError') {
    throw error;
  }

  if (error.cause?.code === 'STORAGE_NOT_FOUND') {
    throw new HttpError(409, notFoundMessage);
  }

  throw new HttpError(503, 'Storage service is temporarily unavailable');
}

function toPublicMediaState(media) {
  return {
    id: media.id,
    status: media.status,
  };
}

function toDownloadMediaMetadata(media) {
  return {
    id: media.id,
    encryptedMime: encodeBase64(media.encryptedMime),
    mimeNonce: encodeBase64(media.mimeNonce),
    encryptedFileName: encodeBase64(media.encryptedFileName),
    fileNameNonce: encodeBase64(media.fileNameNonce),
    fileNonce: encodeBase64(media.fileNonce),
    size: media.size,
  };
}

export async function createMediaUploadUrl(userId, journalIdParam, body) {
  const journal = await findOwnedJournalOrThrow(userId, journalIdParam);

  const metadata = parseEncryptedMediaMetadata(body);

  const existingMedia = await prisma.media.findUnique({
    where: { journalId: journal.id },
  });

  if (existingMedia) {
    throw new HttpError(409, 'Journal already has media');
  }

  const storageKey = createJournalMediaObjectKey(journal.id);

  let media;

  try {
    media = await prisma.media.create({
      data: {
        journalId: journal.id,
        status: 'PENDING',
        storageKey,
        ...metadata,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HttpError(409, 'Journal already has media');
    }

    throw error;
  }

  let upload;

  try {
    upload = await createUploadUrl(storageKey);
  } catch (error) {
    await prisma.media.delete({ where: { id: media.id } }).catch(() => {});

    if (error?.name === 'StorageError') {
      throw new HttpError(503, 'Storage service is temporarily unavailable');
    }

    throw error;
  }

  return {
    media: toPublicMediaState(media),
    upload: {
      url: upload.uploadUrl,
      expiresIn: upload.expiresIn,
      contentType: ENCRYPTED_MEDIA_CONTENT_TYPE,
    },
  };
}

export async function confirmMediaUpload(
  userId,
  journalIdParam,
  mediaIdParam,
) {
  await findOwnedJournalOrThrow(userId, journalIdParam);

  const journalId = parseJournalId(journalIdParam);
  const mediaId = parseMediaId(mediaIdParam);

  const media = await prisma.media.findFirst({
    where: {
      id: mediaId,
      journalId,
    },
  });

  if (!media) {
    throw new HttpError(404, 'Media not found');
  }

  if (media.status !== 'PENDING') {
    throw new HttpError(409, 'Media upload is not pending confirmation');
  }

  let objectMetadata;

  try {
    objectMetadata = await getObjectMetadata(media.storageKey);
  } catch (error) {
    mapStorageError(error, 'Uploaded object was not found in storage');
  }

  if (objectMetadata.size !== media.size) {
    throw new HttpError(
      409,
      'Uploaded object size does not match the expected encrypted blob size',
    );
  }

  if (!isCompatibleEncryptedContentType(objectMetadata.contentType)) {
    throw new HttpError(
      409,
      'Uploaded object has an incompatible content type',
    );
  }

  const updated = await prisma.media.update({
    where: { id: media.id },
    data: { status: 'READY' },
  });

  return {
    media: toPublicMediaState(updated),
  };
}

export async function getMediaDownloadUrl(userId, journalIdParam) {
  const journal = await findJournalWithReadAccess(userId, journalIdParam);

  assertJournalReadable(journal);

  const media = await prisma.media.findUnique({
    where: { journalId: journal.id },
  });

  if (!media) {
    throw new HttpError(404, 'Media not found');
  }

  if (media.status !== 'READY') {
    throw new HttpError(409, 'Media is not ready for download');
  }

  let download;

  try {
    download = await createDownloadUrl(media.storageKey);
  } catch (error) {
    if (error?.name === 'StorageError') {
      throw new HttpError(503, 'Storage service is temporarily unavailable');
    }

    throw error;
  }

  return {
    media: toDownloadMediaMetadata(media),
    download: {
      url: download.downloadUrl,
      expiresIn: download.expiresIn,
    },
  };
}
