import { HttpError } from '../utils/errors.js';

/**
 * Requires verifyUser to have already set req.user (including isAdmin).
 * Does not query the database.
 */
export default function verifyAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return next(new HttpError(403, 'Admin access required'));
  }

  next();
}
