import { sql } from '@vercel/postgres';

// ============================================
// DATABASE CONNECTION
// ============================================

// Vercel Postgres client (otomatik connection pooling)
export { sql };

// Helper function for query with error handling
export async function query<T = unknown>(
  queryText: string,
  params?: (string | number | boolean | null)[]
): Promise<{ rows: T[]; rowCount: number }> {
  try {
    const result = await sql.query<T>(queryText, params || []);
    return {
      rows: result.rows,
      rowCount: result.rowCount
    };
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

// ============================================
// USER HELPERS
// ============================================

export interface User {
  id: string;
  rumuz: string;
  avatar: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function createUser(rumuz: string, avatar?: string): Promise<User> {
  const result = await sql<User>`
    INSERT INTO users (rumuz, avatar)
    VALUES (${rumuz.toLowerCase()}, ${avatar || null})
    RETURNING *
  `;
  return result.rows[0];
}

export async function getUserById(id: string): Promise<User | null> {
  const result = await sql<User>`
    SELECT * FROM users WHERE id = ${id}
  `;
  return result.rows[0] || null;
}

export async function getUserByRumuz(rumuz: string): Promise<User | null> {
  const result = await sql<User>`
    SELECT * FROM users WHERE rumuz = ${rumuz.toLowerCase()}
  `;
  return result.rows[0] || null;
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
  created_at: Date;
  updated_at: Date;
}

export async function getWatchlist(userId: string | null): Promise<WatchlistItem[]> {
  if (userId) {
    const result = await sql<WatchlistItem>`
      SELECT * FROM watchlist WHERE user_id = ${userId} ORDER BY created_at DESC
    `;
    return result.rows;
  } else {
    const result = await sql<WatchlistItem>`
      SELECT * FROM watchlist WHERE user_id IS NULL ORDER BY created_at DESC
    `;
    return result.rows;
  }
}

export async function addToWatchlist(
  symbol: string,
  name: string | null,
  userId: string | null
): Promise<WatchlistItem> {
  const result = await sql<WatchlistItem>`
    INSERT INTO watchlist (symbol, name, user_id)
    VALUES (${symbol.toUpperCase()}, ${name}, ${userId})
    RETURNING *
  `;
  return result.rows[0];
}

export async function removeFromWatchlist(symbol: string, userId: string | null): Promise<void> {
  if (userId) {
    await sql`DELETE FROM watchlist WHERE symbol = ${symbol.toUpperCase()} AND user_id = ${userId}`;
  } else {
    await sql`DELETE FROM watchlist WHERE symbol = ${symbol.toUpperCase()} AND user_id IS NULL`;
  }
}

export async function isInWatchlist(symbol: string, userId: string | null): Promise<boolean> {
  let result;
  if (userId) {
    result = await sql`
      SELECT 1 FROM watchlist WHERE symbol = ${symbol.toUpperCase()} AND user_id = ${userId}
    `;
  } else {
    result = await sql`
      SELECT 1 FROM watchlist WHERE symbol = ${symbol.toUpperCase()} AND user_id IS NULL
    `;
  }
  return result.rows.length > 0;
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
  triggered_at: Date | null;
  user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function getPriceAlerts(userId: string | null): Promise<PriceAlert[]> {
  if (userId) {
    const result = await sql<PriceAlert>`
      SELECT * FROM price_alerts WHERE user_id = ${userId} AND active = true ORDER BY created_at DESC
    `;
    return result.rows;
  } else {
    const result = await sql<PriceAlert>`
      SELECT * FROM price_alerts WHERE user_id IS NULL AND active = true ORDER BY created_at DESC
    `;
    return result.rows;
  }
}

export async function createPriceAlert(
  symbol: string,
  targetPrice: number,
  condition: 'above' | 'below',
  userId: string | null
): Promise<PriceAlert> {
  const result = await sql<PriceAlert>`
    INSERT INTO price_alerts (symbol, target_price, condition, user_id)
    VALUES (${symbol.toUpperCase()}, ${targetPrice}, ${condition}, ${userId})
    RETURNING *
  `;
  return result.rows[0];
}

export async function deletePriceAlert(id: string, userId: string | null): Promise<void> {
  if (userId) {
    await sql`DELETE FROM price_alerts WHERE id = ${id} AND user_id = ${userId}`;
  } else {
    await sql`DELETE FROM price_alerts WHERE id = ${id} AND user_id IS NULL`;
  }
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
  created_at: Date;
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
): Promise<ChatMessageDB> {
  const result = await sql<ChatMessageDB>`
    INSERT INTO chat_messages (role, content, user_id, tools_used, query_type, symbols)
    VALUES (
      ${role},
      ${content},
      ${userId},
      ${options?.toolsUsed ? JSON.stringify(options.toolsUsed) : null},
      ${options?.queryType || null},
      ${options?.symbols ? JSON.stringify(options.symbols) : null}
    )
    RETURNING *
  `;
  return result.rows[0];
}

export async function getChatHistory(userId: string | null, limit: number = 50): Promise<ChatMessageDB[]> {
  if (userId) {
    const result = await sql<ChatMessageDB>`
      SELECT * FROM chat_messages 
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return result.rows.reverse();
  } else {
    const result = await sql<ChatMessageDB>`
      SELECT * FROM chat_messages 
      WHERE user_id IS NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return result.rows.reverse();
  }
}

// ============================================
// STATS HELPERS
// ============================================

export async function getUserStats(userId: string): Promise<{
  watchlistCount: number;
  alertsCount: number;
}> {
  const watchlistResult = await sql`
    SELECT COUNT(*) as count FROM watchlist WHERE user_id = ${userId}
  `;
  const alertsResult = await sql`
    SELECT COUNT(*) as count FROM price_alerts WHERE user_id = ${userId} AND active = true
  `;

  return {
    watchlistCount: parseInt(watchlistResult.rows[0]?.count || '0'),
    alertsCount: parseInt(alertsResult.rows[0]?.count || '0')
  };
}

export async function getPopularStocks(limit: number = 10): Promise<{
  symbol: string;
  name: string | null;
  count: number;
}[]> {
  const result = await sql<{ symbol: string; name: string | null; count: bigint }>`
    SELECT symbol, name, COUNT(*) as count
    FROM watchlist
    GROUP BY symbol, name
    ORDER BY count DESC
    LIMIT ${limit}
  `;
  return result.rows.map(r => ({
    symbol: r.symbol,
    name: r.name,
    count: Number(r.count)
  }));
}
