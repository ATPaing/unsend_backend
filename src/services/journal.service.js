import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { decodeBase64, encodeBase64 } from '../utils/base64.js';
import { HttpError } from '../utils/errors.js';
import {
  AES_GCM_NONCE_LENGTH,
  MAX_ENCRYPTED_JOURNAL_CONTENT_BYTES,
  MAX_ENCRYPTED_JOURNAL_TITLE_BYTES,
  OWNER_WRAPPED_AES_KEY_BYTES,
} from '../config/journalLimits.js';
import { sendToUser } from './realtime.service.js';
import { deleteObject } from './storage.service.js';

const JOURNAL_TYPES = new Set(['JOURNAL', 'T_CAPSULE']);

const PUBLIC_USER_SELECT = {
  id: true,
  username: true,
};

function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
  };
}

function toNotificationPayload(notification) {
  return {
    id: notification.id,
    type: notification.type,
    isRead: notification.isRead,
    journalId: notification.journalId,
    createdAt: notification.createdAt,
    actor: toPublicUser(notification.actor),
  };
}

/**
 * Server-time authoritative unlock check.
 * Normal journals are always "unlocked" for key release.
 * Capsules unlock when now >= unlockAt.
 */
export function isCapsuleContentUnlocked(journal, now = new Date()) {
  if (journal.journalType !== 'T_CAPSULE') {
    return true;
  }

  if (!journal.unlockAt) {
    return false;
  }

  const unlockAt =
    journal.unlockAt instanceof Date
      ? journal.unlockAt
      : new Date(journal.unlockAt);

  if (Number.isNaN(unlockAt.getTime())) {
    return false;
  }

  return now.getTime() >= unlockAt.getTime();
}

export function isTimeCapsuleLocked(journal, now = new Date()) {
  return (
    journal.journalType === 'T_CAPSULE' &&
    !isCapsuleContentUnlocked(journal, now)
  );
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

function parseJournalId(journalId) {
  const id = Number(journalId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(404, 'Journal not found');
  }

  return id;
}

function parsePositiveUserId(value, field = 'userId') {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, 'Validation failed', [
      { field, message: `${field} must be a positive integer` },
    ]);
  }

  return id;
}

function orderedPair(userId1, userId2) {
  return {
    userAId: Math.min(userId1, userId2),
    userBId: Math.max(userId1, userId2),
  };
}

function isUniqueConstraintError(error) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function parseJournalType(body) {
  const journalType =
    typeof body?.journalType === 'string' ? body.journalType : 'JOURNAL';

  if (!JOURNAL_TYPES.has(journalType)) {
    throw new HttpError(400, 'Validation failed', [
      { field: 'journalType', message: 'Invalid journalType' },
    ]);
  }

  return journalType;
}

/**
 * Parse unlockAt for create. Server time is authoritative for "in the future".
 */
function parseUnlockAtForCreate(journalType, unlockAtRaw, now = new Date()) {
  const hasUnlockAt =
    unlockAtRaw !== undefined && unlockAtRaw !== null && unlockAtRaw !== '';

  if (journalType === 'JOURNAL') {
    if (hasUnlockAt) {
      throw new HttpError(400, 'Validation failed', [
        {
          field: 'unlockAt',
          message: 'unlockAt is not allowed for JOURNAL',
        },
      ]);
    }

    return null;
  }

  if (!hasUnlockAt) {
    throw new HttpError(400, 'Validation failed', [
      { field: 'unlockAt', message: 'unlockAt is required for T_CAPSULE' },
    ]);
  }

  const unlockAt = new Date(unlockAtRaw);

  if (Number.isNaN(unlockAt.getTime())) {
    throw new HttpError(400, 'Validation failed', [
      { field: 'unlockAt', message: 'unlockAt must be a valid ISO timestamp' },
    ]);
  }

  if (unlockAt.getTime() <= now.getTime()) {
    throw new HttpError(400, 'Validation failed', [
      { field: 'unlockAt', message: 'unlockAt must be in the future' },
    ]);
  }

  return unlockAt;
}

function parseFutureUnlockAt(unlockAtRaw, field = 'unlockAt', now = new Date()) {
  if (typeof unlockAtRaw !== 'string' || unlockAtRaw.length === 0) {
    throw new HttpError(400, 'Validation failed', [
      { field, message: `${field} is required` },
    ]);
  }

  const unlockAt = new Date(unlockAtRaw);

  if (Number.isNaN(unlockAt.getTime())) {
    throw new HttpError(400, 'Validation failed', [
      { field, message: `${field} must be a valid ISO timestamp` },
    ]);
  }

  if (unlockAt.getTime() <= now.getTime()) {
    throw new HttpError(400, 'Validation failed', [
      { field, message: `${field} must be in the future` },
    ]);
  }

  return unlockAt;
}

/**
 * Validate encrypted journal ciphertext fields for create/update.
 * Returns decoded Buffers ready for Prisma Bytes columns.
 */
function parseEncryptedCipherFields(body) {
  const encryptedTitle = decodeRequiredBytes(
    'encryptedTitle',
    body?.encryptedTitle,
  );
  const titleNonce = decodeRequiredBytes('titleNonce', body?.titleNonce);
  const encryptedContent = decodeRequiredBytes(
    'encryptedContent',
    body?.encryptedContent,
  );
  const contentNonce = decodeRequiredBytes('contentNonce', body?.contentNonce);
  const ownerEncryptedAesKey = decodeRequiredBytes(
    'ownerEncryptedAesKey',
    body?.ownerEncryptedAesKey,
  );

  assertNonce('titleNonce', titleNonce);
  assertNonce('contentNonce', contentNonce);

  if (Buffer.compare(titleNonce, contentNonce) === 0) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'contentNonce',
        message: 'contentNonce must differ from titleNonce',
      },
    ]);
  }

  if (
    encryptedTitle.length === 0 ||
    encryptedTitle.length > MAX_ENCRYPTED_JOURNAL_TITLE_BYTES
  ) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'encryptedTitle',
        message: 'encryptedTitle exceeds allowed size',
      },
    ]);
  }

  if (
    encryptedContent.length === 0 ||
    encryptedContent.length > MAX_ENCRYPTED_JOURNAL_CONTENT_BYTES
  ) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'encryptedContent',
        message: 'encryptedContent exceeds allowed size',
      },
    ]);
  }

  if (ownerEncryptedAesKey.length !== OWNER_WRAPPED_AES_KEY_BYTES) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'ownerEncryptedAesKey',
        message: `ownerEncryptedAesKey must be ${OWNER_WRAPPED_AES_KEY_BYTES} bytes`,
      },
    ]);
  }

  return {
    encryptedTitle,
    titleNonce,
    encryptedContent,
    contentNonce,
    ownerEncryptedAesKey,
  };
}

function baseMeta(journal, now = new Date()) {
  const isUnlocked = isCapsuleContentUnlocked(journal, now);

  return {
    id: journal.id,
    journalType: journal.journalType,
    unlockAt: journal.unlockAt,
    isUnlocked,
    createdAt: journal.createdAt,
    updatedAt: journal.updatedAt,
  };
}

function appendCipherFields(response, journal) {
  response.encryptedTitle = encodeBase64(journal.encryptedTitle);
  response.titleNonce = encodeBase64(journal.titleNonce);
  response.encryptedContent = encodeBase64(journal.encryptedContent);
  response.contentNonce = encodeBase64(journal.contentNonce);
}

/**
 * Owner serializer. Withholds ciphertext + ownerEncryptedAesKey while locked.
 */
function toOwnedJournalResponse(journal, sharedWith = undefined, now = new Date()) {
  const response = {
    ...baseMeta(journal, now),
    access: 'OWNED',
  };

  if (sharedWith !== undefined) {
    response.sharedWith = sharedWith;
  }

  if (!response.isUnlocked) {
    return response;
  }

  appendCipherFields(response, journal);
  response.ownerEncryptedAesKey = encodeBase64(journal.ownerEncryptedAesKey);

  return response;
}

/**
 * Shared recipient serializer. Withholds ciphertext + encryptedAesKey while locked.
 */
function toSharedJournalResponse(journal, accessEntry, owner, now = new Date()) {
  const response = {
    ...baseMeta(journal, now),
    sharedAt: accessEntry.createdAt,
    owner: toPublicUser(owner),
    access: 'SHARED',
  };

  if (!response.isUnlocked) {
    return response;
  }

  appendCipherFields(response, journal);
  response.encryptedAesKey = encodeBase64(accessEntry.viewerEncryptedAesKey);

  return response;
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

async function areFriends(userId1, userId2, client = prisma) {
  const pair = orderedPair(userId1, userId2);

  const friendship = await client.friendship.findUnique({
    where: {
      userAId_userBId: pair,
    },
    select: { id: true },
  });

  return Boolean(friendship);
}

async function listSharedWithForOwner(journalId) {
  const entries = await prisma.journalAccess.findMany({
    where: { journalId },
    include: {
      user: { select: PUBLIC_USER_SELECT },
    },
    orderBy: { createdAt: 'desc' },
  });

  return entries.map((entry) => ({
    id: entry.user.id,
    username: entry.user.username,
    sharedAt: entry.createdAt,
  }));
}

/**
 * Optional create-time recipients: [{ userId, viewerEncryptedAesKey }].
 * Used so locked capsules can be shared without reopening the AES key later.
 */
async function parseCreateRecipients(ownerId, body) {
  const raw = body?.recipients;

  if (raw === undefined || raw === null) {
    return [];
  }

  if (!Array.isArray(raw)) {
    throw new HttpError(400, 'Validation failed', [
      { field: 'recipients', message: 'recipients must be an array' },
    ]);
  }

  if (raw.length > 25) {
    throw new HttpError(400, 'Validation failed', [
      { field: 'recipients', message: 'Too many recipients' },
    ]);
  }

  const seen = new Set();
  const parsed = [];

  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    const fieldPrefix = `recipients[${index}]`;
    const recipientId = parsePositiveUserId(item?.userId, `${fieldPrefix}.userId`);

    if (recipientId === ownerId) {
      throw new HttpError(400, 'You cannot share a journal with yourself');
    }

    if (seen.has(recipientId)) {
      throw new HttpError(400, 'Validation failed', [
        {
          field: `${fieldPrefix}.userId`,
          message: 'Duplicate recipient',
        },
      ]);
    }

    seen.add(recipientId);

    const viewerEncryptedAesKey = decodeRequiredBytes(
      `${fieldPrefix}.viewerEncryptedAesKey`,
      item?.viewerEncryptedAesKey,
    );

    if (viewerEncryptedAesKey.length !== OWNER_WRAPPED_AES_KEY_BYTES) {
      throw new HttpError(400, 'Validation failed', [
        {
          field: `${fieldPrefix}.viewerEncryptedAesKey`,
          message: `viewerEncryptedAesKey must be ${OWNER_WRAPPED_AES_KEY_BYTES} bytes`,
        },
      ]);
    }

    parsed.push({
      userId: recipientId,
      viewerEncryptedAesKey,
    });
  }

  for (const recipient of parsed) {
    const user = await prisma.user.findUnique({
      where: { id: recipient.userId },
      select: PUBLIC_USER_SELECT,
    });

    if (!user) {
      throw new HttpError(404, 'User not found');
    }

    const friends = await areFriends(ownerId, recipient.userId);

    if (!friends) {
      throw new HttpError(403, 'You can only share journals with friends');
    }

    recipient.user = user;
  }

  return parsed;
}

export async function createJournal(userId, body) {
  const cipher = parseEncryptedCipherFields(body);
  const journalType = parseJournalType(body);
  const unlockAt = parseUnlockAtForCreate(journalType, body?.unlockAt);
  const recipients = await parseCreateRecipients(userId, body);

  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: PUBLIC_USER_SELECT,
  });

  const { journal, accessEntries, notifications } = await prisma.$transaction(
    async (tx) => {
      const created = await tx.journal.create({
        data: {
          encryptedTitle: cipher.encryptedTitle,
          titleNonce: cipher.titleNonce,
          encryptedContent: cipher.encryptedContent,
          contentNonce: cipher.contentNonce,
          ownerEncryptedAesKey: cipher.ownerEncryptedAesKey,
          createdBy: userId,
          journalType,
          unlockAt,
        },
      });

      const createdAccess = [];
      const createdNotifications = [];

      for (const recipient of recipients) {
        const access = await tx.journalAccess.create({
          data: {
            journalId: created.id,
            userId: recipient.userId,
            viewerEncryptedAesKey: recipient.viewerEncryptedAesKey,
          },
        });

        const notification = await tx.notification.create({
          data: {
            recipientId: recipient.userId,
            actorId: userId,
            type: 'JOURNAL_SHARED',
            journalId: created.id,
          },
          include: {
            actor: { select: PUBLIC_USER_SELECT },
          },
        });

        createdAccess.push({ access, user: recipient.user });
        createdNotifications.push(notification);
      }

      return {
        journal: created,
        accessEntries: createdAccess,
        notifications: createdNotifications,
      };
    },
  );

  for (let index = 0; index < accessEntries.length; index += 1) {
    const { access, user } = accessEntries[index];
    const notification = notifications[index];
    const sharedJournal = toSharedJournalResponse(journal, access, owner);

    sendToUser(user.id, 'journal.shared', {
      journal: sharedJournal,
      notification: toNotificationPayload(notification),
    });
  }

  const sharedWith = accessEntries.map(({ access, user }) => ({
    id: user.id,
    username: user.username,
    sharedAt: access.createdAt,
  }));

  return toOwnedJournalResponse(journal, sharedWith);
}

export async function updateJournal(userId, journalId, body) {
  const existing = await findOwnedJournalOrThrow(userId, journalId);

  if (isTimeCapsuleLocked(existing)) {
    throw new HttpError(
      403,
      'Locked time capsules cannot be edited until they unlock',
    );
  }

  // journalType / unlockAt are immutable via this endpoint.
  if (body?.journalType !== undefined && body.journalType !== existing.journalType) {
    throw new HttpError(400, 'Validation failed', [
      { field: 'journalType', message: 'journalType cannot be changed' },
    ]);
  }

  if (body?.unlockAt !== undefined) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'unlockAt',
        message: 'Use PATCH /journals/:journalId/unlock-at to change unlockAt',
      },
    ]);
  }

  const cipher = parseEncryptedCipherFields(body);

  // Ordinary edits reuse the same AES key. The client must send the existing
  // ownerEncryptedAesKey (or a re-wrap of the same AES key). Fresh nonces are
  // still required so JournalAccess wraps remain valid for recipients.
  const journal = await prisma.journal.update({
    where: { id: existing.id },
    data: {
      encryptedTitle: cipher.encryptedTitle,
      titleNonce: cipher.titleNonce,
      encryptedContent: cipher.encryptedContent,
      contentNonce: cipher.contentNonce,
      ownerEncryptedAesKey: cipher.ownerEncryptedAesKey,
    },
  });

  const sharedWith = await listSharedWithForOwner(journal.id);
  return toOwnedJournalResponse(journal, sharedWith);
}

export async function updateJournalUnlockAt(userId, journalId, body) {
  const existing = await findOwnedJournalOrThrow(userId, journalId);
  const now = new Date();

  if (existing.journalType !== 'T_CAPSULE') {
    throw new HttpError(400, 'Only time capsules have an unlock date');
  }

  if (!isTimeCapsuleLocked(existing, now)) {
    throw new HttpError(
      403,
      'Unlocked time capsules cannot change unlockAt',
    );
  }

  const nextUnlockAt = parseFutureUnlockAt(body?.unlockAt, 'unlockAt', now);
  const currentUnlockAt =
    existing.unlockAt instanceof Date
      ? existing.unlockAt
      : new Date(existing.unlockAt);

  if (nextUnlockAt.getTime() <= currentUnlockAt.getTime()) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'unlockAt',
        message: 'unlockAt may only be moved later than the current unlock time',
      },
    ]);
  }

  const journal = await prisma.journal.update({
    where: { id: existing.id },
    data: { unlockAt: nextUnlockAt },
  });

  const accessEntries = await prisma.journalAccess.findMany({
    where: { journalId: journal.id },
    select: { userId: true },
  });

  const sharedWith = await listSharedWithForOwner(journal.id);
  const response = toOwnedJournalResponse(journal, sharedWith);

  const notifyUserIds = new Set([
    userId,
    ...accessEntries.map((entry) => entry.userId),
  ]);

  for (const recipientId of notifyUserIds) {
    sendToUser(recipientId, 'journal.unlock-at.updated', {
      journalId: journal.id,
      unlockAt: journal.unlockAt,
      isUnlocked: response.isUnlocked,
    });
  }

  return response;
}

export async function deleteJournal(userId, journalId) {
  const existing = await findOwnedJournalOrThrow(userId, journalId);

  const media = await prisma.media.findUnique({
    where: { journalId: existing.id },
  });

  if (media?.storageKey) {
    try {
      await deleteObject(media.storageKey);
    } catch (error) {
      if (error?.name === 'StorageError') {
        throw new HttpError(
          503,
          'Could not delete journal media from storage',
        );
      }

      throw error;
    }
  }

  const accessEntries = await prisma.journalAccess.findMany({
    where: { journalId: existing.id },
    select: { userId: true },
  });

  await prisma.journal.delete({
    where: { id: existing.id },
  });

  // Cascade removes JournalAccess; notify recipients so Shared With Me updates.
  for (const entry of accessEntries) {
    sendToUser(entry.userId, 'journal.unshared', {
      journalId: existing.id,
      reason: 'deleted',
    });
  }

  return { id: existing.id };
}

export async function listJournalsForUser(userId) {
  const journals = await prisma.journal.findMany({
    where: { createdBy: userId },
    orderBy: { createdAt: 'desc' },
  });

  if (journals.length === 0) {
    return [];
  }

  const journalIds = journals.map((journal) => journal.id);
  const accessEntries = await prisma.journalAccess.findMany({
    where: { journalId: { in: journalIds } },
    include: {
      user: { select: PUBLIC_USER_SELECT },
    },
    orderBy: { createdAt: 'desc' },
  });

  const sharedByJournalId = new Map();
  for (const entry of accessEntries) {
    const list = sharedByJournalId.get(entry.journalId) ?? [];
    list.push({
      id: entry.user.id,
      username: entry.user.username,
      sharedAt: entry.createdAt,
    });
    sharedByJournalId.set(entry.journalId, list);
  }

  const now = new Date();

  return journals.map((journal) =>
    toOwnedJournalResponse(
      journal,
      sharedByJournalId.get(journal.id) ?? [],
      now,
    ),
  );
}

export async function getJournalForUser(userId, journalId) {
  const id = parseJournalId(journalId);
  const now = new Date();

  const journal = await prisma.journal.findUnique({
    where: { id },
    include: {
      owner: { select: PUBLIC_USER_SELECT },
    },
  });

  if (!journal) {
    throw new HttpError(404, 'Journal not found');
  }

  if (journal.createdBy === userId) {
    const sharedWith = await listSharedWithForOwner(journal.id);
    return toOwnedJournalResponse(journal, sharedWith, now);
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

  return toSharedJournalResponse(journal, accessEntry, journal.owner, now);
}

export async function listSharedWithMe(userId) {
  const entries = await prisma.journalAccess.findMany({
    where: { userId },
    include: {
      journal: {
        include: {
          owner: { select: PUBLIC_USER_SELECT },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const now = new Date();

  return entries.map((entry) =>
    toSharedJournalResponse(entry.journal, entry, entry.journal.owner, now),
  );
}

export async function shareJournal(ownerId, journalIdParam, body) {
  const journal = await findOwnedJournalOrThrow(ownerId, journalIdParam);

  if (isTimeCapsuleLocked(journal)) {
    throw new HttpError(
      403,
      'Locked time capsules cannot be shared until they unlock',
    );
  }

  const recipientId = parsePositiveUserId(body?.userId, 'userId');

  if (recipientId === ownerId) {
    throw new HttpError(400, 'You cannot share a journal with yourself');
  }

  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
    select: PUBLIC_USER_SELECT,
  });

  if (!recipient) {
    throw new HttpError(404, 'User not found');
  }

  const friends = await areFriends(ownerId, recipientId);

  if (!friends) {
    throw new HttpError(403, 'You can only share journals with friends');
  }

  const existingAccess = await prisma.journalAccess.findUnique({
    where: {
      journalId_userId: {
        journalId: journal.id,
        userId: recipientId,
      },
    },
  });

  if (existingAccess) {
    throw new HttpError(409, 'Journal is already shared with this user');
  }

  const viewerEncryptedAesKey = decodeRequiredBytes(
    'viewerEncryptedAesKey',
    body?.viewerEncryptedAesKey,
  );

  if (viewerEncryptedAesKey.length !== OWNER_WRAPPED_AES_KEY_BYTES) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'viewerEncryptedAesKey',
        message: `viewerEncryptedAesKey must be ${OWNER_WRAPPED_AES_KEY_BYTES} bytes`,
      },
    ]);
  }

  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: PUBLIC_USER_SELECT,
  });

  try {
    const { accessEntry, notification } = await prisma.$transaction(
      async (tx) => {
        const createdAccess = await tx.journalAccess.create({
          data: {
            journalId: journal.id,
            userId: recipientId,
            viewerEncryptedAesKey,
          },
        });

        const createdNotification = await tx.notification.create({
          data: {
            recipientId,
            actorId: ownerId,
            type: 'JOURNAL_SHARED',
            journalId: journal.id,
          },
          include: {
            actor: { select: PUBLIC_USER_SELECT },
          },
        });

        return {
          accessEntry: createdAccess,
          notification: createdNotification,
        };
      },
    );

    const sharedJournal = toSharedJournalResponse(journal, accessEntry, owner);

    sendToUser(recipientId, 'journal.shared', {
      journal: sharedJournal,
      notification: toNotificationPayload(notification),
    });

    return {
      journalId: journal.id,
      user: toPublicUser(recipient),
      sharedAt: accessEntry.createdAt,
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HttpError(409, 'Journal is already shared with this user');
    }

    throw error;
  }
}

export async function revokeJournalShare(
  ownerId,
  journalIdParam,
  targetUserIdParam,
) {
  const journal = await findOwnedJournalOrThrow(ownerId, journalIdParam);
  const targetUserId = parsePositiveUserId(targetUserIdParam, 'userId');

  const accessEntry = await prisma.journalAccess.findUnique({
    where: {
      journalId_userId: {
        journalId: journal.id,
        userId: targetUserId,
      },
    },
  });

  if (!accessEntry) {
    throw new HttpError(404, 'Journal share not found');
  }

  await prisma.journalAccess.delete({
    where: { id: accessEntry.id },
  });

  sendToUser(targetUserId, 'journal.unshared', {
    journalId: journal.id,
  });

  return {
    journalId: journal.id,
    userId: targetUserId,
  };
}
