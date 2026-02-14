import { Router, Response, NextFunction } from 'express';
import { banService } from '../services/banService';
import type { AuthenticatedRequest } from '../types';

import healthRouter from './health';
import providersRouter from './providers';
import reviewsRouter from './reviews';
import bookingsRouter from './bookings';
import subscriptionsRouter from './subscriptions';

const router = Router();

// Ban-check middleware - blocks banned users on authenticated routes
async function banCheck(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    next();
    return;
  }

  try {
    const activeBan = await banService.getActiveBan(req.user.id);

    if (activeBan) {
      const message =
        activeBan.ban_type === 'permanent'
          ? 'Your account has been permanently banned.'
          : `Your account is temporarily banned until ${activeBan.banned_until}.`;

      res.status(403).json({
        success: false,
        error: 'Account banned',
        message,
        ban: {
          type: activeBan.ban_type,
          reason: activeBan.reason,
          expires_at: activeBan.banned_until,
        },
      });
      return;
    }
  } catch (err) {
    console.error('[BanCheck] Error:', err);
    // Fail open - don't block if ban check fails
  }

  next();
}

router.use('/health', healthRouter);
router.use('/providers', banCheck as any, providersRouter);
router.use('/reviews', banCheck as any, reviewsRouter);
router.use('/bookings', banCheck as any, bookingsRouter);
router.use('/subscriptions', banCheck as any, subscriptionsRouter);

export default router;
