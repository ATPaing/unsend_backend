import { Router } from 'express';
import verifyUser from '../middleware/verifyUser.js';
import verifyAdmin from '../middleware/verifyAdmin.js';
import { getMonitoringOverview } from '../controllers/monitoring.controller.js';

const router = Router();

router.get(
  '/monitoring/overview',
  verifyUser,
  verifyAdmin,
  getMonitoringOverview,
);

export default router;
