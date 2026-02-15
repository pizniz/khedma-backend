import { Router, Request, Response, NextFunction } from 'express';
import { banCheckMiddleware } from '../middleware/banCheck';
import type { AuthenticatedRequest } from '../types';

import healthRouter from './health';
import providersRouter from './providers';
import reviewsRouter from './reviews';
import bookingsRouter from './bookings';
import subscriptionsRouter from './subscriptions';
import chatRouter from './chat';
import uploadsRouter from './uploads';
import favoritesRouter from './favorites';

const router = Router();

// ─── Write-only ban check ───────────────────────────────────
// Applies banCheckMiddleware only to write operations (POST, PUT, PATCH, DELETE).
// GET requests pass through — banned users can still browse.
function banCheckWriteOnly(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];

  if (writeMethods.includes(req.method.toUpperCase())) {
    banCheckMiddleware(req as AuthenticatedRequest, res, next);
    return;
  }

  // GET and other read methods skip ban check
  next();
}

// ─── Route Registration ─────────────────────────────────────

// Health check — no ban check at all
router.use('/health', healthRouter);

// All other routes get write-only ban check
router.use('/providers', banCheckWriteOnly, providersRouter);
router.use('/reviews', banCheckWriteOnly, reviewsRouter);
router.use('/bookings', banCheckWriteOnly, bookingsRouter);
router.use('/subscriptions', banCheckWriteOnly, subscriptionsRouter);
router.use('/conversations', banCheckWriteOnly, chatRouter);
router.use('/uploads', banCheckWriteOnly, uploadsRouter);
router.use('/favorites', banCheckWriteOnly, favoritesRouter);

export default router;
