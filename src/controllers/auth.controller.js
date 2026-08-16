import * as authService from '../services/auth.service.js';
import { setSessionCookie, clearSessionCookie } from '../utils/cookies.js';

export async function signup(req, res, next) {
  try {
    const result = await authService.signup(req.body);

    setSessionCookie(res, result.sessionToken);

    res.status(201).json({
      success: true,
      data: {
        user: result.user,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
    try {
      
    const result = await authService.login(req.body);

    setSessionCookie(res, result.sessionToken);

    res.status(200).json({
      success: true,
      data: {
        user: result.user,
      },
    });
  } catch (error) {
    next(error);
  }
}

export function getSession(req, res) {
  res.status(200).json({
    success: true,
    data: {
      user: req.user,
    },
  });
}

export async function logout(req, res, next) {
  try {
    await authService.logout(req.session.id);
    clearSessionCookie(res);

    res.status(200).json({
      success: true,
      data: {
        message: 'Logged out successfully',
      },
    });
  } catch (error) {
    next(error);
  }
}
