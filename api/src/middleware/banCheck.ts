import { Response, NextFunction } from 'express';
import { banService } from '../services/banService';
import type { AuthenticatedRequest } from '../types';

/**
 * Ban check middleware.
 * Runs AFTER authMiddleware on protected routes.
 * Calls banService.checkBan(req.user.id) — single DB query.
 *
 * If banned: returns 403 with ban type, expiry, and reason.
 * If not authenticated (no req.user), passes through silently.
 */
export async function banCheckMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip if not authenticated (banCheck only applies to authed users)
  if (!req.user) {
    next();
    return;
  }

  try {
    const result = await banService.checkBan(req.user.id);

    if (result.banned && result.ban) {
      const message =
        result.ban.type === 'permanent'
          ? 'Your account has been permanently banned.'
          : `Your account is temporarily banned until ${result.ban.expires_at}.`;

      res.status(403).json({
        success: false,
        error: message,
        banned: true,
        ban: {
          type: result.ban.type,
          expires_at: result.ban.expires_at,
          reason: result.ban.reason,
        },
      });
      return;
    }
  } catch (err) {
    console.error('[BanCheck] Error checking ban status:', err);
    // Fail open — don't block users if the ban check itself fails
  }

  next();
}
