import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { writeLimiter } from '../middleware/rateLimiter';
import { supabaseAdmin } from '../services/supabase';
import { banService } from '../services/banService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

const cancelBookingSchema = z.object({
  reason: z.string().min(5, 'Reason must be at least 5 characters').max(500),
});

// POST /api/bookings/:id/cancel - cancel booking + strike tracking
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

    // 5. Log the cancellation
    await supabaseAdmin.from('cancellation_log').insert({
      user_id: userId,
      booking_id: bookingId,
      reason: body.reason,
      cancelled_by: isClient ? 'client' : 'provider',
    });

    // 6. Check for ban
    const strikeResult = await banService.recordCancellation(userId);

    res.json({
      success: true,
      data: updated,
      message: `Booking cancelled. ${strikeResult.message}`,
      ban: strikeResult.banned
        ? { type: strikeResult.banType, message: strikeResult.message }
        : null,
    });
  })
);

export default router;
