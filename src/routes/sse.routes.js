import { Router } from 'express';
import { streamEvents } from '../controllers/sse.controller.js';
import verifyUser from '../middleware/verifyUser.js';

const router = Router();

router.get('/events', verifyUser, streamEvents);

export default router;
