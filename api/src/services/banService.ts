import { supabaseAdmin } from './supabase';
import { AppError } from '../middleware/errorHandler';
import type { Ban, StrikeResult } from '../types';

// 3 cancellations in 30 days = 7-day temp ban
// 3 temp bans = permanent ban
const CANCEL_THRESHOLD = 3;
const CANCEL_WINDOW_DAYS = 30;
const TEMP_BAN_DAYS = 7;
const PERM_BAN_AFTER_TEMP_BANS = 3;

class BanService {
  async getActiveBan(userId: string): Promise<Ban | null> {
    const { data: bans, error } = await supabaseAdmin
      .from('user_bans')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !bans || bans.length === 0) return null;

    for (const ban of bans) {
      if (ban.ban_type === 'permanent') {
        return ban as Ban;
      }
      if (ban.ban_type === 'temporary' && ban.banned_until) {
        if (new Date(ban.banned_until) > new Date()) {
          return ban as Ban;
        }
      }
    }

    return null;
  }

  async recordCancellation(userId: string): Promise<StrikeResult> {
    // Count cancellations in the last 30 days
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - CANCEL_WINDOW_DAYS);

    const { count } = await supabaseAdmin
      .from('cancellation_log')
      .select('id', { count: 'exact' })
      .eq('user_id', userId)
      .gte('created_at', windowStart.toISOString());

    const cancellationCount = (count || 0) + 1; // +1 for the current one being recorded

    // Check if threshold reached
    if (cancellationCount >= CANCEL_THRESHOLD) {
      return await this.issueBan(userId, cancellationCount);
    }

    const remaining = CANCEL_THRESHOLD - cancellationCount;
    return {
      banned: false,
      message: `Warning: ${cancellationCount} cancellation(s) in the last ${CANCEL_WINDOW_DAYS} days. ${remaining} more before a temporary ban.`,
      strikeCount: cancellationCount,
    };
  }

  private async issueBan(userId: string, strikeCount: number): Promise<StrikeResult> {
    // Count existing temp bans
    const { count: tempBanCount } = await supabaseAdmin
      .from('user_bans')
      .select('id', { count: 'exact' })
      .eq('user_id', userId)
      .eq('ban_type', 'temporary');

    const totalTempBans = (tempBanCount || 0) + 1;

    if (totalTempBans >= PERM_BAN_AFTER_TEMP_BANS) {
      // Permanent ban
      const { error } = await supabaseAdmin.from('user_bans').insert({
        user_id: userId,
        ban_type: 'permanent',
        reason: `Permanent ban: ${totalTempBans} temporary bans issued for excessive cancellations`,
        banned_until: null,
        strike_count: strikeCount,
      });

      if (error) {
        console.error('[BanService] Error creating permanent ban:', error);
        throw new AppError('Failed to process ban', 500);
      }

      return {
        banned: true,
        banType: 'permanent',
        message: 'Your account has been permanently banned due to excessive cancellations.',
        strikeCount,
      };
    }

    // Temporary ban
    const bannedUntil = new Date();
    bannedUntil.setDate(bannedUntil.getDate() + TEMP_BAN_DAYS);

    const { error } = await supabaseAdmin.from('user_bans').insert({
      user_id: userId,
      ban_type: 'temporary',
      reason: `Temporary ban: ${strikeCount} cancellations in ${CANCEL_WINDOW_DAYS} days`,
      banned_until: bannedUntil.toISOString(),
      strike_count: strikeCount,
    });

    if (error) {
      console.error('[BanService] Error creating temp ban:', error);
      throw new AppError('Failed to process ban', 500);
    }

    return {
      banned: true,
      banType: 'temporary',
      message: `Your account has been temporarily banned until ${bannedUntil.toLocaleDateString()}. This is temporary ban #${totalTempBans}. ${PERM_BAN_AFTER_TEMP_BANS - totalTempBans} more will result in a permanent ban.`,
      strikeCount,
    };
  }
}

export const banService = new BanService();
