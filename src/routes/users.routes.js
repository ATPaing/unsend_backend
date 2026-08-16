import { Router } from 'express';
import {
  changeMyPassword,
  deleteMyAccount,
  getMyCrypto,
  updateMyCrypto,
} from '../controllers/user.controller.js';
import verifyUser from '../middleware/verifyUser.js';

const router = Router();

router.get('/me/crypto', verifyUser, getMyCrypto);
router.patch('/me/crypto', verifyUser, updateMyCrypto);
router.patch('/me/password', verifyUser, changeMyPassword);
router.delete('/me', verifyUser, deleteMyAccount);

export default router;
