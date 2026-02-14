import { supabaseAdmin } from './supabase';
import { AppError } from '../middleware/errorHandler';
import type { Booking, BookingStatus } from '../types';

interface CreateBookingInput {
  client_id: string;
  provider_id: string;
  service_category: string;
  description?: string;
  scheduled_date?: string;
}

interface ListBookingsQuery {
  userId: string;
  status?: BookingStatus;
  page: number;
  limit: number;
}

class BookingService {
  async createBooking(input: CreateBookingInput): Promise<Booking> {
    const { client_id, provider_id, service_category, description, scheduled_date } = input;

    // Verify provider exists and is available
    const { data: provider, error: providerError } = await supabaseAdmin
      .from('profiles')
      .select('user_id, is_available, user_type')
      .eq('user_id', provider_id)
      .eq('user_type', 'provider')
      .single();

    if (providerError || !provider) {
      throw new AppError('Provider not found', 404);
    }

    if (!provider.is_available) {
      throw new AppError('Provider is not currently available', 400);
    }

    // Cannot book yourself
    if (client_id === provider_id) {
      throw new AppError('You cannot book yourself', 400);
    }

    // Optionally resolve service_id from service_category + provider
    let serviceId: string | null = null;
    if (service_category) {
      const { data: service } = await supabaseAdmin
        .from('provider_services')
        .select('id, category_id, service_categories!inner(slug)')
        .eq('provider_id', provider_id)
        .eq('service_categories.slug', service_category)
        .eq('is_active', true)
        .limit(1)
        .single();

      if (service) {
        serviceId = service.id;
      }
    }

    const insertData: Record<string, unknown> = {
      client_id,
      provider_id,
      service_id: serviceId,
      status: 'pending',
      notes: description || null,
    };

    if (scheduled_date) {
      insertData.scheduled_date = scheduled_date;
    }

    const { data, error } = await supabaseAdmin
      .from('bookings')
      .insert(insertData)
      .select()
      .single();

    if (error || !data) {
      console.error('[BookingService] Error creating booking:', error);
      throw new AppError('Failed to create booking', 500);
    }

    return data as Booking;
  }

  async listBookings(query: ListBookingsQuery): Promise<{ bookings: any[]; total: number }> {
    const { userId, status, page, limit } = query;
    const offset = (page - 1) * limit;

    // Build query - user must be client OR provider
    let dbQuery = supabaseAdmin
      .from('bookings')
      .select(
        `*,
        client:profiles!bookings_client_id_fkey(user_id, full_name, avatar_url),
        provider:profiles!bookings_provider_id_fkey(user_id, full_name, avatar_url)`,
        { count: 'exact' }
      )
      .or(`client_id.eq.${userId},provider_id.eq.${userId}`);

    if (status) {
      dbQuery = dbQuery.eq('status', status);
    }

    dbQuery = dbQuery
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await dbQuery;

    if (error) {
      console.error('[BookingService] Error listing bookings:', error);
      throw new AppError('Failed to fetch bookings', 500);
    }

    return { bookings: data || [], total: count || 0 };
  }

  async updateBookingStatus(
    bookingId: string,
    userId: string,
    newStatus: 'confirmed' | 'completed'
  ): Promise<Booking> {
    // Fetch the booking
    const { data: booking, error: fetchError } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (fetchError || !booking) {
      throw new AppError('Booking not found', 404);
    }

    const isClient = booking.client_id === userId;
    const isProvider = booking.provider_id === userId;

    if (!isClient && !isProvider) {
      throw new AppError('You are not authorized to update this booking', 403);
    }

    // Validate status transitions
    if (newStatus === 'confirmed') {
      // Only the provider can confirm
      if (!isProvider) {
        throw new AppError('Only the provider can confirm a booking', 403);
      }
      if (booking.status !== 'pending') {
        throw new AppError('Only pending bookings can be confirmed', 400);
      }
    }

    if (newStatus === 'completed') {
      // Either party can mark as completed
      const completableStatuses = ['confirmed', 'in_progress'];
      if (!completableStatuses.includes(booking.status)) {
        throw new AppError(
          `Cannot mark a "${booking.status}" booking as completed. Only confirmed or in-progress bookings can be completed.`,
          400
        );
      }
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('bookings')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .select()
      .single();

    if (updateError || !updated) {
      console.error('[BookingService] Error updating status:', updateError);
      throw new AppError('Failed to update booking status', 500);
    }

    return updated as Booking;
  }
}

export const bookingService = new BookingService();
