import { Router } from 'express';
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../controllers/notification.controller.js';
import verifyUser from '../middleware/verifyUser.js';

const router = Router();

router.get('/unread-count', verifyUser, getUnreadCount);
router.post('/read-all', verifyUser, markAllNotificationsRead);
router.patch('/:notificationId/read', verifyUser, markNotificationRead);
router.get('/', verifyUser, listNotifications);

export default router;
