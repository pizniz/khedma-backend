-- ============================================
-- Migration: Add Portfolio Photos for Specialists
-- Date: 2026-02-14
-- Description:
--   1. portfolio_photos table for specialist provider portfolios
--   2. RLS policies (public read, owner write)
--   3. Performance index on provider_id + display_order
-- ============================================

BEGIN;

-- ============================================
-- 1. Portfolio Photos Table
-- ============================================

CREATE TABLE public.portfolio_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    url TEXT NOT NULL,
    caption TEXT,
    display_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.portfolio_photos IS 'Portfolio photos uploaded by specialist providers';

-- ============================================
-- 2. Row Level Security
-- ============================================

ALTER TABLE public.portfolio_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view portfolio photos"
    ON public.portfolio_photos FOR SELECT
    USING (true);

CREATE POLICY "Providers can insert own photos"
    ON public.portfolio_photos FOR INSERT
    WITH CHECK (auth.uid() = provider_id);

CREATE POLICY "Providers can update own photos"
    ON public.portfolio_photos FOR UPDATE
    USING (auth.uid() = provider_id);

CREATE POLICY "Providers can delete own photos"
    ON public.portfolio_photos FOR DELETE
    USING (auth.uid() = provider_id);

CREATE POLICY "Admins can manage all portfolio photos"
    ON public.portfolio_photos FOR ALL
    USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- 3. Performance Index
-- ============================================

CREATE INDEX idx_portfolio_provider ON public.portfolio_photos (provider_id, display_order);

COMMIT;
