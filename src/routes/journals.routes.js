import { Router } from 'express';
import {
  createJournal,
  deleteJournal,
  getJournal,
  listJournals,
  listSharedWithMe,
  revokeJournalShare,
  shareJournal,
  updateJournal,
  updateJournalUnlockAt,
} from '../controllers/journal.controller.js';
import {
  confirmMediaUpload,
  createMediaUploadUrl,
  getMediaDownloadUrl,
} from '../controllers/media.controller.js';
import verifyUser from '../middleware/verifyUser.js';

const router = Router();

router.post('/', verifyUser, createJournal);
router.get('/', verifyUser, listJournals);
router.get('/shared-with-me', verifyUser, listSharedWithMe);

router.post('/:journalId/share', verifyUser, shareJournal);
router.delete('/:journalId/share/:userId', verifyUser, revokeJournalShare);
router.patch('/:journalId/unlock-at', verifyUser, updateJournalUnlockAt);

router.post('/:journalId/media/upload-url', verifyUser, createMediaUploadUrl);
router.get('/:journalId/media/download-url', verifyUser, getMediaDownloadUrl);
router.post(
  '/:journalId/media/:mediaId/confirm',
  verifyUser,
  confirmMediaUpload,
);

router.get('/:journalId', verifyUser, getJournal);
router.patch('/:journalId', verifyUser, updateJournal);
router.delete('/:journalId', verifyUser, deleteJournal);

export default router;
