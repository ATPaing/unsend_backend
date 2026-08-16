import prisma from '../lib/prisma.js';
import { decodeBase64, encodeBase64 } from '../utils/base64.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { HttpError } from '../utils/errors.js';

const PRIVATE_KEY_NONCE_LENGTH = 12;
const DERIVED_KEY_SALT_LENGTH = 16;
const MIN_WRAPPED_PRIVATE_KEY_BYTES = 64;

function toCryptoResponse(user) {
  return {
    publicKey: encodeBase64(user.publicKey),
    encryptedPrivateKey: encodeBase64(user.encryptedPrivateKey),
    privateKeyNonce: encodeBase64(user.privateKeyNonce),
    derivedKeySalt: encodeBase64(user.derivedKeySalt),
    cryptoVersion: user.cryptoVersion,
  };
}

function decodeRequiredBytes(field, value, expectedLength = null) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, 'Validation failed', [
      { field, message: `${field} is required` },
    ]);
  }

  let bytes;
  try {
    bytes = decodeBase64(value);
  } catch {
    throw new HttpError(400, 'Validation failed', [
      { field, message: `${field} must be valid Base64` },
    ]);
  }

  if (expectedLength != null && bytes.length !== expectedLength) {
    throw new HttpError(400, 'Validation failed', [
      {
        field,
        message: `${field} must be ${expectedLength} bytes`,
      },
    ]);
  }

  return bytes;
}

export async function getCryptoMaterial(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      publicKey: true,
      encryptedPrivateKey: true,
      privateKeyNonce: true,
      derivedKeySalt: true,
      cryptoVersion: true,
    },
  });

  if (!user) {
    throw new HttpError(401, 'Authentication required');
  }

  return toCryptoResponse(user);
}

/**
 * Replace PIN-wrapped private key material only.
 * Public key and cryptoVersion must stay the same (client re-encrypts existing PKCS#8).
 */
export async function updateCryptoMaterial(userId, body) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      publicKey: true,
      cryptoVersion: true,
    },
  });

  if (!user) {
    throw new HttpError(401, 'Authentication required');
  }

  if (body?.publicKey !== undefined) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'publicKey',
        message: 'publicKey cannot be changed',
      },
    ]);
  }

  const cryptoVersion = body?.cryptoVersion;
  if (
    typeof cryptoVersion !== 'number' ||
    !Number.isInteger(cryptoVersion) ||
    cryptoVersion !== user.cryptoVersion
  ) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'cryptoVersion',
        message: 'cryptoVersion must match the current account crypto version',
      },
    ]);
  }

  const encryptedPrivateKey = decodeRequiredBytes(
    'encryptedPrivateKey',
    body?.encryptedPrivateKey,
  );
  const privateKeyNonce = decodeRequiredBytes(
    'privateKeyNonce',
    body?.privateKeyNonce,
    PRIVATE_KEY_NONCE_LENGTH,
  );
  const derivedKeySalt = decodeRequiredBytes(
    'derivedKeySalt',
    body?.derivedKeySalt,
    DERIVED_KEY_SALT_LENGTH,
  );

  if (encryptedPrivateKey.length < MIN_WRAPPED_PRIVATE_KEY_BYTES) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'encryptedPrivateKey',
        message: 'encryptedPrivateKey is too short',
      },
    ]);
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      encryptedPrivateKey,
      privateKeyNonce,
      derivedKeySalt,
    },
    select: {
      publicKey: true,
      encryptedPrivateKey: true,
      privateKeyNonce: true,
      derivedKeySalt: true,
      cryptoVersion: true,
    },
  });

  return toCryptoResponse(updated);
}

export async function changePassword(userId, sessionId, body) {
  const currentPassword = body?.currentPassword;
  const newPassword = body?.newPassword;

  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    throw new HttpError(400, 'Validation failed', [
      { field: 'currentPassword', message: 'currentPassword is required' },
    ]);
  }

  if (typeof newPassword !== 'string' || newPassword.length === 0) {
    throw new HttpError(400, 'Validation failed', [
      { field: 'newPassword', message: 'newPassword is required' },
    ]);
  }

  if (newPassword === currentPassword) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'newPassword',
        message: 'newPassword must be different from currentPassword',
      },
    ]);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });

  if (!user) {
    throw new HttpError(401, 'Authentication required');
  }

  const matches = await verifyPassword(currentPassword, user.passwordHash);
  if (!matches) {
    throw new HttpError(403, 'Current password is incorrect');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    }),
    // Keep the current session; end other devices.
    prisma.session.deleteMany({
      where: {
        userId,
        ...(sessionId
          ? {
              id: { not: sessionId },
            }
          : {}),
      },
    }),
  ]);

  return { changed: true };
}

export async function deleteAccount(userId, body) {
  const password = body?.password;

  if (typeof password !== 'string' || password.length === 0) {
    throw new HttpError(400, 'Validation failed', [
      { field: 'password', message: 'password is required' },
    ]);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });

  if (!user) {
    throw new HttpError(401, 'Authentication required');
  }

  const matches = await verifyPassword(password, user.passwordHash);
  if (!matches) {
    throw new HttpError(403, 'Current password is incorrect');
  }

  // Cascades: sessions, journals (+ media/access), friend rows, notifications.
  await prisma.user.delete({
    where: { id: userId },
  });

  return { deleted: true };
}
