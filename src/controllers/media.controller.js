import * as mediaService from '../services/media.service.js';

export async function createMediaUploadUrl(req, res, next) {
  try {
    const result = await mediaService.createMediaUploadUrl(
      req.user.id,
      req.params.journalId,
      req.body,
    );

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function confirmMediaUpload(req, res, next) {
  try {
    const result = await mediaService.confirmMediaUpload(
      req.user.id,
      req.params.journalId,
      req.params.mediaId,
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getMediaDownloadUrl(req, res, next) {
  try {
    const result = await mediaService.getMediaDownloadUrl(
      req.user.id,
      req.params.journalId,
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}
