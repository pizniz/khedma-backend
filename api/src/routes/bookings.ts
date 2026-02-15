import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { writeLimiter } from '../middleware/rateLimiter';
import { supabaseAdmin } from '../services/supabase';
import { banService } from '../services/banService';
import { bookingService } from '../services/bookingService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

// ─── Validation Schemas ─────────────────────────────────────

const createBookingSchema = z.object({
  provider_id: z.string().uuid('Invalid provider ID'),
  service_category: z.string().min(1, 'Service category is required'),
  description: z.string().max(1000).optional(),
  scheduled_date: z.string().optional(),
});

const listBookingsQuerySchema = z.object({
  status: z.enum(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const updateStatusSchema = z.object({
  status: z.enum(['confirmed', 'completed']),
});

const cancelBookingSchema = z.object({
  reason: z.string().min(5, 'Reason must be at least 5 characters').max(500),
});

// ─── POST /api/bookings - Create a new booking ─────────────

router.post(
  '/',
  authMiddleware as any,
  writeLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = createBookingSchema.parse(req.body);

    const booking = await bookingService.createBooking({
      client_id: req.user.id,
      provider_id: body.provider_id,
      service_category: body.service_category,
      description: body.description,
      scheduled_date: body.scheduled_date,
    });

    res.status(201).json({
      success: true,
      data: booking,
      message: 'Booking created successfully.',
    });
  })
);

// ─── GET /api/bookings - List user's bookings ───────────────

router.get(
  '/',
  authMiddleware as any,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const query = listBookingsQuerySchema.parse(req.query);

    const { bookings, total } = await bookingService.listBookings({
      userId: req.user.id,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });

    const totalPages = Math.ceil(total / query.limit);

    res.json({
      success: true,
      data: bookings,
      pagination: { page: query.page, limit: query.limit, total, totalPages },
    });
  })
);

// ─── PATCH /api/bookings/:id/status - Update booking status ─

router.patch(
  '/:id/status',
  authMiddleware as any,
  writeLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id: bookingId } = req.params;
    const body = updateStatusSchema.parse(req.body);

    const updated = await bookingService.updateBookingStatus(
      bookingId,
      req.user.id,
      body.status
    );

    res.json({
      success: true,
      data: updated,
      message: `Booking ${body.status} successfully.`,
    });
  })
);

// ─── POST /api/bookings/:id/cancel - Cancel booking + strike tracking ─

router.post(
  '/:id/cancel',
  authMiddleware as any,
  writeLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id: bookingId } = req.params;
    const body = cancelBookingSchema.parse(req.body);
    const userId = req.user.id;

    // 1. Fetch the booking
    const { data: booking, error: fetchError } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (fetchError || !booking) {
      throw new AppError('Booking not found', 404);
    }

    // 2. Verify user is a participant
    const isClient = booking.client_id === userId;
    const isProvider = booking.provider_id === userId;

    if (!isClient && !isProvider) {
      throw new AppError('You are not authorized to cancel this booking', 403);
    }

    // 3. Only pending/confirmed/in_progress can be cancelled
    const cancellableStatuses = ['pending', 'confirmed', 'in_progress'];
    if (!cancellableStatuses.includes(booking.status)) {
      throw new AppError(
        `Cannot cancel a "${booking.status}" booking. Only pending, confirmed, or in-progress bookings can be cancelled.`,
        400
      );
    }

    // 4. Update booking status
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('bookings')
      .update({
        status: 'cancelled',
        notes: `Cancelled: ${body.reason}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .select()
      .single();

    if (updateError || !updated) {
      throw new AppError('Failed to cancel booking', 500);
    }

    // 5. Log cancellation + check ban thresholds (all-in-one)
    const strikeResult = await banService.logCancellation(
      userId,
      bookingId,
      body.reason
    );

    res.json({
      success: true,
      data: updated,
      message: `Booking cancelled. ${strikeResult.message}`,
      cancelled_by: isClient ? 'client' : 'provider',
      ban: strikeResult.banned
        ? {
            type: strikeResult.banType,
            expires_at: strikeResult.banType === 'temporary'
              ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
              : null,
            message: strikeResult.message,
          }
        : null,
    });
  })
);

export default router;
