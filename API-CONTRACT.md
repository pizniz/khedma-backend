# Khedma API Contract

**Base URL**: `http://72.61.194.12:3002/api`
**Auth**: Bearer token (Supabase JWT) in `Authorization` header
**WebRTC Signaling**: `ws://72.61.194.12:3002/signaling`
**Supabase URL**: `https://wzkixenddcoezhxpavbn.supabase.co`
**Supabase Anon Key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6a2l4ZW5kZGNvZXpoeHBhdmJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExMDE0NjcsImV4cCI6MjA4NjY3NzQ2N30.meeliNJVRO7e3fNC_PXS6RI6XmNdAN5hnIjXPNejvwc`

## Endpoints

### Health
```
GET /api/health → { success, data: { status, service, timestamp, uptime } }
```

### Providers

```
GET /api/providers
  Query: ?page=1&limit=20&tier=basic|specialist&category=plumbing&city=Casablanca&search=ahmed
  → { success, data: Provider[], pagination }

GET /api/providers/:userId
  → { success, data: Provider }
  Note: Phone is null for specialists (unless viewing own profile)

PUT /api/providers/:userId/tier  [AUTH]
  → { success, data: Provider, message }
  Note: Requires active subscription
```

### Reviews

```
POST /api/reviews  [AUTH]
  Body: { booking_id: uuid, rating: 1-5, comment?: string }
  → { success, data: Review, message }
  Note: Booking MUST be 'completed'. Only the client can review.

GET /api/reviews/:providerId
  Query: ?page=1&limit=20
  → { success, data: Review[], pagination }
```

### Bookings

```
POST /api/bookings/:bookingId/cancel  [AUTH]
  Body: { reason: string (min 5 chars) }
  → { success, data: Booking, message, ban?: { type, message } }
  Note: 3 cancels in 30 days = 7-day ban. 3 temp bans = permanent.
```

### Subscriptions

```
POST /api/subscriptions  [AUTH]
  Body: { plan_type: 'specialist_monthly' | 'specialist_yearly', payment_method?, payment_reference? }
  → { success, data: Subscription, message }

GET /api/subscriptions/status  [AUTH]
  → { success, data: Subscription | null }

DELETE /api/subscriptions  [AUTH]
  → { success, data: Subscription, message }
```

### WebRTC Signaling (Socket.io)

```
Path: /signaling
Auth: { token: supabase_jwt } in handshake.auth

Events (client → server):
  join-room(roomId)     - Format: "call_{userId1}_{userId2}"
  offer({ room, sdp })
  answer({ room, sdp })
  ice-candidate({ room, candidate })
  call-end({ room })

Events (server → client):
  user-joined({ userId })
  offer({ sdp, from })
  answer({ sdp, from })
  ice-candidate({ candidate, from })
  call-ended({ from })
  error({ message })

Rule: At least one party must be a specialist for WebRTC calls.
```

## Types

```typescript
interface Provider {
  id: string;
  user_id: string;
  full_name: string;
  phone: string | null;        // null for specialists
  avatar_url: string | null;
  city: string | null;
  bio: string | null;
  provider_tier: 'basic' | 'specialist';
  phone_visible: boolean;
  is_verified: boolean;
  is_available: boolean;
  created_at: string;
  updated_at: string;
}

interface Review {
  id: string;
  reviewer_id: string;
  provider_id: string;
  booking_id: string;
  rating: number;              // 1-5
  comment: string | null;
  created_at: string;
  reviewer_name: string;
}

interface Subscription {
  id: string;
  provider_id: string;
  plan_type: string;
  status: 'active' | 'expired' | 'cancelled';
  started_at: string;
  expires_at: string;
  amount: number;
  payment_method: string | null;
  payment_reference: string | null;
  created_at: string;
}
```

## Error Responses

```json
{
  "success": false,
  "error": "Error message",
  "details": [{ "field": "rating", "message": "Must be between 1 and 5" }]
}
```

## Banned User Response (403)

```json
{
  "success": false,
  "error": "Account banned",
  "message": "Your account is temporarily banned until 2026-02-21.",
  "ban": { "type": "temporary", "reason": "3 cancellations", "expires_at": "..." }
}
```
