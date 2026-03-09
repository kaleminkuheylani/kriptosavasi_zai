import { getSupabase } from './supabase';
import type { Database } from './supabase';

// ============================================
// DATABASE HELPERS - SUPABASE ANON KEY
// ============================================

// ============================================
// USER HELPERS
// ============================================

export interface User {
  id: string;
  rumuz: string;
  avatar: string | null;
  created_at: string;
  updated_at: string;
}

export async function createUser(rumuz: string, avatar?: string): Promise<User | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('users')
    .insert({ rumuz: rumuz.toLowerCase(), avatar: avatar || null })
    .select()
    .single();
  
  if (error) {
    console.error('createUser error:', error);
    return null;
  }
  return data;
}

export async function getUserById(id: string): Promise<User | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single();
  
  if (error) return null;
  return data;
}

export async function getUserByRumuz(rumuz: string): Promise<User | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('rumuz', rumuz.toLowerCase())
    .single();
  
  if (error) return null;
  return data;
}

// ============================================
// WATCHLIST HELPERS
// ============================================

export interface WatchlistItem {
  id: string;
  symbol: string;
  name: string | null;
  target_price: number | null;
  notes: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function getWatchlist(userId: string | null): Promise<WatchlistItem[]> {
  const supabase = getSupabase();
  let query = supabase
    .from('watchlist')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (userId) {
    query = query.eq('user_id', userId);
  } else {
    query = query.is('user_id', null);
  }
  
  const { data, error } = await query;
  if (error) {
    console.error('getWatchlist error:', error);
    return [];
  }
  return data || [];
}

export async function addToWatchlist(
  symbol: string,
  name: string | null,
  userId: string | null
): Promise<WatchlistItem | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('watchlist')
    .insert({
      symbol: symbol.toUpperCase(),
      name,
      user_id: userId
    })
    .select()
    .single();
  
  if (error) {
    console.error('addToWatchlist error:', error);
    return null;
  }
  return data;
}

export async function removeFromWatchlist(symbol: string, userId: string | null): Promise<boolean> {
  const supabase = getSupabase();
  let query = supabase
    .from('watchlist')
    .delete()
    .eq('symbol', symbol.toUpperCase());
  
  if (userId) {
    query = query.eq('user_id', userId);
  } else {
    query = query.is('user_id', null);
  }
  
  const { error } = await query;
  return !error;
}

export async function isInWatchlist(symbol: string, userId: string | null): Promise<boolean> {
  const supabase = getSupabase();
  let query = supabase
    .from('watchlist')
    .select('id')
    .eq('symbol', symbol.toUpperCase());
  
  if (userId) {
    query = query.eq('user_id', userId);
  } else {
    query = query.is('user_id', null);
  }
  
  const { data, error } = await query.limit(1);
  return !error && (data?.length || 0) > 0;
}

// ============================================
// PRICE ALERTS HELPERS
// ============================================

export interface PriceAlert {
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
}

export async function getPriceAlerts(userId: string | null): Promise<PriceAlert[]> {
  const supabase = getSupabase();
  let query = supabase
    .from('price_alerts')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false });
  
  if (userId) {
    query = query.eq('user_id', userId);
  } else {
    query = query.is('user_id', null);
  }
  
  const { data, error } = await query;
  if (error) {
    console.error('getPriceAlerts error:', error);
    return [];
  }
  return data || [];
}

export async function createPriceAlert(
  symbol: string,
  targetPrice: number,
  condition: 'above' | 'below',
  userId: string | null
): Promise<PriceAlert | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('price_alerts')
    .insert({
      symbol: symbol.toUpperCase(),
      target_price: targetPrice,
      condition,
      user_id: userId
    })
    .select()
    .single();
  
  if (error) {
    console.error('createPriceAlert error:', error);
    return null;
  }
  return data;
}

export async function deletePriceAlert(id: string, userId: string | null): Promise<boolean> {
  const supabase = getSupabase();
  let query = supabase
    .from('price_alerts')
    .delete()
    .eq('id', id);
  
  if (userId) {
    query = query.eq('user_id', userId);
  } else {
    query = query.is('user_id', null);
  }
  
  const { error } = await query;
  return !error;
}

// ============================================
// CHAT MESSAGES HELPERS
// ============================================

export interface ChatMessageDB {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tools_used: string | null;
  query_type: string | null;
  symbols: string | null;
  user_id: string | null;
  created_at: string;
}

export async function saveChatMessage(
  role: 'user' | 'assistant' | 'system',
  content: string,
  userId: string | null,
  options?: {
    toolsUsed?: string[];
    queryType?: string;
    symbols?: string[];
  }
): Promise<ChatMessageDB | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      role,
      content,
      user_id: userId,
      tools_used: options?.toolsUsed ? JSON.stringify(options.toolsUsed) : null,
      query_type: options?.queryType || null,
      symbols: options?.symbols ? JSON.stringify(options.symbols) : null
    })
    .select()
    .single();
  
  if (error) {
    console.error('saveChatMessage error:', error);
    return null;
  }
  return data;
}

export async function getChatHistory(userId: string | null, limit: number = 50): Promise<ChatMessageDB[]> {
  const supabase = getSupabase();
  let query = supabase
    .from('chat_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (userId) {
    query = query.eq('user_id', userId);
  } else {
    query = query.is('user_id', null);
  }
  
  const { data, error } = await query;
  if (error) {
    console.error('getChatHistory error:', error);
    return [];
  }
  // Reverse to get chronological order
  return (data || []).reverse();
}

// ============================================
// SESSION HELPERS
// ============================================

export interface Session {
  id: string;
  user_id: string;
  token: string;
  expires_at: string;
  created_at: string;
}

export async function createSession(userId: string, token: string, expiresAt: Date): Promise<Session | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      token,
      expires_at: expiresAt.toISOString()
    })
    .select()
    .single();
  
  if (error) {
    console.error('createSession error:', error);
    return null;
  }
  return data;
}

export async function getSessionByToken(token: string): Promise<(Session & { users: User }) | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('sessions')
    .select('*, users(*)')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .single();
  
  if (error) return null;
  return data as Session & { users: User };
}

export async function deleteSession(token: string): Promise<boolean> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('token', token);
  return !error;
}

// ============================================
// STATS HELPERS
// ============================================

export async function getUserStats(userId: string): Promise<{
  watchlistCount: number;
  alertsCount: number;
}> {
  const supabase = getSupabase();
  
  const [watchlistResult, alertsResult] = await Promise.all([
    supabase.from('watchlist').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('price_alerts').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('active', true)
  ]);
  
  return {
    watchlistCount: watchlistResult.count || 0,
    alertsCount: alertsResult.count || 0
  };
}

export async function getPopularStocks(limit: number = 10): Promise<{
  symbol: string;
  name: string | null;
  count: number;
}[]> {
  const supabase = getSupabase();
  
  // Supabase doesn't support raw GROUP BY directly, use RPC or raw query
  // For simplicity, fetch all and group in JS
  const { data, error } = await supabase
    .from('watchlist')
    .select('symbol, name');
  
  if (error || !data) return [];
  
  // Group and count
  const counts = new Map<string, { name: string | null; count: number }>();
  for (const item of data) {
    const existing = counts.get(item.symbol);
    if (existing) {
      existing.count++;
    } else {
      counts.set(item.symbol, { name: item.name, count: 1 });
    }
  }
  
  // Sort and limit
  return Array.from(counts.entries())
    .map(([symbol, { name, count }]) => ({ symbol, name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
