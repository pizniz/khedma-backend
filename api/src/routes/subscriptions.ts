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

// Accept both 'plan' short names and full plan_type names from the frontend
function normalizePlanType(plan?: string, planType?: string): string {
  const value = planType || plan || 'specialist_monthly';
  if (value === 'monthly') return 'specialist_monthly';
  if (value === 'yearly') return 'specialist_yearly';
  return value;
}

// POST /api/subscriptions - create subscription
router.post(
  '/',
  authMiddleware as any,
  writeLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Normalize: accept { plan: 'monthly' } or { plan_type: 'specialist_monthly' }
    const planType = normalizePlanType(req.body.plan, req.body.plan_type);
    const body = createSubscriptionSchema.parse({
      ...req.body,
      plan_type: planType,
    });

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

// POST /api/subscriptions/cancel - cancel subscription
router.post(
  '/cancel',
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

// DELETE /api/subscriptions - cancel subscription (legacy)
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
