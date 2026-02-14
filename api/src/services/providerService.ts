import { supabaseAdmin } from './supabase';
import { AppError } from '../middleware/errorHandler';
import type { Provider, ProviderTier } from '../types';

interface ListQuery {
  page: number;
  limit: number;
  tier?: ProviderTier;
  category?: string;
  city?: string;
  search?: string;
}

class ProviderService {
  async listProviders(query: ListQuery): Promise<{ providers: Provider[]; total: number }> {
    const { page, limit, tier, category, city, search } = query;
    const offset = (page - 1) * limit;

    let dbQuery = supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact' })
      .eq('user_type', 'provider')
      .eq('is_available', true);

    if (tier) {
      dbQuery = dbQuery.eq('provider_tier', tier);
    }
    if (city) {
      dbQuery = dbQuery.ilike('city', `%${city}%`);
    }
    if (search) {
      dbQuery = dbQuery.or(`full_name.ilike.%${search}%,bio.ilike.%${search}%`);
    }

    dbQuery = dbQuery
      .order('is_verified', { ascending: false })
      .order('provider_tier', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await dbQuery;

    if (error) {
      console.error('[ProviderService] Error listing:', error);
      throw new AppError('Failed to fetch providers', 500);
    }

    // Filter by category if specified (requires join through provider_services)
    let providers = (data || []) as Provider[];

    if (category) {
      const { data: categoryProviders } = await supabaseAdmin
        .from('provider_services')
        .select('provider_id, service_categories!inner(slug)')
        .eq('service_categories.slug', category)
        .eq('is_active', true);

      if (categoryProviders) {
        const providerIds = new Set(categoryProviders.map((cp: any) => cp.provider_id));
        providers = providers.filter((p) => providerIds.has(p.user_id));
      }
    }

    // Hide phone for specialists
    providers = providers.map((p) => this.sanitizeProvider(p));

    return { providers, total: count || 0 };
  }

  async getProviderById(userId: string, requesterId?: string): Promise<Provider | null> {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .eq('user_type', 'provider')
      .single();

    if (error || !data) return null;

    const provider = data as Provider;

    // If requester is the provider themselves, show everything
    if (requesterId === userId) return provider;

    return this.sanitizeProvider(provider);
  }

  async upgradeTier(userId: string, requesterId: string): Promise<Provider> {
    if (userId !== requesterId) {
      throw new AppError('You can only upgrade your own profile', 403);
    }

    // Check they have an active subscription
    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('id')
      .eq('provider_id', userId)
      .eq('status', 'active')
      .gte('expires_at', new Date().toISOString())
      .single();

    if (!subscription) {
      throw new AppError('An active subscription is required to upgrade to specialist tier', 402);
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({ provider_tier: 'specialist' })
      .eq('user_id', userId)
      .eq('user_type', 'provider')
      .select()
      .single();

    if (error || !data) {
      throw new AppError('Failed to upgrade tier', 500);
    }

    return data as Provider;
  }

  async getOwnProfile(userId: string): Promise<Provider | null> {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .eq('user_type', 'provider')
      .single();

    if (error || !data) return null;

    // Return full profile including phone - this is the provider viewing their own profile
    return data as Provider;
  }

  async updateProfile(
    userId: string,
    updates: {
      full_name?: string;
      bio?: string;
      city?: string;
      avatar_url?: string;
      is_available?: boolean;
    }
  ): Promise<Provider> {
    // Verify the user is actually a provider
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('user_id')
      .eq('user_id', userId)
      .eq('user_type', 'provider')
      .single();

    if (fetchError || !existing) {
      throw new AppError('Provider profile not found', 404);
    }

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.full_name !== undefined) updateData.full_name = updates.full_name;
    if (updates.bio !== undefined) updateData.bio = updates.bio;
    if (updates.city !== undefined) updateData.city = updates.city;
    if (updates.avatar_url !== undefined) updateData.avatar_url = updates.avatar_url;
    if (updates.is_available !== undefined) updateData.is_available = updates.is_available;

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updateData)
      .eq('user_id', userId)
      .eq('user_type', 'provider')
      .select()
      .single();

    if (error || !data) {
      console.error('[ProviderService] Error updating profile:', error);
      throw new AppError('Failed to update profile', 500);
    }

    return data as Provider;
  }

  private sanitizeProvider(provider: Provider): Provider {
    // Hide phone number for specialists
    if (provider.provider_tier === 'specialist' && !provider.phone_visible) {
      return { ...provider, phone: null };
    }
    return provider;
  }
}

export const providerService = new ProviderService();
