import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { encodeBase64 } from '../utils/base64.js';
import { HttpError } from '../utils/errors.js';
import { normalizeUsername } from '../utils/username.js';
import { sendToUser } from './realtime.service.js';

const SEARCH_LIMIT = 20;

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

function orderedPair(userId1, userId2) {
  return {
    userAId: Math.min(userId1, userId2),
    userBId: Math.max(userId1, userId2),
  };
}

function parsePositiveInt(value, notFoundMessage) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(404, notFoundMessage);
  }

  return id;
}

function isUniqueConstraintError(error) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function otherUserFromFriendship(friendship, currentUserId) {
  return friendship.userAId === currentUserId
    ? friendship.userB
    : friendship.userA;
}

function otherUserIdFromRequest(request, currentUserId) {
  return request.userAId === currentUserId ? request.userBId : request.userAId;
}

async function findFriendshipBetween(userId1, userId2, client = prisma) {
  const pair = orderedPair(userId1, userId2);

  return client.friendship.findUnique({
    where: {
      userAId_userBId: pair,
    },
  });
}

async function findFriendRequestBetween(userId1, userId2, client = prisma) {
  const pair = orderedPair(userId1, userId2);

  return client.friendRequest.findUnique({
    where: {
      userAId_userBId: pair,
    },
  });
}

function relationshipFromRecords(currentUserId, otherUserId, friendship, request) {
  if (friendship) {
    return 'FRIEND';
  }

  if (!request) {
    return 'NONE';
  }

  if (request.initiatorId === currentUserId) {
    return 'REQUEST_SENT';
  }

  if (request.initiatorId === otherUserId) {
    return 'REQUEST_RECEIVED';
  }

  return 'NONE';
}

export async function searchUsers(currentUserId, query) {
  const rawQuery = typeof query === 'string' ? query : '';
  const normalized = normalizeUsername(rawQuery);

  if (!normalized) {
    return [];
  }

  const users = await prisma.user.findMany({
    where: {
      id: { not: currentUserId },
      normalizedUsername: {
        contains: normalized,
      },
    },
    select: PUBLIC_USER_SELECT,
    orderBy: { normalizedUsername: 'asc' },
    take: SEARCH_LIMIT,
  });

  if (users.length === 0) {
    return [];
  }

  const otherIds = users.map((user) => user.id);

  const [friendships, requests] = await Promise.all([
    prisma.friendship.findMany({
      where: {
        OR: [
          { userAId: currentUserId, userBId: { in: otherIds } },
          { userBId: currentUserId, userAId: { in: otherIds } },
        ],
      },
    }),
    prisma.friendRequest.findMany({
      where: {
        OR: [
          { userAId: currentUserId, userBId: { in: otherIds } },
          { userBId: currentUserId, userAId: { in: otherIds } },
        ],
      },
    }),
  ]);

  const friendshipByOtherId = new Map();
  for (const friendship of friendships) {
    const otherId =
      friendship.userAId === currentUserId
        ? friendship.userBId
        : friendship.userAId;
    friendshipByOtherId.set(otherId, friendship);
  }

  const requestByOtherId = new Map();
  for (const request of requests) {
    const otherId =
      request.userAId === currentUserId ? request.userBId : request.userAId;
    requestByOtherId.set(otherId, request);
  }

  return users.map((user) => ({
    ...toPublicUser(user),
    relationship: relationshipFromRecords(
      currentUserId,
      user.id,
      friendshipByOtherId.get(user.id) ?? null,
      requestByOtherId.get(user.id) ?? null,
    ),
  }));
}

export async function sendFriendRequest(currentUserId, targetUserIdParam) {
  const targetUserId = parsePositiveInt(targetUserIdParam, 'User not found');

  if (targetUserId === currentUserId) {
    throw new HttpError(400, 'You cannot send a friend request to yourself');
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: PUBLIC_USER_SELECT,
  });

  if (!targetUser) {
    throw new HttpError(404, 'User not found');
  }

  const existingFriendship = await findFriendshipBetween(
    currentUserId,
    targetUserId,
  );

  if (existingFriendship) {
    throw new HttpError(409, 'You are already friends with this user');
  }

  const existingRequest = await findFriendRequestBetween(
    currentUserId,
    targetUserId,
  );

  if (existingRequest) {
    if (existingRequest.initiatorId === currentUserId) {
      throw new HttpError(409, 'Friend request already sent');
    }

    throw new HttpError(
      409,
      'This user has already sent you a friend request',
    );
  }

  const pair = orderedPair(currentUserId, targetUserId);

  try {
    const { request, notification } = await prisma.$transaction(async (tx) => {
      const created = await tx.friendRequest.create({
        data: {
          userAId: pair.userAId,
          userBId: pair.userBId,
          initiatorId: currentUserId,
        },
        include: {
          initiator: { select: PUBLIC_USER_SELECT },
        },
      });

      const createdNotification = await tx.notification.create({
        data: {
          recipientId: targetUserId,
          actorId: currentUserId,
          type: 'FRI_REQ',
        },
        include: {
          actor: { select: PUBLIC_USER_SELECT },
        },
      });

      return { request: created, notification: createdNotification };
    });

    sendToUser(targetUserId, 'friend.requested', {
      request: {
        id: request.id,
        createdAt: request.createdAt,
        sender: toPublicUser(request.initiator),
      },
      notification: toNotificationPayload(notification),
    });

    return {
      id: request.id,
      createdAt: request.createdAt,
      recipient: toPublicUser(targetUser),
    };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const [raceFriendship, raceRequest] = await Promise.all([
      findFriendshipBetween(currentUserId, targetUserId),
      findFriendRequestBetween(currentUserId, targetUserId),
    ]);

    if (raceFriendship) {
      throw new HttpError(409, 'You are already friends with this user');
    }

    if (raceRequest?.initiatorId === currentUserId) {
      throw new HttpError(409, 'Friend request already sent');
    }

    if (raceRequest) {
      throw new HttpError(
        409,
        'This user has already sent you a friend request',
      );
    }

    throw new HttpError(409, 'Friend request could not be created');
  }
}

export async function listIncomingRequests(currentUserId) {
  const requests = await prisma.friendRequest.findMany({
    where: {
      OR: [{ userAId: currentUserId }, { userBId: currentUserId }],
      NOT: { initiatorId: currentUserId },
    },
    include: {
      initiator: { select: PUBLIC_USER_SELECT },
    },
    orderBy: { createdAt: 'desc' },
  });

  return requests.map((request) => ({
    id: request.id,
    createdAt: request.createdAt,
    sender: toPublicUser(request.initiator),
  }));
}

export async function listOutgoingRequests(currentUserId) {
  const requests = await prisma.friendRequest.findMany({
    where: {
      initiatorId: currentUserId,
    },
    include: {
      userA: { select: PUBLIC_USER_SELECT },
      userB: { select: PUBLIC_USER_SELECT },
    },
    orderBy: { createdAt: 'desc' },
  });

  return requests.map((request) => {
    const recipient =
      request.initiatorId === request.userAId ? request.userB : request.userA;

    return {
      id: request.id,
      createdAt: request.createdAt,
      recipient: toPublicUser(recipient),
    };
  });
}

export async function acceptFriendRequest(currentUserId, requestIdParam) {
  const requestId = parsePositiveInt(requestIdParam, 'Friend request not found');

  const request = await prisma.friendRequest.findUnique({
    where: { id: requestId },
  });

  if (!request) {
    throw new HttpError(404, 'Friend request not found');
  }

  if (
    request.userAId !== currentUserId &&
    request.userBId !== currentUserId
  ) {
    throw new HttpError(403, 'You are not allowed to act on this request');
  }

  if (request.initiatorId === currentUserId) {
    throw new HttpError(403, 'Only the recipient can accept this request');
  }

  const existingFriendship = await findFriendshipBetween(
    request.userAId,
    request.userBId,
  );

  if (existingFriendship) {
    throw new HttpError(409, 'You are already friends with this user');
  }

  const initiatorId = request.initiatorId;

  try {
    const { friendship, notification } = await prisma.$transaction(
      async (tx) => {
        const created = await tx.friendship.create({
          data: {
            userAId: request.userAId,
            userBId: request.userBId,
          },
          include: {
            userA: { select: PUBLIC_USER_SELECT },
            userB: { select: PUBLIC_USER_SELECT },
          },
        });

        await tx.friendRequest.delete({
          where: { id: request.id },
        });

        const createdNotification = await tx.notification.create({
          data: {
            recipientId: initiatorId,
            actorId: currentUserId,
            type: 'FRI_ACCEPTED',
          },
          include: {
            actor: { select: PUBLIC_USER_SELECT },
          },
        });

        return { friendship: created, notification: createdNotification };
      },
    );

    sendToUser(initiatorId, 'friend.accepted', {
      requestId: request.id,
      friendship: {
        friendshipId: friendship.id,
        user: toPublicUser(otherUserFromFriendship(friendship, initiatorId)),
        createdAt: friendship.createdAt,
      },
      notification: toNotificationPayload(notification),
    });

    return {
      friendshipId: friendship.id,
      user: toPublicUser(otherUserFromFriendship(friendship, currentUserId)),
      createdAt: friendship.createdAt,
    };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    throw new HttpError(409, 'You are already friends with this user');
  }
}

export async function deleteFriendRequest(currentUserId, requestIdParam) {
  const requestId = parsePositiveInt(requestIdParam, 'Friend request not found');

  const request = await prisma.friendRequest.findUnique({
    where: { id: requestId },
    include: {
      initiator: { select: PUBLIC_USER_SELECT },
      userA: { select: PUBLIC_USER_SELECT },
      userB: { select: PUBLIC_USER_SELECT },
    },
  });

  if (!request) {
    throw new HttpError(404, 'Friend request not found');
  }

  if (
    request.userAId !== currentUserId &&
    request.userBId !== currentUserId
  ) {
    throw new HttpError(403, 'You are not allowed to act on this request');
  }

  await prisma.friendRequest.delete({
    where: { id: request.id },
  });

  const action =
    request.initiatorId === currentUserId ? 'cancelled' : 'declined';
  const actor =
    request.userAId === currentUserId ? request.userA : request.userB;
  const otherUserId = otherUserIdFromRequest(request, currentUserId);

  if (action === 'cancelled') {
    sendToUser(otherUserId, 'friend.request.cancelled', {
      requestId: request.id,
      cancelledBy: toPublicUser(actor),
    });
  } else {
    sendToUser(request.initiatorId, 'friend.declined', {
      requestId: request.id,
      declinedBy: toPublicUser(actor),
    });
  }

  return {
    id: request.id,
    action,
  };
}

export async function listFriends(currentUserId) {
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [{ userAId: currentUserId }, { userBId: currentUserId }],
    },
    include: {
      userA: { select: PUBLIC_USER_SELECT },
      userB: { select: PUBLIC_USER_SELECT },
    },
    orderBy: { createdAt: 'desc' },
  });

  return friendships.map((friendship) => ({
    friendshipId: friendship.id,
    user: toPublicUser(otherUserFromFriendship(friendship, currentUserId)),
    createdAt: friendship.createdAt,
  }));
}

export async function removeFriend(currentUserId, friendIdParam) {
  const friendId = parsePositiveInt(friendIdParam, 'Friendship not found');

  if (friendId === currentUserId) {
    throw new HttpError(400, 'You cannot remove yourself as a friend');
  }

  const pair = orderedPair(currentUserId, friendId);

  const friendship = await prisma.friendship.findUnique({
    where: {
      userAId_userBId: pair,
    },
    include: {
      userA: { select: PUBLIC_USER_SELECT },
      userB: { select: PUBLIC_USER_SELECT },
    },
  });

  if (!friendship) {
    throw new HttpError(404, 'Friendship not found');
  }

  await prisma.friendship.delete({
    where: { id: friendship.id },
  });

  const removedBy =
    friendship.userAId === currentUserId ? friendship.userA : friendship.userB;

  sendToUser(friendId, 'friend.removed', {
    friendshipId: friendship.id,
    friendId: currentUserId,
    removedBy: toPublicUser(removedBy),
  });

  return {
    friendshipId: friendship.id,
    friendId,
  };
}

export async function getFriendPublicKey(currentUserId, friendIdParam) {
  const friendId = parsePositiveInt(friendIdParam, 'User not found');

  if (friendId === currentUserId) {
    throw new HttpError(
      400,
      'Use /api/users/me/crypto to retrieve your own public key',
    );
  }

  const friend = await prisma.user.findUnique({
    where: { id: friendId },
    select: {
      id: true,
      username: true,
      publicKey: true,
      cryptoVersion: true,
    },
  });

  if (!friend) {
    throw new HttpError(404, 'User not found');
  }

  const friendship = await findFriendshipBetween(currentUserId, friendId);

  if (!friendship) {
    throw new HttpError(403, 'You can only retrieve public keys for friends');
  }

  return {
    id: friend.id,
    username: friend.username,
    publicKey: encodeBase64(friend.publicKey),
    cryptoVersion: friend.cryptoVersion,
  };
}
