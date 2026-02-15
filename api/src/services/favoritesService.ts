import { supabaseAdmin } from './supabase';
import { AppError } from '../middleware/errorHandler';

interface FavoriteProvider {
  id: string;
  provider_id: string;
  created_at: string;
  provider: {
    user_id: string;
    full_name: string;
    city: string | null;
    provider_tier: 'basic' | 'specialist';
    phone: string | null;
    phone_visible: boolean;
    is_available: boolean;
    avatar_url: string | null;
    categories: string[] | null;
  };
}

class FavoritesService {
  async addFavorite(userId: string, providerId: string): Promise<{ id: string }> {
    // Check if already favorited (upsert-like behavior: ignore if exists)
    const { data: existing } = await supabaseAdmin
      .from('favorites')
      .select('id')
      .eq('user_id', userId)
      .eq('provider_id', providerId)
      .single();

    if (existing) {
      return { id: existing.id };
    }

    const { data, error } = await supabaseAdmin
      .from('favorites')
      .insert({ user_id: userId, provider_id: providerId })
      .select('id')
      .single();

    if (error) {
      console.error('[FavoritesService] Error adding favorite:', error);
      throw new AppError('Failed to add favorite', 500);
    }

    return { id: data.id };
  }

  async removeFavorite(userId: string, providerId: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from('favorites')
      .delete()
      .eq('user_id', userId)
      .eq('provider_id', providerId);

    if (error) {
      console.error('[FavoritesService] Error removing favorite:', error);
      throw new AppError('Failed to remove favorite', 500);
    }
  }

  async listFavorites(userId: string): Promise<FavoriteProvider[]> {
    const { data, error } = await supabaseAdmin
      .from('favorites')
      .select(`
        id,
        provider_id,
        created_at,
        profiles!provider_id (
          user_id,
          full_name,
          city,
          provider_tier,
          phone,
          phone_visible,
          is_available,
          avatar_url,
          categories
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[FavoritesService] Error listing favorites:', error);
      throw new AppError('Failed to list favorites', 500);
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      provider_id: row.provider_id,
      created_at: row.created_at,
      provider: row.profiles,
    }));
  }

  async isFavorited(userId: string, providerId: string): Promise<boolean> {
    const { data } = await supabaseAdmin
      .from('favorites')
      .select('id')
      .eq('user_id', userId)
      .eq('provider_id', providerId)
      .single();

    return !!data;
  }

  async getFavoriteStatus(
    userId: string,
    providerIds: string[]
  ): Promise<Record<string, boolean>> {
    if (providerIds.length === 0) return {};

    const { data, error } = await supabaseAdmin
      .from('favorites')
      .select('provider_id')
      .eq('user_id', userId)
      .in('provider_id', providerIds);

    if (error) {
      console.error('[FavoritesService] Error checking favorite status:', error);
      throw new AppError('Failed to check favorite status', 500);
    }

    const favoritedSet = new Set((data || []).map((r: any) => r.provider_id));
    const result: Record<string, boolean> = {};
    for (const id of providerIds) {
      result[id] = favoritedSet.has(id);
    }
    return result;
  }
}

export const favoritesService = new FavoritesService();
