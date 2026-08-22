import { Router } from 'express';
import healthRouter from './health.js';
import authRouter from './auth.routes.js';
import usersRouter from './users.routes.js';
import journalsRouter from './journals.routes.js';
import friendsRouter from './friends.routes.js';
import notificationsRouter from './notifications.routes.js';
import sseRouter from './sse.routes.js';
import adminRouter from './admin.routes.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/api/auth', authRouter);
router.use('/api/users', usersRouter);
router.use('/api/journals', journalsRouter);
router.use('/api/friends', friendsRouter);
router.use('/api/notifications', notificationsRouter);
router.use('/api/sse', sseRouter);
router.use('/api/admin', adminRouter);

export default router;
