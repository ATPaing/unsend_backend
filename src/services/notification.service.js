import prisma from '../lib/prisma.js';
import { HttpError } from '../utils/errors.js';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

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

function parsePositiveInt(value, notFoundMessage) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(404, notFoundMessage);
  }

  return id;
}

function parseListLimit(rawLimit) {
  if (rawLimit === undefined || rawLimit === null || rawLimit === '') {
    return DEFAULT_LIST_LIMIT;
  }

  const limit = Number(rawLimit);

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new HttpError(400, 'Validation failed', [
      { field: 'limit', message: 'limit must be a positive integer' },
    ]);
  }

  return Math.min(limit, MAX_LIST_LIMIT);
}

function toNotificationResponse(notification) {
  return {
    id: notification.id,
    type: notification.type,
    isRead: notification.isRead,
    journalId: notification.journalId,
    createdAt: notification.createdAt,
    actor: toPublicUser(notification.actor),
  };
}

export async function listNotifications(currentUserId, { limit: rawLimit } = {}) {
  const limit = parseListLimit(rawLimit);

  const notifications = await prisma.notification.findMany({
    where: {
      recipientId: currentUserId,
    },
    include: {
      actor: { select: PUBLIC_USER_SELECT },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return notifications.map(toNotificationResponse);
}

export async function getUnreadCount(currentUserId) {
  const unreadCount = await prisma.notification.count({
    where: {
      recipientId: currentUserId,
      isRead: false,
    },
  });

  return { unreadCount };
}

export async function markNotificationRead(currentUserId, notificationIdParam) {
  const notificationId = parsePositiveInt(
    notificationIdParam,
    'Notification not found',
  );

  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    include: {
      actor: { select: PUBLIC_USER_SELECT },
    },
  });

  if (!notification) {
    throw new HttpError(404, 'Notification not found');
  }

  if (notification.recipientId !== currentUserId) {
    throw new HttpError(403, 'You are not allowed to update this notification');
  }

  if (notification.isRead) {
    return toNotificationResponse(notification);
  }

  const updated = await prisma.notification.update({
    where: { id: notification.id },
    data: { isRead: true },
    include: {
      actor: { select: PUBLIC_USER_SELECT },
    },
  });

  return toNotificationResponse(updated);
}

export async function markAllNotificationsRead(currentUserId) {
  const result = await prisma.notification.updateMany({
    where: {
      recipientId: currentUserId,
      isRead: false,
    },
    data: {
      isRead: true,
    },
  });

  return {
    updatedCount: result.count,
  };
}
