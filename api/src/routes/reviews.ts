import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { writeLimiter } from '../middleware/rateLimiter';
import { reviewService } from '../services/reviewService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

const createReviewSchema = z.object({
  booking_id: z.string().uuid('Invalid booking ID'),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

const reviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// POST /api/reviews - create review (auth required, completion enforced)
router.post(
  '/',
  authMiddleware as any,
  writeLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = createReviewSchema.parse(req.body);

    const review = await reviewService.createReview({
      bookingId: body.booking_id,
      clientId: req.user.id,
      rating: body.rating,
      comment: body.comment,
    });

    res.status(201).json({
      success: true,
      data: review,
      message: 'Review submitted successfully.',
    });
  })
);

// GET /api/reviews/:providerId - get provider reviews (public)
router.get(
  '/:providerId',
  asyncHandler(async (req, res: Response) => {
    const { providerId } = req.params;
    const query = reviewsQuerySchema.parse(req.query);

    const { reviews, total } = await reviewService.getProviderReviews(
      providerId,
      query.page,
      query.limit
    );

    res.json({
      success: true,
      data: reviews,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    });
  })
);

export default router;
