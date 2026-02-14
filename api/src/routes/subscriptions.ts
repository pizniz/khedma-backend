import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { writeLimiter } from '../middleware/rateLimiter';
import { subscriptionService } from '../services/subscriptionService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

const createSubscriptionSchema = z.object({
  plan_type: z.enum(['specialist_monthly', 'specialist_yearly']).default('specialist_monthly'),
  payment_method: z.string().optional(),
  payment_reference: z.string().optional(),
});

// POST /api/subscriptions - create subscription
router.post(
  '/',
  authMiddleware as any,
  writeLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = createSubscriptionSchema.parse(req.body);

    const subscription = await subscriptionService.createSubscription(
      req.user.id,
      req.user.id,
      body.plan_type,
      body.payment_method,
      body.payment_reference
    );

    res.status(201).json({
      success: true,
      data: subscription,
      message: `Subscription created. Plan: ${body.plan_type}.`,
    });
  })
);

// GET /api/subscriptions/status - check subscription status
router.get(
  '/status',
  authMiddleware as any,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const subscription = await subscriptionService.getStatus(req.user.id);

    res.json({
      success: true,
      data: subscription,
      message: subscription ? undefined : 'No subscription found.',
    });
  })
);

// DELETE /api/subscriptions - cancel subscription
router.delete(
  '/',
  authMiddleware as any,
  writeLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const cancelled = await subscriptionService.cancelSubscription(req.user.id, req.user.id);

    res.json({
      success: true,
      data: cancelled,
      message: 'Subscription cancelled. Provider tier reverted to basic.',
    });
  })
);

export default router;
