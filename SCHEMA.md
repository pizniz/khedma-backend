# Database Schema Documentation

Complete documentation of the Khedma database schema, including tables, relationships, RLS policies, and functions.

## Table of Contents
1. [Enums](#enums)
2. [Tables](#tables)
3. [Row-Level Security](#row-level-security)
4. [Functions & Triggers](#functions--triggers)
5. [Storage Buckets](#storage-buckets)
6. [Indexes](#indexes)
7. [Relationships](#relationships)

---

## Enums

### `app_role`
User role types for admin access control.

```sql
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
```

**Values:**
- `admin` - Full system access
- `moderator` - Content moderation access
- `user` - Standard user (default)

### `user_type`
Distinguishes between service clients and providers.

```sql
CREATE TYPE public.user_type AS ENUM ('client', 'provider');
```

**Values:**
- `client` - Service requester
- `provider` - Service provider

### `booking_status`
Tracks the lifecycle of service bookings.

```sql
CREATE TYPE public.booking_status AS ENUM ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled');
```

**Values:**
- `pending` - Awaiting confirmation
- `confirmed` - Booking accepted
- `in_progress` - Service being performed
- `completed` - Service finished
- `cancelled` - Booking cancelled

### `quote_status`
Tracks quote proposal status.

```sql
CREATE TYPE public.quote_status AS ENUM ('pending', 'sent', 'accepted', 'rejected', 'expired');
```

### `message_type`
Types of messages in chat conversations.

```sql
CREATE TYPE public.message_type AS ENUM ('text', 'voice', 'image', 'system');
```

---

## Tables

### 1. `profiles`

User profile information linked to `auth.users`.

```sql
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
```

**Key Fields:**
- `user_id` - Links to `auth.users`, unique per user
- `user_type` - Either 'client' or 'provider'
- `is_verified` - Provider verification status (blue checkmark)
- `is_available` - Provider availability toggle

**Relationships:**
- → `auth.users` (one-to-one)
- ← `provider_services` (one-to-many)
- ← `service_requests` (one-to-many)
- ← `reviews` (one-to-many as reviewer or provider)

---

### 2. `user_roles`

Admin and moderator role assignments.

```sql
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role public.app_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    UNIQUE (user_id, role)
);
```

**Key Fields:**
- `role` - One of: admin, moderator, user
- Unique constraint on (user_id, role) prevents duplicates

**Usage:**
Used by `has_role()` function for permission checks in RLS policies.

---

### 3. `service_categories`

Service types available on the platform.

```sql
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
```

**Pre-populated Categories:**
1. Plumbing (plumbing)
2. Electrician (electrician)
3. Cleaning (cleaning)
4. Carpentry (carpentry)
5. Painting (painting)
6. Moving (moving)
7. Gardening (gardening)
8. AC Repair (ac-repair)
9. Appliance Repair (appliance-repair)
10. Handyman (handyman)

**Key Fields:**
- `slug` - URL-friendly identifier
- `icon` - Lucide icon name (e.g., "wrench")
- `color`, `bg_color` - Tailwind color classes
- `sort_order` - Display order in UI

---

### 4. `provider_services`

Services offered by individual providers.

```sql
CREATE TABLE public.provider_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE NOT NULL,
    category_id UUID REFERENCES public.service_categories(id) NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    price_min DECIMAL(10,2),
    price_max DECIMAL(10,2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
```

**Relationships:**
- → `profiles` (provider_id)
- → `service_categories` (category_id)

---

### 5. `service_requests`

Client requests for services.

```sql
CREATE TABLE public.service_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE NOT NULL,
    category_id UUID REFERENCES public.service_categories(id) NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    voice_note_url TEXT,
    location TEXT,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    urgency TEXT CHECK (urgency IN ('low', 'medium', 'high')),
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
```

**Key Fields:**
- `voice_note_url` - Optional voice description of the request
- `urgency` - Priority level (low/medium/high)
- `status` - Request lifecycle state
- `latitude`, `longitude` - GPS coordinates

---

### 6. `bookings`

Service booking records between clients and providers.

```sql
CREATE TABLE public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE NOT NULL,
    provider_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE NOT NULL,
    service_id UUID REFERENCES public.provider_services(id) ON DELETE SET NULL,
    request_id UUID REFERENCES public.service_requests(id) ON DELETE SET NULL,
    scheduled_date DATE,
    scheduled_time TIME,
    status public.booking_status DEFAULT 'pending',
    notes TEXT,
    total_price DECIMAL(10,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
```

**Relationships:**
- → `profiles` (client_id and provider_id)
- → `provider_services` (service_id) - nullable
- → `service_requests` (request_id) - nullable
- ← `reviews` (one-to-one after completion)

---

### 7. `quotes`

Provider pricing quotes for service requests.

```sql
CREATE TABLE public.quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID REFERENCES public.service_requests(id) ON DELETE CASCADE NOT NULL,
    provider_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    description TEXT,
    estimated_duration TEXT,
    status public.quote_status DEFAULT 'pending',
    valid_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
```

**Key Fields:**
- `price` - Quoted price for the service
- `estimated_duration` - E.g., "2-3 hours"
- `valid_until` - Quote expiration timestamp

---

### 8. `conversations`

Direct message conversations between two users.

```sql
CREATE TABLE public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_1 UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    participant_2 UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    UNIQUE (participant_1, participant_2),
    CHECK (participant_1 < participant_2)
);
```

**Key Constraints:**
- `UNIQUE (participant_1, participant_2)` - Prevents duplicate conversations
- `CHECK (participant_1 < participant_2)` - Ensures consistent ordering

**Indexes:**
- Index on `participant_1`, `participant_2` for fast lookups
- Index on `last_message_at` for sorting

---

### 9. `messages`

Individual messages in conversations.

```sql
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
    sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    message_type public.message_type DEFAULT 'text',
    content TEXT,
    media_url TEXT,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
```

**Key Fields:**
- `message_type` - text, voice, image, or system
- `content` - Text content (for text and system messages)
- `media_url` - URL for voice/image messages
- `is_read` - Read receipt status

**Real-time:** Enabled for live chat updates

**Indexes:**
- Index on `conversation_id`, `created_at` for message list queries

---

### 10. `reviews`

Service reviews and ratings.

```sql
CREATE TABLE public.reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reviewer_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE NOT NULL,
    provider_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE NOT NULL,
    booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    voice_review_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    UNIQUE (booking_id)
);
```

**Key Constraints:**
- `rating` - 1 to 5 stars (half-stars handled in UI)
- `UNIQUE (booking_id)` - One review per booking

**Key Fields:**
- `voice_review_url` - Optional voice review

---

### 11. `provider_photos`

Portfolio photos for provider profiles.

```sql
CREATE TABLE public.provider_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE NOT NULL,
    photo_url TEXT NOT NULL,
    caption TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
```

**Usage:**
Displayed in provider profile "Portfolio" tab

---

### 12. `favorites`

User bookmarked providers.

```sql
CREATE TABLE public.favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    provider_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    UNIQUE (user_id, provider_id)
);
```

**Key Constraints:**
- `UNIQUE (user_id, provider_id)` - Prevent duplicate favorites

---

### 13. `notifications`

In-app user notifications.

```sql
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    type TEXT,
    data JSONB,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
```

**Key Fields:**
- `type` - Notification category (message, booking, quote, review, etc.)
- `data` - JSONB for structured metadata
- `is_read` - Read status

**Real-time:** Enabled for instant notification delivery

---

## Row-Level Security

All tables have RLS enabled with appropriate policies:

### `profiles`
- ✅ SELECT: Everyone can view all profiles
- ✅ INSERT: Users can create their own profile
- ✅ UPDATE: Users can update their own profile

### `user_roles`
- ✅ SELECT: Users can view their own roles
- ✅ INSERT/UPDATE/DELETE: Admin only (via `has_role()`)

### `service_categories`
- ✅ SELECT: Everyone can view
- ✅ INSERT/UPDATE/DELETE: Admin only

### `provider_services`
- ✅ SELECT: Everyone can view active services
- ✅ INSERT/UPDATE/DELETE: Providers can manage their own

### `service_requests`
- ✅ SELECT: Clients see own requests, providers see open requests
- ✅ INSERT: Authenticated clients only
- ✅ UPDATE: Request owner only
- ✅ DELETE: Request owner only

### `bookings`
- ✅ SELECT: Clients and providers see bookings they're part of
- ✅ INSERT: Either client or provider can create
- ✅ UPDATE: Either party can update
- ✅ DELETE: Creator only

### `quotes`
- ✅ SELECT: Request owner and quote provider can view
- ✅ INSERT: Providers only
- ✅ UPDATE: Quote provider only

### `conversations`
- ✅ SELECT: Participants only
- ✅ INSERT: Authenticated users (with CHECK constraint)

### `messages`
- ✅ SELECT: Conversation participants only
- ✅ INSERT: Conversation participants only
- ✅ UPDATE: Message sender only (for editing)

### `reviews`
- ✅ SELECT: Everyone can view
- ✅ INSERT: Booking participants only, after booking completion
- ✅ UPDATE/DELETE: Review author only

### `provider_photos`
- ✅ SELECT: Everyone can view
- ✅ INSERT/UPDATE/DELETE: Provider owner only

### `favorites`
- ✅ SELECT: User can view their own favorites
- ✅ INSERT/DELETE: User can manage their own favorites

### `notifications`
- ✅ SELECT: User can view their own notifications
- ✅ UPDATE: User can mark their own notifications as read

---

## Functions & Triggers

### `has_role(user_id UUID, role app_role) RETURNS BOOLEAN`

Security definer function for checking user roles.

```sql
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = _user_id AND role = _role
    )
$$;
```

**Usage:**
```sql
-- In RLS policy
CREATE POLICY "Admins can delete categories"
    ON service_categories FOR DELETE
    USING (has_role(auth.uid(), 'admin'));
```

### `handle_new_user() RETURNS TRIGGER`

Automatically creates a profile when a user signs up.

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (user_id, full_name, phone)
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'full_name', 'User'),
        COALESCE(new.phone, '')
    );
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

### `update_updated_at_column() RETURNS TRIGGER`

Updates `updated_at` timestamp on row changes.

```sql
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Applied to:**
- profiles
- provider_services
- service_requests
- bookings
- quotes

---

## Storage Buckets

### `voice-messages`
- **Public:** Yes
- **File size limit:** 5MB
- **Allowed MIME types:** audio/webm, audio/wav, audio/mp3
- **Used for:** Chat voice messages, service request voice notes

**Policies:**
- Upload: Authenticated users only
- Read: Public (anyone with URL)

### `avatars`
- **Public:** Yes
- **File size limit:** 2MB
- **Allowed MIME types:** image/jpeg, image/png, image/webp
- **Used for:** Profile pictures

### `photos`
- **Public:** Yes
- **File size limit:** 5MB
- **Allowed MIME types:** image/jpeg, image/png, image/webp
- **Used for:** Provider portfolio photos

---

## Indexes

### Performance Indexes

```sql
-- Fast conversation lookups
CREATE INDEX idx_conversations_participants
    ON conversations(participant_1, participant_2);

CREATE INDEX idx_conversations_last_message
    ON conversations(last_message_at DESC);

-- Fast message queries
CREATE INDEX idx_messages_conversation
    ON messages(conversation_id, created_at DESC);

-- Fast service searches
CREATE INDEX idx_provider_services_category
    ON provider_services(category_id) WHERE is_active = true;

CREATE INDEX idx_service_requests_category
    ON service_requests(category_id) WHERE status = 'open';

-- Fast booking queries
CREATE INDEX idx_bookings_client ON bookings(client_id);
CREATE INDEX idx_bookings_provider ON bookings(provider_id);

-- Fast notification queries
CREATE INDEX idx_notifications_user_unread
    ON notifications(user_id) WHERE is_read = false;
```

---

## Relationships

```
auth.users
├── profiles (1:1)
│   ├── provider_services (1:N)
│   ├── service_requests (1:N as client)
│   ├── bookings (1:N as client or provider)
│   ├── quotes (1:N as provider)
│   ├── reviews (1:N as reviewer or provider)
│   ├── provider_photos (1:N)
│   └── favorites (1:N)
├── user_roles (1:N)
├── conversations (N:M)
├── messages (1:N)
└── notifications (1:N)

service_categories
├── provider_services (1:N)
└── service_requests (1:N)

service_requests
├── quotes (1:N)
└── bookings (1:1 optional)

bookings
└── reviews (1:1)
```

---

## Migration History

| Timestamp | Description |
|-----------|-------------|
| 20260122214855 | Initial schema: tables, enums, RLS policies |
| 20260122214905 | User roles and admin functions |
| 20260122215514 | Storage buckets configuration |

---

**Last Updated:** 2026-01-23
**Schema Version:** 1.0.0
