import { Router } from 'express';
import {
  acceptFriendRequest,
  deleteFriendRequest,
  getFriendPublicKey,
  listFriends,
  listIncomingRequests,
  listOutgoingRequests,
  removeFriend,
  searchUsers,
  sendFriendRequest,
} from '../controllers/friend.controller.js';
import verifyUser from '../middleware/verifyUser.js';

const router = Router();

router.get('/search', verifyUser, searchUsers);

router.get('/requests/incoming', verifyUser, listIncomingRequests);
router.get('/requests/outgoing', verifyUser, listOutgoingRequests);

router.post('/requests/:userId', verifyUser, sendFriendRequest);
router.post('/requests/:requestId/accept', verifyUser, acceptFriendRequest);
router.delete('/requests/:requestId', verifyUser, deleteFriendRequest);

router.get('/', verifyUser, listFriends);
router.get('/:friendId/public-key', verifyUser, getFriendPublicKey);
router.delete('/:friendId', verifyUser, removeFriend);

export default router;
