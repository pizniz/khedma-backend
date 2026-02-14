import { supabaseAdmin } from './supabase';
import { AppError } from '../middleware/errorHandler';
import type { Review } from '../types';

interface CreateReviewInput {
  bookingId: string;
  clientId: string;
  rating: number;
  comment?: string;
}

class ReviewService {
  async createReview(input: CreateReviewInput): Promise<Review> {
    const { bookingId, clientId, rating, comment } = input;

    // 1. Fetch the booking
    const { data: booking, error: bookingError } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking) {
      throw new AppError('Booking not found', 404);
    }

    // 2. Verify booking is completed
    if (booking.status !== 'completed') {
      throw new AppError(
        `Reviews can only be submitted for completed bookings. This booking is "${booking.status}".`,
        400
      );
    }

    // 3. Verify the reviewer is the client
    if (booking.client_id !== clientId) {
      throw new AppError('Only the client of a booking can leave a review', 403);
    }

    // 4. Check for existing review
    const { data: existingReview } = await supabaseAdmin
      .from('reviews')
      .select('id')
      .eq('booking_id', bookingId)
      .single();

    if (existingReview) {
      throw new AppError('A review already exists for this booking', 409);
    }

    // 5. Create the review
    const { data: review, error: reviewError } = await supabaseAdmin
      .from('reviews')
      .insert({
        reviewer_id: clientId,
        provider_id: booking.provider_id,
        booking_id: bookingId,
        rating,
        comment: comment || null,
      })
      .select()
      .single();

    if (reviewError || !review) {
      console.error('[ReviewService] Error creating review:', reviewError);
      throw new AppError('Failed to create review', 500);
    }

    return review as Review;
  }

  async getProviderReviews(
    providerId: string,
    page: number,
    limit: number
  ): Promise<{ reviews: Review[]; total: number }> {
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from('reviews')
      .select('*, profiles!reviewer_id(full_name)', { count: 'exact' })
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[ReviewService] Error fetching reviews:', error);
      throw new AppError('Failed to fetch reviews', 500);
    }

    const reviews = (data || []).map((r: any) => ({
      ...r,
      reviewer_name: r.profiles?.full_name || 'Anonymous',
      profiles: undefined,
    })) as Review[];

    return { reviews, total: count || 0 };
  }
}

export const reviewService = new ReviewService();
