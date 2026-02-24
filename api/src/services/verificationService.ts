import { supabaseAdmin } from './supabase';
import { AppError } from '../middleware/errorHandler';

const BUCKET = 'khedma-uploads';

interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface Verification {
  id: string;
  user_id: string;
  cin_photo_url: string;
  selfie_url: string;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason?: string;
  created_at: string;
}

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

class VerificationService {
  /**
   * Submit identity verification (CIN photo + selfie)
   */
  async submitVerification(
    userId: string,
    cinFile: UploadedFile,
    selfieFile: UploadedFile
  ): Promise<Verification> {
    // Validate files
    this.validateFile(cinFile, 'CIN photo');
    this.validateFile(selfieFile, 'Selfie');

    // Check for existing pending/approved verification
    const { data: existing } = await supabaseAdmin
      .from('identity_verifications')
      .select('id, status')
      .eq('user_id', userId)
      .single();

    if (existing?.status === 'approved') {
      throw new AppError('Your identity is already verified', 409);
    }

    // If rejected, delete old record so they can resubmit
    if (existing?.status === 'rejected') {
      await supabaseAdmin
        .from('identity_verifications')
        .delete()
        .eq('id', existing.id);
    }

    if (existing?.status === 'pending') {
      throw new AppError('You already have a pending verification. Please wait for review.', 409);
    }

    // Upload CIN photo
    const cinExt = MIME_TO_EXT[cinFile.mimetype] || '.jpg';
    const cinPath = `verification/${userId}/cin${cinExt}`;
    const { error: cinErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(cinPath, cinFile.buffer, { contentType: cinFile.mimetype, upsert: true });

    if (cinErr) {
      console.error('[VerificationService] CIN upload error:', cinErr);
      throw new AppError('Failed to upload CIN photo', 500);
    }

    // Upload selfie
    const selfieExt = MIME_TO_EXT[selfieFile.mimetype] || '.jpg';
    const selfiePath = `verification/${userId}/selfie${selfieExt}`;
    const { error: selfieErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(selfiePath, selfieFile.buffer, { contentType: selfieFile.mimetype, upsert: true });

    if (selfieErr) {
      console.error('[VerificationService] Selfie upload error:', selfieErr);
      throw new AppError('Failed to upload selfie', 500);
    }

    const cinUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(cinPath).data.publicUrl;
    const selfieUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(selfiePath).data.publicUrl;

    // Create verification record
    const { data, error } = await supabaseAdmin
      .from('identity_verifications')
      .insert({
        user_id: userId,
        cin_photo_url: cinUrl,
        selfie_url: selfieUrl,
        status: 'pending',
      })
      .select()
      .single();

    if (error || !data) {
      console.error('[VerificationService] Insert error:', error);
      throw new AppError('Failed to create verification request', 500);
    }

    // Update profile verification_status
    await supabaseAdmin
      .from('profiles')
      .update({ verification_status: 'pending' })
      .eq('user_id', userId);

    return data as Verification;
  }

  /**
   * Get verification status for a user
   */
  async getStatus(userId: string): Promise<Verification | null> {
    const { data } = await supabaseAdmin
      .from('identity_verifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return data as Verification | null;
  }

  /**
   * Admin: list pending verifications
   */
  async listPending(page: number, limit: number): Promise<{ verifications: Verification[]; total: number }> {
    const offset = (page - 1) * limit;
    const { data, count, error } = await supabaseAdmin
      .from('identity_verifications')
      .select('*, profiles!user_id(full_name, phone, city)', { count: 'exact' })
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw new AppError('Failed to fetch verifications', 500);
    return { verifications: (data || []) as Verification[], total: count || 0 };
  }

  /**
   * Admin: approve or reject verification
   */
  async review(
    verificationId: string,
    adminId: string,
    decision: 'approved' | 'rejected',
    rejectionReason?: string
  ): Promise<Verification> {
    const { data: verification, error: fetchErr } = await supabaseAdmin
      .from('identity_verifications')
      .select('*')
      .eq('id', verificationId)
      .single();

    if (fetchErr || !verification) {
      throw new AppError('Verification not found', 404);
    }

    if (verification.status !== 'pending') {
      throw new AppError(`Verification is already ${verification.status}`, 400);
    }

    const { data, error } = await supabaseAdmin
      .from('identity_verifications')
      .update({
        status: decision,
        rejection_reason: decision === 'rejected' ? rejectionReason : null,
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', verificationId)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('Failed to update verification', 500);
    }

    // Update profile
    await supabaseAdmin
      .from('profiles')
      .update({
        is_verified: decision === 'approved',
        verification_status: decision,
      })
      .eq('user_id', verification.user_id);

    return data as Verification;
  }

  private validateFile(file: UploadedFile, label: string): void {
    if (!file?.buffer) {
      throw new AppError(`${label} is required`, 400);
    }
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new AppError(`${label}: Invalid file type. Allowed: JPEG, PNG, WebP`, 400);
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new AppError(`${label}: File too large. Maximum 5MB`, 400);
    }
  }
}

export const verificationService = new VerificationService();
