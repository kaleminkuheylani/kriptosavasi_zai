import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabase } from '@/lib/supabase';
import ZAI from 'z-ai-web-dev-sdk';

// ============================================
// TYPES & INTERFACES
// ============================================

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  _meta?: {
    tool: string;
    duration: number;
  };
}

interface SSEMessage {
  type: 'progress' | 'tool_start' | 'tool_result' | 'llm_start' | 'complete' | 'error';
  data: {
    tool?: string;
    status?: 'pending' | 'running' | 'completed' | 'error';
    message?: string;
    result?: unknown;
    response?: string;
    toolsUsed?: string[];
    queryType?: string;
    symbols?: string[];
    error?: string;
    requiresAuth?: boolean;
    [key: string]: unknown;
  };
}

// ============================================
// TOOLS DEFINITION
// ============================================

const TOOLS_INFO: Record<string, { name: string; description: string }> = {
  get_stock_price:         { name: 'Hisse Fiyatı',    description: 'BIST güncel fiyat verisi alınıyor...' },
  get_stock_history:       { name: 'Geçmiş Veri',     description: 'BIST tarihsel veriler analiz ediliyor...' },
  get_global_quote:        { name: 'Global Fiyat',    description: 'Global hisse fiyatı yfinance\'tan alınıyor...' },
  get_global_history:      { name: 'Global Geçmiş',   description: 'Global tarihsel veri analiz ediliyor...' },
  get_financials:          { name: 'Finansallar',     description: 'Bilanço ve gelir tablosu alınıyor...' },
  get_options:             { name: 'Opsiyon Zinciri', description: 'Opsiyon verileri alınıyor...' },
  search_ticker:           { name: 'Sembol Ara',      description: 'Hisse sembolü aranıyor...' },
  compare_stocks:          { name: 'Karşılaştırma',   description: 'Hisseler karşılaştırılıyor...' },
  get_watchlist:           { name: 'Takip Listesi',   description: 'Takip listesi kontrol ediliyor...' },
  add_to_watchlist:        { name: 'Takibe Ekle',     description: 'Hisse takibe ekleniyor...' },
  remove_from_watchlist:   { name: 'Takipten Çık',    description: 'Hisse takipten çıkarılıyor...' },
  web_search:              { name: 'Web Araması',     description: 'Web\'de arama yapılıyor...' },
  get_kap_data:            { name: 'KAP Verileri',    description: 'KAP bildirimleri alınıyor...' },
  get_news:                { name: 'Haberler',        description: 'Finansal haberler alınıyor...' },
  analyze_chart_image:     { name: 'Grafik Analizi',  description: 'Grafik analiz ediliyor...' },
  read_txt_file:           { name: 'TXT Analizi',     description: 'Dosya analiz ediliyor...' },
};

// OpenAI-style tool schema for the autonomous agent loop
const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'get_stock_price',
      description: 'Get current BIST (Borsa İstanbul) stock price and basic info.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'BIST ticker symbol e.g. THYAO, GARAN' }
        },
        required: ['symbol']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_stock_history',
      description: 'Get BIST stock historical data and technical indicators (SMA, RSI, trend).',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'BIST ticker symbol' },
          period: { type: 'string', enum: ['1M', '3M', '6M', '1Y'], description: 'Time period' }
        },
        required: ['symbol']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_global_quote',
      description: 'Get current global stock/ETF/crypto quote via yfinance (Yahoo Finance). Use for AAPL, TSLA, MSFT, BTC-USD, SPY, etc.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Yahoo Finance symbol e.g. AAPL, TSLA, BTC-USD, SPY, QQQ' }
        },
        required: ['symbol']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_global_history',
      description: 'Get historical price data and technical analysis for global stocks via yfinance.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Yahoo Finance symbol' },
          period: { type: 'string', enum: ['1mo', '3mo', '6mo', '1y', '2y', '5y'], description: 'Time period' },
          interval: { type: 'string', enum: ['1d', '1wk', '1mo'], description: 'Bar interval' }
        },
        required: ['symbol']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_financials',
      description: 'Get financial statements (income statement, balance sheet, cash flow) for a global stock.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Yahoo Finance symbol' }
        },
        required: ['symbol']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_options',
      description: 'Get options chain data for a global stock.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Yahoo Finance symbol' }
        },
        required: ['symbol']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_ticker',
      description: 'Search for a ticker symbol by company name.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Company name or partial symbol' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compare_stocks',
      description: 'Compare performance of multiple global stocks over a period.',
      parameters: {
        type: 'object',
        properties: {
          symbols: { type: 'string', description: 'Comma-separated symbols e.g. AAPL,MSFT,GOOG' },
          period: { type: 'string', enum: ['1mo', '3mo', '6mo', '1y'], description: 'Time period' }
        },
        required: ['symbols']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for latest financial news, analysis, or any information.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_news',
      description: 'Get latest financial news for a specific stock or general BIST market.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Optional stock symbol. Leave empty for general market news.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_kap_data',
      description: 'Get KAP (Public Disclosure Platform) announcements for a BIST stock.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'BIST ticker symbol' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_watchlist',
      description: 'Get the user\'s current watchlist.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_to_watchlist',
      description: 'Add a stock to the user\'s watchlist.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          name: { type: 'string' }
        },
        required: ['symbol', 'name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remove_from_watchlist',
      description: 'Remove a stock from the user\'s watchlist.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string' }
        },
        required: ['symbol']
      }
    }
  },
];

// ============================================
// CACHE
// ============================================

const stockPriceCache: Map<string, { data: unknown; timestamp: number }> = new Map();
const CACHE_TTL = 60000;

// ============================================
// SSE HELPER
// ============================================

function createSSEEncoder() {
  const encoder = new TextEncoder();
  return {
    encode: (message: SSEMessage) => {
      return encoder.encode(`data: ${JSON.stringify(message)}\n\n`);
    }
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function getCurrentUserId(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get('userId')?.value || null;
  } catch {
    return null;
  }
}

function getBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  return 'http://localhost:3000';
}

// ============================================
// BIST TOOL IMPLEMENTATIONS
// ============================================

async function getStockPrice(symbol: string): Promise<ToolResult> {
  const startTime = Date.now();
  const cached = stockPriceCache.get(symbol);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { ...(cached.data as ToolResult), _meta: { tool: 'get_stock_price', duration: 0 } };
  }

  try {
    const response = await fetch(`https://api.asenax.com/bist/get/${symbol.toUpperCase()}`);
    const data = await response.json();

    if (data.code === '0' && data.data?.hisseYuzeysel) {
      const d = data.data.hisseYuzeysel;
      const result: ToolResult = {
        success: true,
        data: {
          symbol: d.sembol,
          name: d.aciklama,
          price: d.kapanis,
          change: d.net,
          changePercent: d.yuzdedegisim,
          volume: d.hacimlot,
          high: d.yuksek,
          low: d.dusuk,
          open: d.acilis,
          previousClose: d.dunkukapanis,
          ceiling: d.tavan,
          floor: d.taban,
          market: 'BIST',
        },
        _meta: { tool: 'get_stock_price', duration: Date.now() - startTime }
      };
      stockPriceCache.set(symbol, { data: result, timestamp: Date.now() });
      return result;
    }
    return { success: false, error: 'Hisse bulunamadı', _meta: { tool: 'get_stock_price', duration: Date.now() - startTime } };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'get_stock_price', duration: Date.now() - startTime } };
  }
}

async function getStockHistory(symbol: string, period: string = '1M'): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const rangeMap: Record<string, number> = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };
    const days = rangeMap[period] || 30;

    const response = await fetch(
      `https://internal-api.z.ai/external/finance/v1/markets/stock/history?symbol=${symbol.toUpperCase()}.IS&interval=1d`,
      { headers: { 'X-Z-AI-From': 'Z' } }
    );

    const data = await response.json();
    const now = Date.now() / 1000;
    const cutoff = now - (days * 24 * 60 * 60);

    if (data.body) {
      const historical = Object.values(data.body as Record<string, {
        date: string; date_utc: number; open: number; high: number; low: number; close: number; volume: number;
      }>)
        .filter((e) => e.date_utc >= cutoff)
        .map((e) => ({ date: e.date, open: e.open, high: e.high, low: e.low, close: e.close, volume: e.volume }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const closes = historical.map(h => h.close);
      const sma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
      const sma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;

      let rsi: number | null = null;
      if (closes.length >= 14) {
        const changes = closes.slice(1).map((c, i) => c - closes[i]);
        const gains = changes.filter(c => c > 0);
        const losses = changes.filter(c => c < 0).map(c => Math.abs(c));
        const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / 14 : 0;
        const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / 14 : 0;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsi = 100 - (100 / (1 + rs));
      }

      const firstPrice = historical[0]?.close || 0;
      const lastPrice = historical[historical.length - 1]?.close || 0;
      const priceChange = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice * 100) : 0;

      return {
        success: true,
        data: {
          historical: historical.slice(-30),
          count: historical.length,
          period,
          indicators: {
            sma20: sma20 ? Math.round(sma20 * 100) / 100 : null,
            sma50: sma50 ? Math.round(sma50 * 100) / 100 : null,
            rsi: rsi ? Math.round(rsi * 100) / 100 : null
          },
          trend: sma20 && sma50 ? (sma20 > sma50 ? 'BULLISH' : 'BEARISH') : 'NEUTRAL',
          priceChange: Math.round(priceChange * 100) / 100,
          lastPrice,
          firstPrice,
          market: 'BIST',
        },
        _meta: { tool: 'get_stock_history', duration: Date.now() - startTime }
      };
    }
    return { success: false, error: 'Veri bulunamadı', _meta: { tool: 'get_stock_history', duration: Date.now() - startTime } };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'get_stock_history', duration: Date.now() - startTime } };
  }
}

// ============================================
// YFINANCE TOOL IMPLEMENTATIONS (via mini-service)
// ============================================

async function callYFinance(action: string, params: Record<string, string>): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const baseUrl = getBaseUrl();
    const url = new URL(`${baseUrl}/api/yfinance`);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
    const data = await response.json();

    if (!response.ok || data.error) {
      return { success: false, error: data.error || 'yfinance service error', _meta: { tool: action, duration: Date.now() - startTime } };
    }

    return { success: true, data, _meta: { tool: action, duration: Date.now() - startTime } };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: action, duration: Date.now() - startTime } };
  }
}

async function getGlobalQuote(symbol: string): Promise<ToolResult> {
  return callYFinance('quote', { symbol });
}

async function getGlobalHistory(symbol: string, period = '3mo', interval = '1d'): Promise<ToolResult> {
  return callYFinance('history', { symbol, period, interval });
}

async function getFinancials(symbol: string): Promise<ToolResult> {
  return callYFinance('financials', { symbol });
}

async function getOptions(symbol: string): Promise<ToolResult> {
  return callYFinance('options', { symbol });
}

async function searchTicker(query: string): Promise<ToolResult> {
  return callYFinance('search', { q: query });
}

async function compareStocks(symbols: string, period = '3mo'): Promise<ToolResult> {
  return callYFinance('compare', { symbols, period });
}

// ============================================
// WATCHLIST & SOCIAL TOOLS
// ============================================

async function getWatchlist(userId: string | null): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const supabase = getSupabase();
    let query = supabase.from('watchlist').select('*').order('created_at', { ascending: false });
    if (userId) query = query.eq('user_id', userId);
    else query = query.is('user_id', null);
    const { data, error } = await query;
    if (error) throw error;
    return { success: true, data: data || [], _meta: { tool: 'get_watchlist', duration: Date.now() - startTime } };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'get_watchlist', duration: Date.now() - startTime } };
  }
}

async function addToWatchlist(symbol: string, name: string, userId: string | null): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('watchlist')
      .insert({ symbol: symbol.toUpperCase(), name, user_id: userId })
      .select()
      .single();
    if (error && error.code !== '23505') throw error;
    return { success: true, data, _meta: { tool: 'add_to_watchlist', duration: Date.now() - startTime } };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'add_to_watchlist', duration: Date.now() - startTime } };
  }
}

async function removeFromWatchlist(symbol: string, userId: string | null): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const supabase = getSupabase();
    let query = supabase.from('watchlist').delete().eq('symbol', symbol.toUpperCase());
    if (userId) query = query.eq('user_id', userId);
    else query = query.is('user_id', null);
    const { error } = await query;
    if (error) throw error;
    return { success: true, _meta: { tool: 'remove_from_watchlist', duration: Date.now() - startTime } };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'remove_from_watchlist', duration: Date.now() - startTime } };
  }
}

// ============================================
// WEB SEARCH & NEWS TOOLS
// ============================================

async function webSearch(query: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const zai = await ZAI.create();
    const results = await zai.functions.invoke('web_search', { query, num: 5 });
    return { success: true, data: results, _meta: { tool: 'web_search', duration: Date.now() - startTime } };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'web_search', duration: Date.now() - startTime } };
  }
}

async function getKapData(symbol?: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const zai = await ZAI.create();
    const query = symbol ? `${symbol} hisse KAP bildirim` : 'BIST KAP bildirim bugün';
    const results = await zai.functions.invoke('web_search', { query, num: 10 });
    return { success: true, data: results, _meta: { tool: 'get_kap_data', duration: Date.now() - startTime } };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'get_kap_data', duration: Date.now() - startTime } };
  }
}

async function getNews(symbol?: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const zai = await ZAI.create();
    const queries = symbol
      ? [`${symbol} hisse haberi son dakika`, `${symbol} borsa analizi yorum`, `KAP ${symbol} bildirim`]
      : ['BIST 100 borsa haberi bugün', 'Türkiye borsa son dakika', 'BIST piyasa analizi'];

    const results = await Promise.all(queries.map(q => zai.functions.invoke('web_search', { query: q, num: 5 })));

    const allNews: Array<{ title: string; summary: string; source: string; url: string; date?: string }> = [];
    const seen = new Set<string>();

    for (const result of results) {
      if (Array.isArray(result)) {
        for (const item of result) {
          const title = item.name || item.title || '';
          if (title && !seen.has(title)) {
            seen.add(title);
            allNews.push({ title, summary: item.snippet || item.description || '', source: item.host_name || 'BIST', url: item.url || '', date: item.date });
          }
        }
      }
    }

    return {
      success: true,
      data: { symbol: symbol || 'BIST 100', news: allNews.slice(0, 10), total: allNews.length, timestamp: new Date().toISOString() },
      _meta: { tool: 'get_news', duration: Date.now() - startTime }
    };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'get_news', duration: Date.now() - startTime } };
  }
}

async function analyzeChartImage(imageBase64: string, symbol?: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const zai = await ZAI.create();
    const response = await zai.chat.completions.createVision({
      model: 'glm-4v-plus',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Bu finansal grafiği detaylıca analiz et. ${symbol ? `Hisse: ${symbol}` : ''}\n\nAnaliz şunları içermeli:\n- Trend yönü ve gücü\n- Destek/direnç seviyeleri\n- Teknik formasyonlar (varsa)\n- Hacim analizi\n- Genel yorum` },
          { type: 'image_url', image_url: { url: imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}` } }
        ]
      }],
      thinking: { type: 'disabled' }
    });

    return {
      success: true,
      data: { analysis: response.choices?.[0]?.message?.content, symbol },
      _meta: { tool: 'analyze_chart_image', duration: Date.now() - startTime }
    };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'analyze_chart_image', duration: Date.now() - startTime } };
  }
}

async function readTxtFile(content: string, filename?: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const zai = await ZAI.create();
    const response = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: 'Sen finansal analiz asistanısın. TXT dosyasını analiz et ve önemli bilgileri çıkar.' },
        { role: 'user', content: `Dosya: ${filename || 'bilinmiyor'}\n\n${content.slice(0, 8000)}` }
      ],
      max_tokens: 1500
    });

    return {
      success: true,
      data: { analysis: response.choices?.[0]?.message?.content },
      _meta: { tool: 'read_txt_file', duration: Date.now() - startTime }
    };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'read_txt_file', duration: Date.now() - startTime } };
  }
}

// ============================================
// UNIFIED TOOL EXECUTOR
// ============================================

async function executeTool(toolName: string, params: Record<string, unknown>, userId: string | null): Promise<ToolResult> {
  switch (toolName) {
    case 'get_stock_price':
      return getStockPrice(params.symbol as string);
    case 'get_stock_history':
      return getStockHistory(params.symbol as string, params.period as string);
    case 'get_global_quote':
      return getGlobalQuote(params.symbol as string);
    case 'get_global_history':
      return getGlobalHistory(params.symbol as string, params.period as string, params.interval as string);
    case 'get_financials':
      return getFinancials(params.symbol as string);
    case 'get_options':
      return getOptions(params.symbol as string);
    case 'search_ticker':
      return searchTicker(params.query as string);
    case 'compare_stocks':
      return compareStocks(params.symbols as string, params.period as string);
    case 'get_watchlist':
      return getWatchlist(userId);
    case 'add_to_watchlist':
      return addToWatchlist(params.symbol as string, params.name as string, userId);
    case 'remove_from_watchlist':
      return removeFromWatchlist(params.symbol as string, userId);
    case 'web_search':
      return webSearch(params.query as string);
    case 'get_kap_data':
      return getKapData(params.symbol as string | undefined);
    case 'get_news':
      return getNews(params.symbol as string | undefined);
    default:
      return { success: false, error: `Bilinmeyen araç: ${toolName}` };
  }
}

// ============================================
// OPEN AGENT LOOP (Autonomous Tool-Calling)
// ============================================

interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

async function runOpenAgentLoop(
  userMessage: string,
  userId: string | null,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: { encode: (msg: SSEMessage) => Uint8Array }
): Promise<{ response: string; toolsUsed: string[] }> {
  const zai = await ZAI.create();
  const toolsUsed: string[] = [];
  const toolResultsMap = new Map<string, ToolResult>();

  const systemPrompt = `Sen profesyonel bir yatırım analiz asistanısın. Hem BIST (Borsa İstanbul) hem de global piyasalarda (NYSE, NASDAQ, kripto) analiz yapabilirsin.

YETENEKLERIN:
- BIST hisse fiyat ve teknik analizi (get_stock_price, get_stock_history)
- Global hisse/ETF/kripto analizi via yfinance (get_global_quote, get_global_history)
- Finansal tablolar analizi (get_financials)
- Opsiyon zinciri analizi (get_options)
- Hisse sembolü arama (search_ticker)
- Hisse karşılaştırma (compare_stocks)
- Web'de güncel haber ve analiz arama (web_search, get_news)
- KAP bildirimleri (get_kap_data)
- Takip listesi yönetimi (get_watchlist, add_to_watchlist, remove_from_watchlist)

KURALLAR:
1. Kullanıcının sorusunu anlamak için gerekli araçları kullan
2. Birden fazla araç kullanabilirsin - kapsamlı analiz için önce veri topla
3. BIST hisseleri için BIST araçlarını, global hisseler için yfinance araçlarını kullan
4. Türkçe yanıt ver, Markdown kullan
5. Asla kesin "al/sat" tavsiyesi verme
6. Teknik analizi yorumla: RSI, SMA, MACD, Bollinger Bands, trend
7. Sonuna uyarı ekle: "⚠️ Bu analiz bilgilendirme amaçlıdır, yatırım tavsiyesi değildir."
8. Global semboller: AAPL, TSLA, MSFT, GOOG, AMZN, BTC-USD, ETH-USD, SPY, QQQ vs.
9. BIST semboller: THYAO, GARAN, ASELS, SISE, EREGL vs.`;

  const messages: AgentMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ];

  const MAX_ITERATIONS = 6;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Call LLM with tool schemas
    let llmResponse: { choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] }; finish_reason?: string }> };

    try {
      llmResponse = await (zai.chat.completions as unknown as {
        create: (opts: unknown) => Promise<typeof llmResponse>
      }).create({
        messages,
        tools: TOOL_SCHEMAS,
        tool_choice: iteration === 0 ? 'auto' : 'auto',
        max_tokens: 2500,
        temperature: 0.3,
      });
    } catch {
      // Fallback: LLM without tool calling - only include non-tool messages
      try {
        const fallbackResp = await zai.chat.completions.create({
          messages: messages
            .filter(m => m.role !== 'tool' && !(m.role === 'assistant' && m.tool_calls?.length))
            .map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
          max_tokens: 2000,
          temperature: 0.5,
        });
        return {
          response: fallbackResp.choices?.[0]?.message?.content || generateContextualResponse(toolResultsMap),
          toolsUsed
        };
      } catch {
        return { response: generateContextualResponse(toolResultsMap), toolsUsed };
      }
    }

    const choice = llmResponse.choices?.[0];
    if (!choice) break;

    const assistantMessage = choice.message;
    const finishReason = choice.finish_reason;

    // If no more tool calls, return the final response
    if (finishReason === 'stop' || !assistantMessage?.tool_calls?.length) {
      return {
        response: assistantMessage?.content || generateContextualResponse(toolResultsMap),
        toolsUsed
      };
    }

    // Process tool calls
    const toolCalls = assistantMessage.tool_calls || [];

    // Add assistant message with tool calls to history
    messages.push({
      role: 'assistant',
      content: assistantMessage.content || '',
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
    });

    // Execute each tool call
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      let params: Record<string, unknown> = {};

      try {
        params = JSON.parse(toolCall.function.arguments);
      } catch {
        params = {};
      }

      const toolInfo = TOOLS_INFO[toolName] || { name: toolName, description: `${toolName} çalışıyor...` };

      // Emit tool_start
      await writer.write(encoder.encode({
        type: 'tool_start',
        data: { tool: toolName, status: 'running', message: `${toolInfo.name}: ${toolInfo.description}` }
      }));

      // Execute tool
      const result = await executeTool(toolName, params, userId);
      toolsUsed.push(toolName);
      toolResultsMap.set(toolName, result);

      // Emit tool_result
      await writer.write(encoder.encode({
        type: 'tool_result',
        data: {
          tool: toolName,
          status: result.success ? 'completed' : 'error',
          result: result.data,
          message: result.success
            ? `${toolInfo.name} tamamlandı (${result._meta?.duration}ms)`
            : result.error
        }
      }));

      // Add tool result to message history
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolName,
        content: result.success
          ? JSON.stringify(result.data).slice(0, 3000)
          : `Error: ${result.error}`
      });
    }
  }

  // Max iterations reached - generate final response from collected data
  try {
    const finalResp = await zai.chat.completions.create({
      messages: [
        ...messages.map(m => {
          if (m.role === 'tool') {
            return { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id || 'unknown', name: m.name };
          }
          if (m.role === 'assistant' && m.tool_calls?.length) {
            return { role: 'assistant' as const, content: m.content || '', tool_calls: m.tool_calls };
          }
          return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
        }),
        { role: 'user', content: 'Tüm verileri analiz ederek kapsamlı bir sonuç yaz.' }
      ],
      max_tokens: 2000,
      temperature: 0.5,
    });

    return {
      response: finalResp.choices?.[0]?.message?.content || generateContextualResponse(toolResultsMap),
      toolsUsed
    };
  } catch {
    return { response: generateContextualResponse(toolResultsMap), toolsUsed };
  }
}

// ============================================
// CONTEXT-AWARE FALLBACK RESPONSE
// ============================================

function generateContextualResponse(toolResults: Map<string, ToolResult>): string {
  const fmt = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let response = '';

  // BIST price
  const priceResult = toolResults.get('get_stock_price');
  if (priceResult?.success && priceResult.data) {
    const d = priceResult.data as { symbol: string; name: string; price: number; changePercent: number; change: number; volume: number };
    response += `## 📊 ${d.symbol} - ${d.name}\n\n`;
    response += `**Fiyat:** ${fmt(d.price)} ₺  **Değişim:** ${d.changePercent >= 0 ? '+' : ''}${fmt(d.changePercent)}%\n`;
    response += `**Hacim:** ${d.volume?.toLocaleString('tr-TR') || 0} lot\n\n`;
  }

  // Global quote
  const globalResult = toolResults.get('get_global_quote');
  if (globalResult?.success && globalResult.data) {
    const d = globalResult.data as { symbol: string; name: string; price: number; previousClose: number; currency: string; marketCap: number; peRatio: number };
    if (d.price) {
      const chg = d.previousClose ? ((d.price - d.previousClose) / d.previousClose * 100) : 0;
      response += `## 🌍 ${d.symbol} - ${d.name}\n\n`;
      response += `**Fiyat:** ${d.price} ${d.currency || 'USD'}  **Değişim:** ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%\n`;
      if (d.marketCap) response += `**Piyasa Değeri:** $${(d.marketCap / 1e9).toFixed(2)}B\n`;
      if (d.peRatio) response += `**F/K Oranı:** ${d.peRatio}\n`;
      response += '\n';
    }
  }

  // Technical analysis (BIST or global)
  for (const key of ['get_stock_history', 'get_global_history']) {
    const histResult = toolResults.get(key);
    if (histResult?.success && histResult.data) {
      const d = histResult.data as { indicators: { sma20: number | null; sma50: number | null; rsi: number | null; macd?: number }; trend: string; priceChange: number };
      response += `## 📈 Teknik Analiz\n\n`;
      if (d.indicators?.sma20) response += `**SMA 20:** ${fmt(d.indicators.sma20)}\n`;
      if (d.indicators?.sma50) response += `**SMA 50:** ${fmt(d.indicators.sma50)}\n`;
      if (d.indicators?.rsi) {
        const rsi = d.indicators.rsi;
        const rsiStatus = rsi > 70 ? '⚠️ Aşırı Alım' : rsi < 30 ? '⚠️ Aşırı Satım' : '✅ Normal';
        response += `**RSI 14:** ${fmt(rsi)} ${rsiStatus}\n`;
      }
      if (d.indicators?.macd !== undefined) response += `**MACD:** ${fmt(d.indicators.macd || 0)}\n`;
      response += `**Trend:** ${d.trend === 'BULLISH' ? '🟢 Yükseliş' : d.trend === 'BEARISH' ? '🔴 Düşüş' : '🟡 Yatay'}\n`;
      response += `**Dönem Değişimi:** ${d.priceChange >= 0 ? '+' : ''}${d.priceChange}%\n\n`;
      break;
    }
  }

  // News
  const newsResult = toolResults.get('get_news');
  if (newsResult?.success && newsResult.data) {
    const data = newsResult.data as { news?: Array<{ title: string; source: string }> };
    if (data.news?.length) {
      response += `## 📰 Son Haberler\n\n`;
      data.news.slice(0, 5).forEach((n, i) => { response += `${i + 1}. ${n.title} *(${n.source})*\n`; });
      response += '\n';
    }
  }

  response += `\n---\n⚠️ Bu analiz bilgilendirme amaçlıdır, yatırım tavsiyesi değildir.`;
  return response || 'Analiz tamamlandı.';
}

// ============================================
// MAIN API HANDLER - SSE STREAMING
// ============================================

export async function POST(request: NextRequest) {
  const encoder = createSSEEncoder();
  const userId = await getCurrentUserId();

  try {
    const body = await request.json();

    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    (async () => {
      try {
        // TXT file analysis
        if (body.txtContent) {
          await writer.write(encoder.encode({
            type: 'tool_start',
            data: { tool: 'read_txt_file', status: 'running', message: TOOLS_INFO.read_txt_file.description }
          }));
          const result = await readTxtFile(body.txtContent, body.txtFilename);
          await writer.write(encoder.encode({
            type: 'tool_result',
            data: { tool: 'read_txt_file', status: result.success ? 'completed' : 'error', result: result.data, message: result.success ? 'Analiz tamamlandı' : result.error }
          }));
          await writer.write(encoder.encode({
            type: 'complete',
            data: { response: result.success ? (result.data as { analysis: string }).analysis : result.error, toolsUsed: ['read_txt_file'] }
          }));
          await writer.close();
          return;
        }

        // Image analysis
        if (body.imageBase64) {
          await writer.write(encoder.encode({
            type: 'tool_start',
            data: { tool: 'analyze_chart_image', status: 'running', message: TOOLS_INFO.analyze_chart_image.description }
          }));
          const result = await analyzeChartImage(body.imageBase64, body.imageSymbol);
          await writer.write(encoder.encode({
            type: 'tool_result',
            data: { tool: 'analyze_chart_image', status: result.success ? 'completed' : 'error', result: result.data, message: result.success ? 'Analiz tamamlandı' : result.error }
          }));
          await writer.write(encoder.encode({
            type: 'complete',
            data: { response: result.success ? (result.data as { analysis: string }).analysis : result.error, toolsUsed: ['analyze_chart_image'] }
          }));
          await writer.close();
          return;
        }

        // Normal message
        const { message } = body;
        if (!message) {
          await writer.write(encoder.encode({ type: 'error', data: { error: 'Mesaj gerekli' } }));
          await writer.close();
          return;
        }

        // Guest users: basic info only
        if (!userId) {
          const upperMessage = message.toUpperCase();
          const rawMatches: string[] = upperMessage.match(/\b([A-Z]{3,5})\b/g) || [];
          const symbols: string[] = [...new Set(rawMatches)].filter((s: string) => s.length >= 3 && s.length <= 5);
          let basicResponse = '';

          if (symbols.length > 0) {
            const priceResult = await getStockPrice(symbols[0]);
            if (priceResult.success && priceResult.data) {
              const d = priceResult.data as { symbol: string; name: string; price: number; changePercent: number };
              basicResponse += `## 📊 ${d.symbol} - ${d.name}\n\n**Fiyat:** ${d.price} ₺\n**Değişim:** ${d.changePercent >= 0 ? '+' : ''}${d.changePercent}%\n\n`;
            }
            const newsResult = await getNews(symbols[0] as string);
            if (newsResult.success && newsResult.data) {
              const data = newsResult.data as { news?: Array<{ title: string; source: string }> };
              if (data.news?.length) {
                basicResponse += `## 📰 Son Haberler\n\n`;
                data.news.slice(0, 3).forEach((n, i) => { basicResponse += `${i + 1}. ${n.title} (${n.source})\n`; });
              }
            }
          } else {
            const newsResult = await getNews();
            if (newsResult.success && newsResult.data) {
              const data = newsResult.data as { news?: Array<{ title: string; source: string }> };
              basicResponse = `## 📰 BIST Güncel Haberler\n\n`;
              data.news?.slice(0, 5).forEach((n, i) => { basicResponse += `${i + 1}. ${n.title} (${n.source})\n`; });
            }
          }

          basicResponse += `\n\n---\n⚠️ **Kayıt olmadan sadece temel bilgileri görebilirsiniz.**\nDetaylı analiz için lütfen giriş yapın.`;
          await writer.write(encoder.encode({
            type: 'complete',
            data: { response: basicResponse, toolsUsed: ['get_stock_price', 'get_news'] as string[], queryType: 'basic', symbols, requiresAuth: true }
          }));
          await writer.close();
          return;
        }

        // Send initial progress
        await writer.write(encoder.encode({
          type: 'progress',
          data: { message: '🤖 AI Agent başlatıldı, araçlar hazırlanıyor...' }
        }));

        // Emit LLM start
        await writer.write(encoder.encode({
          type: 'llm_start',
          data: { message: '🤖 AI analiz yapıyor...' }
        }));

        // Run the open agent loop (autonomous tool selection)
        const { response, toolsUsed } = await runOpenAgentLoop(message, userId, writer, encoder);

        // Send complete event
        await writer.write(encoder.encode({
          type: 'complete',
          data: { response, toolsUsed, queryType: 'agent' }
        }));

        await writer.close();
      } catch (error) {
        console.error('Agent loop error:', error);
        const errorMessage = error instanceof Error ? error.message : 'İşlem sırasında hata oluştu';
        try {
          await writer.write(encoder.encode({
            type: 'error',
            data: { error: errorMessage }
          }));
        } catch { /* stream already closed */ }
        try { await writer.close(); } catch { /* already closed */ }
      }
    })();

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Agent error:', error);
    return new Response(JSON.stringify({ error: 'Sunucu hatası' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
