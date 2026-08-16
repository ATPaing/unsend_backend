import { Router } from 'express';
import { signup, login, getSession, logout } from '../controllers/auth.controller.js';
import verifyUser from '../middleware/verifyUser.js';

const router = Router();

router.post('/signup', signup);
router.post('/login', login);
router.get('/session', verifyUser, getSession);
router.post('/logout', verifyUser, logout);

export default router;
