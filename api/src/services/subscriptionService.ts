import { supabaseAdmin } from './supabase';
import { AppError } from '../middleware/errorHandler';
import type { Subscription } from '../types';

const PLAN_CONFIG: Record<string, { days: number; amount: number }> = {
  specialist_monthly: { days: 30, amount: 50 },
  specialist_yearly: { days: 365, amount: 500 },
};

class SubscriptionService {
  async createSubscription(
    providerId: string,
    userId: string,
    planType: string = 'specialist_monthly',
    paymentMethod?: string,
    paymentReference?: string
  ): Promise<Subscription> {
    if (providerId !== userId) {
      throw new AppError('You can only create subscriptions for yourself', 403);
    }

    // Verify user is a provider
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('user_type')
      .eq('user_id', providerId)
      .single();

    if (!profile || profile.user_type !== 'provider') {
      throw new AppError('Only providers can create subscriptions', 403);
    }

    // Check for existing active subscription
    const { data: existing } = await supabaseAdmin
      .from('subscriptions')
      .select('id, expires_at')
      .eq('provider_id', providerId)
      .eq('status', 'active')
      .gte('expires_at', new Date().toISOString())
      .single();

    if (existing) {
      throw new AppError(
        `You already have an active subscription expiring on ${new Date(existing.expires_at).toLocaleDateString()}`,
        409
      );
    }

    const plan = PLAN_CONFIG[planType];
    if (!plan) {
      throw new AppError(`Invalid plan type: ${planType}. Available: ${Object.keys(PLAN_CONFIG).join(', ')}`, 400);
    }

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + plan.days);

    const { data: subscription, error } = await supabaseAdmin
      .from('subscriptions')
      .insert({
        provider_id: providerId,
        plan_type: planType,
        status: 'active',
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        amount: plan.amount,
        payment_method: paymentMethod || null,
        payment_reference: paymentReference || null,
      })
      .select()
      .single();

    if (error || !subscription) {
      console.error('[SubscriptionService] Error creating:', error);
      throw new AppError('Failed to create subscription', 500);
    }

    return subscription as Subscription;
  }

  async getStatus(providerId: string): Promise<Subscription | null> {
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) return null;

    const subscription = data as Subscription;

    // Auto-expire if past expiration
    if (subscription.status === 'active' && new Date(subscription.expires_at) < new Date()) {
      await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'expired' })
        .eq('id', subscription.id);

      // Downgrade tier
      await supabaseAdmin
        .from('profiles')
        .update({ provider_tier: 'basic' })
        .eq('user_id', providerId);

      subscription.status = 'expired';
    }

    return subscription;
  }

  async cancelSubscription(providerId: string, userId: string): Promise<Subscription> {
    if (providerId !== userId) {
      throw new AppError('You can only cancel your own subscription', 403);
    }

    const subscription = await this.getStatus(providerId);

    if (!subscription || subscription.status !== 'active') {
      throw new AppError('No active subscription to cancel', 404);
    }

    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'cancelled' })
      .eq('id', subscription.id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError('Failed to cancel subscription', 500);
    }

    // Downgrade tier
    await supabaseAdmin
      .from('profiles')
      .update({ provider_tier: 'basic' })
      .eq('user_id', providerId);

    return data as Subscription;
  }
}

export const subscriptionService = new SubscriptionService();
