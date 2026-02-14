import { Request } from 'express';

// ─── Auth ────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  phone?: string;
  email?: string;
  user_metadata: Record<string, unknown>;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

// ─── Provider ────────────────────────────────────────────────

export type ProviderTier = 'basic' | 'specialist';

export interface Provider {
  id: string;
  user_id: string;
  full_name: string;
  phone?: string | null;
  avatar_url?: string | null;
  city?: string | null;
  bio?: string | null;
  provider_tier: ProviderTier;
  phone_visible: boolean;
  is_verified: boolean;
  is_available: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Booking ─────────────────────────────────────────────────

export type BookingStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

export interface Booking {
  id: string;
  client_id: string;
  provider_id: string;
  service_id?: string | null;
  request_id?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  status: BookingStatus;
  notes?: string | null;
  total_price?: number | null;
  created_at: string;
  updated_at: string;
}

// ─── Review ──────────────────────────────────────────────────

export interface Review {
  id: string;
  reviewer_id: string;
  provider_id: string;
  booking_id: string;
  rating: number;
  comment?: string | null;
  created_at: string;
  reviewer_name?: string;
}

// ─── Subscription ────────────────────────────────────────────

export type SubscriptionStatus = 'active' | 'expired' | 'cancelled';

export interface Subscription {
  id: string;
  provider_id: string;
  plan_type: string;
  status: SubscriptionStatus;
  started_at: string;
  expires_at: string;
  amount: number;
  payment_method?: string | null;
  payment_reference?: string | null;
  created_at: string;
}

// ─── Ban ─────────────────────────────────────────────────────

export type BanType = 'temporary' | 'permanent';

export interface Ban {
  id: string;
  user_id: string;
  ban_type: BanType;
  reason: string;
  banned_until?: string | null;
  strike_count: number;
  created_at: string;
}

export interface StrikeResult {
  banned: boolean;
  banType?: BanType;
  message: string;
  strikeCount: number;
}

// ─── API Response ────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── Portfolio Photo ─────────────────────────────────────────

export interface PortfolioPhoto {
  id: string;
  provider_id: string;
  storage_path: string;
  url: string;
  caption?: string | null;
  display_order: number;
  created_at: string;
}

// ─── Chat / Messaging ────────────────────────────────────────

export interface Conversation {
  id: string;
  participant_1: string;
  participant_2: string;
  last_message_at?: string | null;
  created_at: string;
}

export interface ConversationWithPreview extends Conversation {
  last_message?: string | null;
  last_message_at?: string | null;
  unread_count: number;
  other_user?: {
    user_id: string;
    full_name: string;
    avatar_url?: string | null;
  };
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  message_type?: string;
  content: string;
  media_url?: string | null;
  is_read: boolean;
  created_at: string;
}

// ─── WebRTC Signaling ────────────────────────────────────────

export interface SocketData {
  userId: string;
  tier?: ProviderTier;
}

export interface RTCSessionDescriptionInit {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface RTCIceCandidateInit {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
}
