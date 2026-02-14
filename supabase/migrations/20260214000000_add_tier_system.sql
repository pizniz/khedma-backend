-- ============================================
-- Migration: Add Tier System, Subscriptions, Bans
-- Date: 2026-02-14
-- Description:
--   1. provider_tier enum + column on profiles
--   2. phone_visible column on profiles
--   3. subscriptions table
--   4. cancellation_log table
--   5. user_bans table
--   6. Review-must-have-completed-booking trigger
--   7. RLS policies for all new tables
--   8. Performance indexes
-- ============================================

BEGIN;

-- ============================================
-- 1. Provider Tier Enum + Column
-- ============================================

CREATE TYPE public.provider_tier AS ENUM ('basic', 'specialist');

ALTER TABLE public.profiles
    ADD COLUMN provider_tier public.provider_tier DEFAULT 'basic';

-- ============================================
-- 2. Phone Visibility Column
--    Basic providers: phone visible by default (true)
--    Specialists: phone hidden by default (false)
--    Clients: null (not applicable)
-- ============================================

ALTER TABLE public.profiles
    ADD COLUMN phone_visible BOOLEAN;

-- Set defaults for existing providers based on their tier
UPDATE public.profiles
SET phone_visible = true
WHERE user_type = 'provider';

-- Trigger function to auto-set phone_visible based on provider_tier
CREATE OR REPLACE FUNCTION public.set_phone_visible_default()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.user_type = 'provider' THEN
        IF TG_OP = 'INSERT' AND NEW.phone_visible IS NULL THEN
            IF NEW.provider_tier = 'specialist' THEN
                NEW.phone_visible := false;
            ELSE
                NEW.phone_visible := true;
            END IF;
        END IF;

        IF TG_OP = 'UPDATE' AND OLD.provider_tier IS DISTINCT FROM NEW.provider_tier THEN
            IF NEW.provider_tier = 'specialist' THEN
                NEW.phone_visible := false;
            ELSE
                NEW.phone_visible := true;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER set_phone_visible_on_profile
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_phone_visible_default();

-- ============================================
-- 3. Subscriptions Table
-- ============================================

CREATE TYPE public.subscription_status AS ENUM ('active', 'expired', 'cancelled');

CREATE TABLE public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_type TEXT NOT NULL DEFAULT 'specialist_monthly',
    status public.subscription_status NOT NULL DEFAULT 'active',
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_method TEXT,
    payment_reference TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.subscriptions IS 'Tracks specialist provider subscription payments';

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers can view their own subscriptions"
    ON public.subscriptions FOR SELECT
    USING (auth.uid() = provider_id);

CREATE POLICY "Providers can create their own subscriptions"
    ON public.subscriptions FOR INSERT
    WITH CHECK (auth.uid() = provider_id);

CREATE POLICY "Providers can update their own subscriptions"
    ON public.subscriptions FOR UPDATE
    USING (auth.uid() = provider_id);

CREATE POLICY "Admins can manage all subscriptions"
    ON public.subscriptions FOR ALL
    USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- 4. Cancellation Log Table
-- ============================================

CREATE TYPE public.cancelled_by_type AS ENUM ('client', 'provider');

CREATE TABLE public.cancellation_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    reason TEXT,
    cancelled_by public.cancelled_by_type NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cancellation_log IS 'Tracks booking cancellations for the strike/ban system';

ALTER TABLE public.cancellation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own cancellations"
    ON public.cancellation_log FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can log cancellations"
    ON public.cancellation_log FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND booking_id IN (
            SELECT b.id FROM public.bookings b
            WHERE b.client_id = auth.uid()
               OR b.provider_id = auth.uid()
        )
    );

CREATE POLICY "Admins can manage all cancellations"
    ON public.cancellation_log FOR ALL
    USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- 5. User Bans Table
-- ============================================

CREATE TYPE public.ban_type AS ENUM ('temporary', 'permanent');

CREATE TABLE public.user_bans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ban_type public.ban_type NOT NULL,
    reason TEXT NOT NULL,
    banned_until TIMESTAMP WITH TIME ZONE,
    strike_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE public.user_bans IS 'Tracks user bans based on cancellation strikes';
COMMENT ON COLUMN public.user_bans.banned_until IS 'NULL means permanent ban';

ALTER TABLE public.user_bans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own bans"
    ON public.user_bans FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all bans"
    ON public.user_bans FOR ALL
    USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- 6. Review Requires Completed Booking - Trigger
-- ============================================

CREATE OR REPLACE FUNCTION public.check_booking_completed_for_review()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.booking_id IS NULL THEN
        RAISE EXCEPTION 'A review must be linked to a booking';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.bookings
        WHERE id = NEW.booking_id
          AND status = 'completed'
    ) THEN
        RAISE EXCEPTION 'Reviews can only be submitted for completed bookings';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.bookings
        WHERE id = NEW.booking_id
          AND client_id = NEW.reviewer_id
    ) THEN
        RAISE EXCEPTION 'You can only review bookings where you are the client';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.bookings
        WHERE id = NEW.booking_id
          AND provider_id = NEW.provider_id
    ) THEN
        RAISE EXCEPTION 'The provider being reviewed must match the booking provider';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER enforce_completed_booking_for_review
    BEFORE INSERT ON public.reviews
    FOR EACH ROW EXECUTE FUNCTION public.check_booking_completed_for_review();

-- ============================================
-- 7. Helper Functions
-- ============================================

CREATE OR REPLACE FUNCTION public.is_user_banned(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_bans
        WHERE user_id = _user_id
          AND (
              ban_type = 'permanent'
              OR (ban_type = 'temporary' AND banned_until > now())
          )
    )
$$;

CREATE OR REPLACE FUNCTION public.get_cancellation_count(_user_id UUID, _days INTEGER DEFAULT 30)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COUNT(*)::INTEGER
    FROM public.cancellation_log
    WHERE user_id = _user_id
      AND created_at > now() - make_interval(days => _days)
$$;

-- ============================================
-- 8. Performance Indexes
-- ============================================

CREATE INDEX idx_profiles_provider_tier ON public.profiles (provider_tier)
    WHERE user_type = 'provider';

CREATE INDEX idx_profiles_city_tier ON public.profiles (city, provider_tier)
    WHERE user_type = 'provider' AND is_available = true;

CREATE INDEX idx_subscriptions_provider_status ON public.subscriptions (provider_id, status);

CREATE INDEX idx_subscriptions_expires_at ON public.subscriptions (expires_at)
    WHERE status = 'active';

CREATE INDEX idx_cancellation_log_user ON public.cancellation_log (user_id, created_at);

CREATE INDEX idx_cancellation_log_booking ON public.cancellation_log (booking_id);

CREATE INDEX idx_user_bans_user ON public.user_bans (user_id, ban_type);

CREATE INDEX idx_user_bans_expires ON public.user_bans (banned_until)
    WHERE ban_type = 'temporary';

CREATE INDEX idx_bookings_status ON public.bookings (status);

COMMIT;
