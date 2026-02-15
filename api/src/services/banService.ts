import { supabaseAdmin } from './supabase';
import { AppError } from '../middleware/errorHandler';
import type { Ban, BanInfo, StrikeResult } from '../types';

// ─── Constants ──────────────────────────────────────────────
const CANCEL_THRESHOLD = 3;       // cancellations before temp ban
const CANCEL_WINDOW_DAYS = 30;    // rolling window for counting
const TEMP_BAN_DAYS = 7;          // temp ban duration
const PERM_BAN_AFTER_TEMP_BANS = 3; // temp bans before permanent

class BanService {
  /**
   * Check if a user is currently banned.
   * Single optimized query: returns the most recent active ban where
   * ban_type = 'permanent' OR expires_at > now().
   */
  async checkBan(userId: string): Promise<BanInfo> {
    const { data: ban, error } = await supabaseAdmin
      .from('user_bans')
      .select('*')
      .eq('user_id', userId)
      .or(`ban_type.eq.permanent,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[BanService] Error checking ban:', error);
      // Fail open - don't block users if ban check fails
      return { banned: false };
    }

    if (!ban) {
      return { banned: false };
    }

    return {
      banned: true,
      ban: {
        type: ban.ban_type,
        reason: ban.reason,
        expires_at: ban.expires_at,
      },
    };
  }

  /**
   * Alias for checkBan - returns the raw Ban row if active, null otherwise.
   * Used by the inline banCheck in routes/index.ts.
   */
  async getActiveBan(userId: string): Promise<Ban | null> {
    const { data: ban, error } = await supabaseAdmin
      .from('user_bans')
      .select('*')
      .eq('user_id', userId)
      .or(`ban_type.eq.permanent,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !ban) return null;
    return ban as Ban;
  }

  /**
   * Log a cancellation and check if ban threshold is reached.
   * 1. Insert into cancellation_log
   * 2. Count cancellations in last 30 days
   * 3. If count >= 3: create temp ban
   * 4. If temp bans >= 3: upgrade to permanent ban
   */
  async logCancellation(
    userId: string,
    bookingId: string,
    reason?: string
  ): Promise<StrikeResult> {
    // 1. Insert cancellation record
    const { error: insertError } = await supabaseAdmin
      .from('cancellation_log')
      .insert({
        user_id: userId,
        booking_id: bookingId,
        reason: reason || null,
      });

    if (insertError) {
      console.error('[BanService] Error logging cancellation:', insertError);
      // Don't block the cancellation if logging fails
    }

    // 2. Count cancellations in the last 30 days
    const cancellationCount = await this.getCancellationCount(userId);

    console.log(
      `[BanService] User ${userId} has ${cancellationCount} cancellation(s) in the last ${CANCEL_WINDOW_DAYS} days`
    );

    // 3. Check if threshold reached
    if (cancellationCount >= CANCEL_THRESHOLD) {
      return await this.handleBanThreshold(userId, cancellationCount);
    }

    const remaining = CANCEL_THRESHOLD - cancellationCount;
    return {
      banned: false,
      message: `Warning: ${cancellationCount} cancellation(s) in the last ${CANCEL_WINDOW_DAYS} days. ${remaining} more before a temporary ban.`,
      strikeCount: cancellationCount,
    };
  }

  /**
   * Backwards-compatible alias for logCancellation.
   * Called from the existing bookings route which already inserts
   * cancellation_log separately - this version just checks thresholds.
   */
  async recordCancellation(userId: string): Promise<StrikeResult> {
    const cancellationCount = await this.getCancellationCount(userId);

    console.log(
      `[BanService] User ${userId} has ${cancellationCount} cancellation(s) in the last ${CANCEL_WINDOW_DAYS} days`
    );

    if (cancellationCount >= CANCEL_THRESHOLD) {
      return await this.handleBanThreshold(userId, cancellationCount);
    }

    const remaining = CANCEL_THRESHOLD - cancellationCount;
    return {
      banned: false,
      message: `Warning: ${cancellationCount} cancellation(s) in the last ${CANCEL_WINDOW_DAYS} days. ${remaining} more before a temporary ban.`,
      strikeCount: cancellationCount,
    };
  }

  /**
   * Count cancellations in the last 30 days for a user.
   */
  async getCancellationCount(userId: string): Promise<number> {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - CANCEL_WINDOW_DAYS);

    const { count, error } = await supabaseAdmin
      .from('cancellation_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('cancelled_at', windowStart.toISOString());

    if (error) {
      console.error('[BanService] Error counting cancellations:', error);
      return 0;
    }

    return count || 0;
  }

  /**
   * Create a temporary ban (7 days).
   */
  async createTempBan(userId: string, reason: string): Promise<void> {
    const now = new Date();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + TEMP_BAN_DAYS);

    const strikeCount = await this.getCancellationCount(userId);

    const { error } = await supabaseAdmin.from('user_bans').insert({
      user_id: userId,
      ban_type: 'temporary',
      reason,
      starts_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      strike_count: strikeCount,
    });

    if (error) {
      console.error('[BanService] Error creating temp ban:', error);
      throw new AppError('Failed to create temporary ban', 500);
    }

    console.log(
      `[BanService] Temporary ban created for user ${userId}, expires ${expiresAt.toISOString()}`
    );
  }

  /**
   * Check if user has >= 3 temp bans and upgrade to permanent if so.
   */
  async checkForPermanentBan(userId: string): Promise<boolean> {
    const { count, error } = await supabaseAdmin
      .from('user_bans')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('ban_type', 'temporary');

    if (error) {
      console.error('[BanService] Error counting temp bans:', error);
      return false;
    }

    const tempBanCount = count || 0;

    if (tempBanCount >= PERM_BAN_AFTER_TEMP_BANS) {
      const { error: insertError } = await supabaseAdmin
        .from('user_bans')
        .insert({
          user_id: userId,
          ban_type: 'permanent',
          reason: `Permanent ban: ${tempBanCount} temporary bans issued for excessive cancellations`,
          starts_at: new Date().toISOString(),
          expires_at: null,
          strike_count: tempBanCount,
        });

      if (insertError) {
        console.error('[BanService] Error creating permanent ban:', insertError);
        throw new AppError('Failed to create permanent ban', 500);
      }

      console.log(
        `[BanService] PERMANENT ban created for user ${userId} after ${tempBanCount} temp bans`
      );
      return true;
    }

    return false;
  }

  /**
   * Internal: handle the ban threshold being reached.
   * Creates a temp ban, then checks if permanent ban is needed.
   */
  private async handleBanThreshold(
    userId: string,
    strikeCount: number
  ): Promise<StrikeResult> {
    // Count existing temp bans (before creating a new one)
    const { count: existingTempBans } = await supabaseAdmin
      .from('user_bans')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('ban_type', 'temporary');

    const totalTempBans = (existingTempBans || 0) + 1;

    // Check if this triggers a permanent ban
    if (totalTempBans >= PERM_BAN_AFTER_TEMP_BANS) {
      // Create permanent ban directly
      const { error } = await supabaseAdmin.from('user_bans').insert({
        user_id: userId,
        ban_type: 'permanent',
        reason: `Permanent ban: ${totalTempBans} temporary bans issued for excessive cancellations`,
        starts_at: new Date().toISOString(),
        expires_at: null,
        strike_count: strikeCount,
      });

      if (error) {
        console.error('[BanService] Error creating permanent ban:', error);
        throw new AppError('Failed to process ban', 500);
      }

      console.log(
        `[BanService] PERMANENT ban created for user ${userId} after ${totalTempBans} temp bans`
      );

      return {
        banned: true,
        banType: 'permanent',
        message: 'Your account has been permanently banned due to excessive cancellations.',
        strikeCount,
      };
    }

    // Create temporary ban
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + TEMP_BAN_DAYS);

    const { error } = await supabaseAdmin.from('user_bans').insert({
      user_id: userId,
      ban_type: 'temporary',
      reason: `Temporary ban: ${strikeCount} cancellations in ${CANCEL_WINDOW_DAYS} days`,
      starts_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      strike_count: strikeCount,
    });

    if (error) {
      console.error('[BanService] Error creating temp ban:', error);
      throw new AppError('Failed to process ban', 500);
    }

    console.log(
      `[BanService] Temporary ban #${totalTempBans} created for user ${userId}, expires ${expiresAt.toISOString()}`
    );

    const remaining = PERM_BAN_AFTER_TEMP_BANS - totalTempBans;
    return {
      banned: true,
      banType: 'temporary',
      message: `Your account has been temporarily banned until ${expiresAt.toLocaleDateString()}. This is temporary ban #${totalTempBans}. ${remaining} more will result in a permanent ban.`,
      strikeCount,
    };
  }
}

export const banService = new BanService();
