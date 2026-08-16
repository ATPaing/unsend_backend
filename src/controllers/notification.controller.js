import * as notificationService from '../services/notification.service.js';

export async function listNotifications(req, res, next) {
  try {
    const notifications = await notificationService.listNotifications(
      req.user.id,
      { limit: req.query.limit },
    );

    res.status(200).json({
      success: true,
      data: {
        notifications,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getUnreadCount(req, res, next) {
  try {
    const result = await notificationService.getUnreadCount(req.user.id);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function markNotificationRead(req, res, next) {
  try {
    const notification = await notificationService.markNotificationRead(
      req.user.id,
      req.params.notificationId,
    );

    res.status(200).json({
      success: true,
      data: {
        notification,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function markAllNotificationsRead(req, res, next) {
  try {
    const result = await notificationService.markAllNotificationsRead(
      req.user.id,
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}
