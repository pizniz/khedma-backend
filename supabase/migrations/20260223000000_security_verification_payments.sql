-- =====================================================
-- Migration: Security + Identity Verification + Payment Discounts + Review Anti-Fraud
-- Date: 2026-02-23
-- =====================================================

-- ─── 1. IDENTITY VERIFICATION TABLE ─────────────────
-- InDrive-style: CIN photo + selfie → manual/auto verification

CREATE TYPE public.verification_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE IF NOT EXISTS public.identity_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cin_photo_url TEXT NOT NULL,
  selfie_url TEXT NOT NULL,
  status public.verification_status NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT one_pending_verification_per_user UNIQUE (user_id)
);

-- Index for admin dashboard queries
CREATE INDEX idx_verifications_status ON public.identity_verifications(status);
CREATE INDEX idx_verifications_user ON public.identity_verifications(user_id);

-- RLS
ALTER TABLE public.identity_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own verification"
  ON public.identity_verifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can submit verification"
  ON public.identity_verifications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can manage verifications"
  ON public.identity_verifications FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ─── 2. UNIQUE REVIEW PER BOOKING (Anti-Fraud) ──────
-- Prevent multiple reviews on same booking

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_booking_id_unique'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_booking_id_unique UNIQUE (booking_id);
  END IF;
END $$;

-- ─── 3. PAYMENT METHOD & DISCOUNT ON BOOKINGS ───────
-- Track how payment was made + apply discount for online payments

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'payment_method'
  ) THEN
    ALTER TABLE public.bookings
      ADD COLUMN payment_method TEXT DEFAULT 'cash',
      ADD COLUMN discount_percent NUMERIC(5,2) DEFAULT 0,
      ADD COLUMN original_price NUMERIC(10,2),
      ADD COLUMN final_price NUMERIC(10,2);
  END IF;
END $$;

-- ─── 4. ADD VERIFICATION FIELDS TO PROFILES ─────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'verification_status'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN verification_status TEXT DEFAULT 'unverified';
  END IF;
END $$;

-- ─── 5. PERFORMANCE INDEXES ─────────────────────────

CREATE INDEX IF NOT EXISTS idx_user_bans_active
  ON public.user_bans(user_id, ban_type)
  WHERE banned_until IS NULL OR banned_until > now();

CREATE INDEX IF NOT EXISTS idx_cancellation_log_recent
  ON public.cancellation_log(user_id, cancelled_at);

CREATE INDEX IF NOT EXISTS idx_bookings_payment
  ON public.bookings(payment_method);

-- ─── 6. AUDIT LOG TABLE ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_audit_user ON public.audit_log(user_id);
CREATE INDEX idx_audit_action ON public.audit_log(action);
CREATE INDEX idx_audit_created ON public.audit_log(created_at);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit logs"
  ON public.audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
