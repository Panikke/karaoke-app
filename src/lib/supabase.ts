import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ── Types ─────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'dj' | 'viewer' | 'pending';

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  can_edit_playlist: boolean;
  created_at: string;
}
