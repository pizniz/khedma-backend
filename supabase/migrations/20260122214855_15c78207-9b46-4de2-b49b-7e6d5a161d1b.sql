-- ============================================
-- Moroccan Home Services Marketplace Database
-- ============================================

-- Create enum for user roles
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- Create enum for user types
CREATE TYPE public.user_type AS ENUM ('client', 'provider');

-- Create enum for booking status
CREATE TYPE public.booking_status AS ENUM ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled');

-- Create enum for quote status
CREATE TYPE public.quote_status AS ENUM ('pending', 'sent', 'accepted', 'rejected', 'expired');

-- Create enum for message type
CREATE TYPE public.message_type AS ENUM ('text', 'voice', 'image', 'system');

-- ============================================
-- Profiles Table (linked to auth.users)
-- ============================================
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    user_type public.user_type NOT NULL DEFAULT 'client',
    full_name TEXT NOT NULL,
    phone TEXT,
    avatar_url TEXT,
    city TEXT,
    address TEXT,
    bio TEXT,
    is_verified BOOLEAN DEFAULT false,
    is_available BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles are viewable by everyone
CREATE POLICY "Profiles are viewable by everyone"
    ON public.profiles FOR SELECT
    USING (true);

-- Users can update their own profile
CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can insert their own profile
CREATE POLICY "Users can insert their own profile"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- ============================================
-- User Roles Table (for admin access)
-- ============================================
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role public.app_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    UNIQUE (user_id, role)
);

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = _user_id
          AND role = _role
    )
$$;

-- ============================================
-- Service Categories Table
-- ============================================
CREATE TABLE public.service_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT,
    bg_color TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;

-- Categories are viewable by everyone
CREATE POLICY "Categories are viewable by everyone"
    ON public.service_categories FOR SELECT
    USING (true);

-- Only admins can modify categories
CREATE POLICY "Admins can manage categories"
    ON public.service_categories FOR ALL
    USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- Provider Services Table (services offered by providers)
-- ============================================
CREATE TABLE public.provider_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    category_id UUID REFERENCES public.service_categories(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    price_min DECIMAL(10,2),
    price_max DECIMAL(10,2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.provider_services ENABLE ROW LEVEL SECURITY;

-- Services are viewable by everyone
CREATE POLICY "Services are viewable by everyone"
    ON public.provider_services FOR SELECT
    USING (true);

-- Providers can manage their own services
CREATE POLICY "Providers can manage their services"
    ON public.provider_services FOR ALL
    USING (provider_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

-- ============================================
-- Service Requests Table (from clients)
-- ============================================
CREATE TABLE public.service_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    category_id UUID REFERENCES public.service_categories(id) NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    voice_note_url TEXT,
    location TEXT,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    urgency TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'open',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;

-- Clients can view their own requests
CREATE POLICY "Clients can view their requests"
    ON public.service_requests FOR SELECT
    USING (client_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

-- Providers can view open requests in their categories
CREATE POLICY "Providers can view open requests"
    ON public.service_requests FOR SELECT
    USING (status = 'open');

-- Clients can create requests
CREATE POLICY "Clients can create requests"
    ON public.service_requests FOR INSERT
    WITH CHECK (client_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

-- Clients can update their own requests
CREATE POLICY "Clients can update their requests"
    ON public.service_requests FOR UPDATE
    USING (client_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

-- ============================================
-- Bookings Table
-- ============================================
CREATE TABLE public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    provider_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    service_id UUID REFERENCES public.provider_services(id),
    request_id UUID REFERENCES public.service_requests(id),
    scheduled_date DATE,
    scheduled_time TIME,
    status public.booking_status DEFAULT 'pending',
    notes TEXT,
    total_price DECIMAL(10,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Users can view bookings they're part of
CREATE POLICY "Users can view their bookings"
    ON public.bookings FOR SELECT
    USING (
        client_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
        OR provider_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    );

-- Clients can create bookings
CREATE POLICY "Clients can create bookings"
    ON public.bookings FOR INSERT
    WITH CHECK (client_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

-- Both parties can update bookings
CREATE POLICY "Participants can update bookings"
    ON public.bookings FOR UPDATE
    USING (
        client_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
        OR provider_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    );

-- ============================================
-- Quotes Table
-- ============================================
CREATE TABLE public.quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID REFERENCES public.service_requests(id) ON DELETE CASCADE NOT NULL,
    provider_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    description TEXT,
    estimated_duration TEXT,
    status public.quote_status DEFAULT 'pending',
    valid_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

-- Quote participants can view quotes
CREATE POLICY "Participants can view quotes"
    ON public.quotes FOR SELECT
    USING (
        provider_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
        OR request_id IN (SELECT id FROM public.service_requests WHERE client_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()))
    );

-- Providers can create quotes
CREATE POLICY "Providers can create quotes"
    ON public.quotes FOR INSERT
    WITH CHECK (provider_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

-- Participants can update quotes
CREATE POLICY "Participants can update quotes"
    ON public.quotes FOR UPDATE
    USING (
        provider_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
        OR request_id IN (SELECT id FROM public.service_requests WHERE client_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()))
    );

-- ============================================
-- Conversations Table
-- ============================================
CREATE TABLE public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_1 UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    participant_2 UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- Participants can view their conversations
CREATE POLICY "Participants can view conversations"
    ON public.conversations FOR SELECT
    USING (
        participant_1 IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
        OR participant_2 IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    );

-- Users can create conversations
CREATE POLICY "Users can create conversations"
    ON public.conversations FOR INSERT
    WITH CHECK (
        participant_1 IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
        OR participant_2 IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    );

-- ============================================
-- Messages Table
-- ============================================
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
    sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    message_type public.message_type DEFAULT 'text',
    content TEXT,
    media_url TEXT,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Conversation participants can view messages
CREATE POLICY "Participants can view messages"
    ON public.messages FOR SELECT
    USING (
        conversation_id IN (
            SELECT id FROM public.conversations 
            WHERE participant_1 IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
               OR participant_2 IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
        )
    );

-- Participants can send messages
CREATE POLICY "Participants can send messages"
    ON public.messages FOR INSERT
    WITH CHECK (
        sender_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
        AND conversation_id IN (
            SELECT id FROM public.conversations 
            WHERE participant_1 IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
               OR participant_2 IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
        )
    );

-- Participants can update messages (mark as read)
CREATE POLICY "Participants can update messages"
    ON public.messages FOR UPDATE
    USING (
        conversation_id IN (
            SELECT id FROM public.conversations 
            WHERE participant_1 IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
               OR participant_2 IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
        )
    );

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- ============================================
-- Reviews Table
-- ============================================
CREATE TABLE public.reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reviewer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    provider_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    booking_id UUID REFERENCES public.bookings(id),
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    voice_review_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Reviews are viewable by everyone
CREATE POLICY "Reviews are viewable by everyone"
    ON public.reviews FOR SELECT
    USING (true);

-- Users can create reviews for their bookings
CREATE POLICY "Users can create reviews"
    ON public.reviews FOR INSERT
    WITH CHECK (reviewer_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

-- ============================================
-- Provider Photos Table
-- ============================================
CREATE TABLE public.provider_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    photo_url TEXT NOT NULL,
    caption TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.provider_photos ENABLE ROW LEVEL SECURITY;

-- Photos are viewable by everyone
CREATE POLICY "Photos are viewable by everyone"
    ON public.provider_photos FOR SELECT
    USING (true);

-- Providers can manage their photos
CREATE POLICY "Providers can manage their photos"
    ON public.provider_photos FOR ALL
    USING (provider_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

-- ============================================
-- Favorites Table
-- ============================================
CREATE TABLE public.favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    provider_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    UNIQUE (user_id, provider_id)
);

-- Enable RLS
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

-- Users can view their favorites
CREATE POLICY "Users can view their favorites"
    ON public.favorites FOR SELECT
    USING (user_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

-- Users can manage their favorites
CREATE POLICY "Users can manage their favorites"
    ON public.favorites FOR ALL
    USING (user_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

-- ============================================
-- Notifications Table
-- ============================================
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    type TEXT DEFAULT 'general',
    data JSONB,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can view their notifications
CREATE POLICY "Users can view their notifications"
    ON public.notifications FOR SELECT
    USING (user_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

-- Users can update their notifications
CREATE POLICY "Users can update their notifications"
    ON public.notifications FOR UPDATE
    USING (user_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

-- ============================================
-- Functions and Triggers
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Apply to relevant tables
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_provider_services_updated_at
    BEFORE UPDATE ON public.provider_services
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_service_requests_updated_at
    BEFORE UPDATE ON public.service_requests
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_bookings_updated_at
    BEFORE UPDATE ON public.bookings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_quotes_updated_at
    BEFORE UPDATE ON public.quotes
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function to create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (user_id, full_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to auto-create profile
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- Insert Default Categories
-- ============================================
INSERT INTO public.service_categories (slug, name, icon, color, bg_color, sort_order) VALUES
    ('plumber', 'Plumber', 'Droplets', 'text-blue-600', 'bg-blue-100', 1),
    ('electrician', 'Electrician', 'Zap', 'text-amber-500', 'bg-amber-100', 2),
    ('cleaner', 'Cleaner', 'Sparkles', 'text-teal-600', 'bg-teal-100', 3),
    ('painter', 'Painter', 'Paintbrush', 'text-purple-600', 'bg-purple-100', 4),
    ('carpenter', 'Carpenter', 'Hammer', 'text-orange-600', 'bg-orange-100', 5),
    ('gardener', 'Gardener', 'Trees', 'text-green-600', 'bg-green-100', 6),
    ('hvac', 'AC/Heating', 'Wind', 'text-sky-600', 'bg-sky-100', 7),
    ('locksmith', 'Locksmith', 'Key', 'text-gray-600', 'bg-gray-100', 8),
    ('moving', 'Moving', 'Truck', 'text-rose-600', 'bg-rose-100', 9),
    ('appliance', 'Appliance Repair', 'Wrench', 'text-indigo-600', 'bg-indigo-100', 10);