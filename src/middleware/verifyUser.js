import prisma from '../lib/prisma.js';
import env from '../config/env.js';
import { hashSessionToken } from '../utils/session.js';
import { clearSessionCookie } from '../utils/cookies.js';
import { HttpError } from '../utils/errors.js';

function authenticationRequired() {
  return new HttpError(401, 'Authentication required');
}

export default async function verifyUser(req, res, next) {
  try {
    const rawToken = req.cookies?.[env.sessionCookieName];

    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      throw authenticationRequired();
    }

    const hashedToken = hashSessionToken(rawToken);

    const session = await prisma.session.findUnique({
      where: { hashedToken },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    if (!session) {
      clearSessionCookie(res);
      throw authenticationRequired();
    }

    if (session.expiresAt <= new Date()) {
      await prisma.session.delete({
        where: { id: session.id },
      });
      clearSessionCookie(res);
      throw authenticationRequired();
    }

    req.user = {
      id: session.user.id,
      username: session.user.username,
    };

    req.session = {
      id: session.id,
      expiresAt: session.expiresAt,
    };

    next();
  } catch (error) {
    next(error);
  }
}
