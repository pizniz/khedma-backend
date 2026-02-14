# Khedma Backend - Architecture & Development Guide

## Overview
Khedma is a Moroccan home services marketplace connecting clients with workers.
Two-tier provider system: Basic (free, informal workers) and Specialist (paid professionals).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENTS (Mobile/Web)                  │
│              React + Vite (Lovable-managed)              │
│         Bilingual: French + Arabic + Icon-heavy UI       │
├──────────────┬──────────────────────┬───────────────────┤
│   Supabase   │   Node.js API        │  WebRTC Signaling │
│   (Direct)   │   (Business Logic)   │  (Socket.io)      │
│              │                      │                   │
│  • Auth      │  • Tier management   │  • Call signaling  │
│  • Realtime  │  • Review validation │  • Specialist-only │
│  • Storage   │  • Ban/strike system │  • ICE candidates  │
│  • DB reads  │  • Subscriptions     │                   │
├──────────────┴──────────────────────┴───────────────────┤
│                    Supabase (PostgreSQL)                  │
│        13 core tables + tier system + trust system        │
└─────────────────────────────────────────────────────────┘
```

## Two-Tier Provider System

### Tier 1: Basic Worker ("Kheddam") - FREE
- Target: Older, often illiterate informal workers
- Signup: Phone + Name + Tap category icons (3 taps max)
- Phone number VISIBLE on profile (clients call directly)
- NO photos, NO reviews, NO portfolio
- Simple listing: "I do plumbing in Casablanca, call me"

### Tier 2: Specialist - PAID (subscription)
- Target: Literate professionals (electricians, plumbers, etc.)
- Full profile: bio, portfolio photos, reviews, verification badge
- Phone number HIDDEN - communication via in-app chat + WebRTC calls
- Reviews system (only after completed bookings)
- Monthly subscription (50-100 MAD via CMI/mobile money)

## Tech Stack

### Backend (this repo)
- **Database**: PostgreSQL via Supabase
- **API**: Node.js + Express + TypeScript (`/api` directory)
- **Auth**: Supabase Auth (phone OTP) + JWT verification middleware
- **Realtime**: Supabase Realtime (chat, notifications)
- **Signaling**: Socket.io for WebRTC call signaling
- **Storage**: Supabase Storage (voice messages, avatars, photos)

### Frontend (separate repo: khedma-frontend)
- **Managed by**: Lovable (AI frontend builder)
- **Stack**: React 18 + Vite + TypeScript + Tailwind + shadcn/ui
- **Languages**: French + Arabic (RTL) + Icon-heavy for accessibility
- **Repo**: https://github.com/pizniz/khedma-frontend

## Project Structure

```
khedma-backend/
├── supabase/
│   ├── migrations/          # SQL migrations (Supabase CLI)
│   └── config.toml          # Supabase config
├── api/                     # Node.js Express API
│   ├── src/
│   │   ├── index.ts         # Entry point
│   │   ├── config/          # Environment config
│   │   ├── middleware/       # Auth, rate limit, error handling, ban check
│   │   ├── routes/          # API endpoints
│   │   ├── services/        # Business logic
│   │   ├── signaling/       # WebRTC via Socket.io
│   │   └── types/           # TypeScript types
│   ├── package.json
│   └── tsconfig.json
├── CLAUDE.md                # This file
├── SCHEMA.md                # Database schema docs
└── README.md                # Setup instructions
```

## Business Rules (CRITICAL)

### Reviews
- Reviews can ONLY be created after booking status = 'completed'
- Both client AND provider must confirm completion
- One review per booking (enforced by UNIQUE constraint)
- Database trigger enforces this - cannot bypass via API

### Cancellation & Ban System
- Every cancellation is logged with reason
- 3 cancellations in 30 days → 7-day temporary ban
- 3 temporary bans → permanent ban
- Ban check runs on EVERY authenticated API request (middleware)
- Temporary bans auto-expire

### Phone Visibility
- Basic workers: phone ALWAYS visible (that's how clients reach them)
- Specialists: phone NEVER visible via API (enforced server-side)
- Specialists communicate via in-app chat + WebRTC calls only

### WebRTC Calls
- Only available when one party is a Specialist
- Signaling via Socket.io (no calls stored server-side)
- Call metadata logged for dispute resolution

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/health | No | Health check |
| GET | /api/providers | No | List providers (filter: tier, category, city) |
| GET | /api/providers/:id | No | Provider detail (phone hidden if specialist) |
| PUT | /api/providers/:id/tier | Yes | Upgrade to specialist |
| POST | /api/reviews | Yes | Create review (completion enforced) |
| GET | /api/reviews/:providerId | No | Provider reviews |
| POST | /api/bookings/:id/cancel | Yes | Cancel booking + strike tracking |
| POST | /api/subscriptions | Yes | Create specialist subscription |
| GET | /api/subscriptions/status | Yes | Check subscription status |

## Deployment
- VPS deployment (Node.js API)
- Supabase cloud (database, auth, storage, realtime)
- Frontend: Vercel/Netlify (via Lovable deploy)

## Development Commands

```bash
# Backend API
cd api && npm install && npm run dev

# Supabase migrations
supabase link --project-ref YOUR_PROJECT_ID
supabase db push

# Generate types for frontend
supabase gen types typescript --project-id YOUR_PROJECT_ID > types.ts
```

## Monetization Roadmap
1. **Phase 1 (Launch)**: Everything free - user acquisition
2. **Phase 2 (Traction)**: Specialist subscription ~50-100 MAD/month
3. **Phase 3 (Scale)**: Boost/promoted listings for specialists
