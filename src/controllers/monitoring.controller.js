import * as monitoringService from '../services/monitoring.service.js';

export async function getMonitoringOverview(req, res, next) {
  try {
    const overview = await monitoringService.getOverview();

    res.status(200).json({
      success: true,
      data: overview,
    });
  } catch (error) {
    next(error);
  }
}
