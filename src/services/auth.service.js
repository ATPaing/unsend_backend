import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { createSessionCredentials } from '../utils/session.js';
import { normalizeUsername } from '../utils/username.js';
import { decodeBase64 } from '../utils/base64.js';
import { HttpError } from '../utils/errors.js';

function toSafeUser(user) {
  return {
    id: user.id,
    username: user.username,
  };
}

function decodeCryptoField(field, value) {
  try {
    return decodeBase64(value);
  } catch {
    throw new HttpError(400, 'Validation failed', [
      {
        field,
        message: `${field} must be valid Base64`,
      },
    ]);
  }
}

function decodeSignupCrypto(crypto) {
  if (!crypto || typeof crypto !== 'object') {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'crypto',
        message: 'Crypto data is required',
      },
    ]);
  }

  const requiredFields = [
    'publicKey',
    'encryptedPrivateKey',
    'privateKeyNonce',
    'derivedKeySalt',
  ];

  for (const field of requiredFields) {
    if (typeof crypto[field] !== 'string' || crypto[field].length === 0) {
      throw new HttpError(400, 'Validation failed', [
        {
          field: `crypto.${field}`,
          message: `${field} is required`,
        },
      ]);
    }
  }

  if (typeof crypto.cryptoVersion !== 'number' || !Number.isInteger(crypto.cryptoVersion)) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'crypto.cryptoVersion',
        message: 'cryptoVersion must be an integer',
      },
    ]);
  }

  return {
    publicKey: decodeCryptoField('crypto.publicKey', crypto.publicKey),
    encryptedPrivateKey: decodeCryptoField(
      'crypto.encryptedPrivateKey',
      crypto.encryptedPrivateKey,
    ),
    privateKeyNonce: decodeCryptoField('crypto.privateKeyNonce', crypto.privateKeyNonce),
    derivedKeySalt: decodeCryptoField('crypto.derivedKeySalt', crypto.derivedKeySalt),
    cryptoVersion: crypto.cryptoVersion,
  };
}

function invalidCredentialsError() {
  return new HttpError(401, 'Invalid username or password');
}

export async function signup(data) {

  const username = typeof data?.username === 'string' ? data.username.trim() : '';
  const password = data?.password;
  const normalized = normalizeUsername(username);
  const cryptoFields = decodeSignupCrypto(data?.crypto);

  if (!username) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'username',
        message: 'Username is required',
      },
    ]);
  }

  if (typeof password !== 'string' || password.length === 0) {
    throw new HttpError(400, 'Validation failed', [
      {
        field: 'password',
        message: 'Password is required',
      },
    ]);
  }

  const existingUser = await prisma.user.findUnique({
    where: { normalizedUsername: normalized },
    select: { id: true },
  });

  if (existingUser) {
    throw new HttpError(409, 'Username is already taken');
  }

  const passwordHash = await hashPassword(password);
  const session = createSessionCredentials();

  try {
    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          username,
          normalizedUsername: normalized,
          passwordHash,
          publicKey: cryptoFields.publicKey,
          encryptedPrivateKey: cryptoFields.encryptedPrivateKey,
          privateKeyNonce: cryptoFields.privateKeyNonce,
          derivedKeySalt: cryptoFields.derivedKeySalt,
          cryptoVersion: cryptoFields.cryptoVersion,
        },
      });

      await tx.session.create({
        data: {
          userId: createdUser.id,
          hashedToken: session.hashedToken,
          expiresAt: session.expiresAt,
        },
      });

      return createdUser;
    });

    return {
      user: toSafeUser(user),
      sessionToken: session.token,
      expiresAt: session.expiresAt,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new HttpError(409, 'Username is already taken');
    }

    throw error;
  }
}

export async function login(data) {
  const username = typeof data?.username === 'string' ? data.username : '';
  const password = data?.password;
  const normalized = normalizeUsername(username);

  if (!normalized || typeof password !== 'string' || password.length === 0) {
    throw invalidCredentialsError();
  }

  const user = await prisma.user.findUnique({
    where: { normalizedUsername: normalized },
  });

  if (!user) {
    throw invalidCredentialsError();
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);

  if (!passwordMatches) {
    throw invalidCredentialsError();
  }

  const session = createSessionCredentials();

  await prisma.session.create({
    data: {
      userId: user.id,
      hashedToken: session.hashedToken,
      expiresAt: session.expiresAt,
    },
  });

  return {
    user: toSafeUser(user),
    sessionToken: session.token,
    expiresAt: session.expiresAt,
  };
}

export async function logout(sessionId) {
  await prisma.session.deleteMany({
    where: { id: sessionId },
  });
}
