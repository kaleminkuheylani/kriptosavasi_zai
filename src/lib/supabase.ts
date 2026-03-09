import { createClient } from '@supabase/supabase-js';

// ============================================
// SUPABASE CLIENT
// ============================================
// Server-side ve client-side kullanım için
// Anon key ile RLS politikaları üzerinden erişim

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables not set. Using fallback.');
}

// Server-side singleton
let serverSupabase: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (!serverSupabase) {
    serverSupabase = createClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseAnonKey || 'placeholder-key'
    );
  }
  return serverSupabase;
}

// Client-side singleton
let clientSupabase: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  if (typeof window === 'undefined') {
    return getSupabase(); // Server-side
  }
  
  if (!clientSupabase) {
    clientSupabase = createClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseAnonKey || 'placeholder-key'
    );
  }
  return clientSupabase;
}

// Default export
export const supabase = typeof window === 'undefined' ? getSupabase() : getSupabaseClient();

// Types
export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          rumuz: string;
          avatar: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          rumuz: string;
          avatar?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          rumuz?: string;
          avatar?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      watchlist: {
        Row: {
          id: string;
          symbol: string;
          name: string | null;
          target_price: number | null;
          notes: string | null;
          user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          symbol: string;
          name?: string | null;
          target_price?: number | null;
          notes?: string | null;
          user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          symbol?: string;
          name?: string | null;
          target_price?: number | null;
          notes?: string | null;
          user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      price_alerts: {
        Row: {
          id: string;
          symbol: string;
          target_price: number;
          condition: 'above' | 'below';
          active: boolean;
          triggered: boolean;
          triggered_at: string | null;
          user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          symbol: string;
          target_price: number;
          condition: 'above' | 'below';
          active?: boolean;
          triggered?: boolean;
          triggered_at?: string | null;
          user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          symbol?: string;
          target_price?: number;
          condition?: 'above' | 'below';
          active?: boolean;
          triggered?: boolean;
          triggered_at?: string | null;
          user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      chat_messages: {
        Row: {
          id: string;
          role: 'user' | 'assistant' | 'system';
          content: string;
          tools_used: string | null;
          query_type: string | null;
          symbols: string | null;
          user_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          role: 'user' | 'assistant' | 'system';
          content: string;
          tools_used?: string | null;
          query_type?: string | null;
          symbols?: string | null;
          user_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          role?: 'user' | 'assistant' | 'system';
          content?: string;
          tools_used?: string | null;
          query_type?: string | null;
          symbols?: string | null;
          user_id?: string | null;
          created_at?: string;
        };
      };
      sessions: {
        Row: {
          id: string;
          user_id: string;
          token: string;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          token: string;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          token?: string;
          expires_at?: string;
          created_at?: string;
        };
      };
    };
  };
};
