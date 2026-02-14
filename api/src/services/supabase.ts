import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

// Admin client - bypasses RLS, for server-side operations
export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Create a user-scoped client that respects RLS
export function createUserClient(accessToken: string) {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}
