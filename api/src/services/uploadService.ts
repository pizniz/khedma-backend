import crypto from 'crypto';
import { supabaseAdmin } from './supabase';
import { AppError } from '../middleware/errorHandler';
import type { PortfolioPhoto } from '../types';

const BUCKET = 'khedma-uploads';
const MAX_PORTFOLIO_PHOTOS = 20;

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

class UploadService {
  // ─── Avatar Upload ──────────────────────────────────────────

  async uploadAvatar(
    userId: string,
    file: UploadedFile
  ): Promise<{ url: string }> {
    this.validateFile(file);

    const ext = MIME_TO_EXT[file.mimetype] || '.jpg';
    const storagePath = `avatars/${userId}${ext}`;

    // Upload to Supabase Storage (upsert to replace existing avatar)
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (uploadError) {
      console.error('[UploadService] Avatar upload error:', uploadError);
      throw new AppError('Failed to upload avatar', 500);
    }

    const {
      data: { publicUrl },
    } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);

    // Update provider profile with new avatar URL
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('user_type', 'provider');

    if (updateError) {
      console.error('[UploadService] Avatar profile update error:', updateError);
      throw new AppError('Failed to update profile avatar', 500);
    }

    return { url: publicUrl };
  }

  // ─── Portfolio Photo Upload ─────────────────────────────────

  async uploadPortfolioPhoto(
    userId: string,
    file: UploadedFile,
    caption?: string
  ): Promise<PortfolioPhoto> {
    this.validateFile(file);

    // Check provider exists
    await this.verifyProvider(userId);

    // Check photo count limit
    const { count, error: countError } = await supabaseAdmin
      .from('portfolio_photos')
      .select('id', { count: 'exact', head: true })
      .eq('provider_id', userId);

    if (countError) {
      console.error('[UploadService] Photo count error:', countError);
      throw new AppError('Failed to check photo count', 500);
    }

    if ((count ?? 0) >= MAX_PORTFOLIO_PHOTOS) {
      throw new AppError(
        `Maximum of ${MAX_PORTFOLIO_PHOTOS} portfolio photos allowed`,
        400
      );
    }

    const ext = MIME_TO_EXT[file.mimetype] || '.jpg';
    const photoId = crypto.randomUUID();
    const storagePath = `portfolio/${userId}/${photoId}${ext}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error('[UploadService] Portfolio upload error:', uploadError);
      throw new AppError('Failed to upload photo', 500);
    }

    const {
      data: { publicUrl },
    } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);

    // Determine next display_order
    const { data: lastPhoto } = await supabaseAdmin
      .from('portfolio_photos')
      .select('display_order')
      .eq('provider_id', userId)
      .order('display_order', { ascending: false })
      .limit(1)
      .single();

    const nextOrder = lastPhoto ? lastPhoto.display_order + 1 : 0;

    // Create DB record
    const { data: photo, error: insertError } = await supabaseAdmin
      .from('portfolio_photos')
      .insert({
        provider_id: userId,
        storage_path: storagePath,
        url: publicUrl,
        caption: caption || null,
        display_order: nextOrder,
      })
      .select()
      .single();

    if (insertError || !photo) {
      // Clean up uploaded file if DB insert fails
      await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
      console.error('[UploadService] Portfolio insert error:', insertError);
      throw new AppError('Failed to save photo record', 500);
    }

    return photo as PortfolioPhoto;
  }

  // ─── Delete Portfolio Photo ─────────────────────────────────

  async deletePortfolioPhoto(userId: string, photoId: string): Promise<void> {
    // Fetch the photo and verify ownership
    const { data: photo, error: fetchError } = await supabaseAdmin
      .from('portfolio_photos')
      .select('*')
      .eq('id', photoId)
      .single();

    if (fetchError || !photo) {
      throw new AppError('Photo not found', 404);
    }

    if (photo.provider_id !== userId) {
      throw new AppError('You can only delete your own photos', 403);
    }

    // Delete from storage
    const { error: storageError } = await supabaseAdmin.storage
      .from(BUCKET)
      .remove([photo.storage_path]);

    if (storageError) {
      console.error('[UploadService] Storage delete error:', storageError);
      // Continue to delete DB record even if storage delete fails
    }

    // Delete DB record
    const { error: deleteError } = await supabaseAdmin
      .from('portfolio_photos')
      .delete()
      .eq('id', photoId);

    if (deleteError) {
      console.error('[UploadService] DB delete error:', deleteError);
      throw new AppError('Failed to delete photo', 500);
    }
  }

  // ─── List Portfolio Photos ──────────────────────────────────

  async listPortfolioPhotos(providerId: string): Promise<PortfolioPhoto[]> {
    const { data, error } = await supabaseAdmin
      .from('portfolio_photos')
      .select('*')
      .eq('provider_id', providerId)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('[UploadService] List photos error:', error);
      throw new AppError('Failed to fetch portfolio photos', 500);
    }

    return (data || []) as PortfolioPhoto[];
  }

  // ─── Reorder Portfolio Photos ───────────────────────────────

  async reorderPhotos(userId: string, photoIds: string[]): Promise<PortfolioPhoto[]> {
    // Verify all photos belong to this provider
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('portfolio_photos')
      .select('id')
      .eq('provider_id', userId);

    if (fetchError) {
      console.error('[UploadService] Reorder fetch error:', fetchError);
      throw new AppError('Failed to fetch photos for reorder', 500);
    }

    const existingIds = new Set((existing || []).map((p: { id: string }) => p.id));

    for (const id of photoIds) {
      if (!existingIds.has(id)) {
        throw new AppError(`Photo ${id} not found or does not belong to you`, 403);
      }
    }

    // Update display_order for each photo
    const updates = photoIds.map((id, index) =>
      supabaseAdmin
        .from('portfolio_photos')
        .update({ display_order: index })
        .eq('id', id)
        .eq('provider_id', userId)
    );

    const results = await Promise.all(updates);

    for (const result of results) {
      if (result.error) {
        console.error('[UploadService] Reorder update error:', result.error);
        throw new AppError('Failed to reorder photos', 500);
      }
    }

    // Return updated list
    return this.listPortfolioPhotos(userId);
  }

  // ─── Helpers ────────────────────────────────────────────────

  private validateFile(file: UploadedFile): void {
    if (!file || !file.buffer) {
      throw new AppError('No file provided', 400);
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new AppError(
        `Invalid file type: ${file.mimetype}. Allowed: JPEG, PNG, WebP`,
        400
      );
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      throw new AppError('File too large. Maximum size is 5MB', 400);
    }
  }

  private async verifyProvider(userId: string): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('user_id')
      .eq('user_id', userId)
      .eq('user_type', 'provider')
      .single();

    if (error || !data) {
      throw new AppError('Provider profile not found', 404);
    }
  }
}

export const uploadService = new UploadService();
