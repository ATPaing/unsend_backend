import * as userService from '../services/user.service.js';
import { clearSessionCookie } from '../utils/cookies.js';

export async function getMyCrypto(req, res, next) {
  try {
    const crypto = await userService.getCryptoMaterial(req.user.id);

    res.status(200).json({
      success: true,
      data: crypto,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateMyCrypto(req, res, next) {
  try {
    const crypto = await userService.updateCryptoMaterial(
      req.user.id,
      req.body,
    );

    res.status(200).json({
      success: true,
      data: crypto,
    });
  } catch (error) {
    next(error);
  }
}

export async function changeMyPassword(req, res, next) {
  try {
    const result = await userService.changePassword(
      req.user.id,
      req.session?.id,
      req.body,
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteMyAccount(req, res, next) {
  try {
    const result = await userService.deleteAccount(req.user.id, req.body);
    clearSessionCookie(res);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}
