import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabase } from '@/lib/supabase';
import Groq from 'groq-sdk';
import ZAI from 'z-ai-web-dev-sdk';

// Z.AI istemcisi: önce env vars, sonra config dosyası
async function createZaiClient(): Promise<ZAI> {
  const baseUrl = process.env.ZAI_BASE_URL;
  const apiKey = process.env.ZAI_API_KEY;
  if (baseUrl && apiKey) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new (ZAI as any)({ baseUrl, apiKey }) as ZAI;
  }
  return await ZAI.create(); // config dosyasından oku (local dev)
}

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
  };
}

// ============================================
// TOOLS DEFINITION
// ============================================

const TOOLS_INFO: Record<string, { name: string; description: string }> = {
  get_stock_price: { name: 'Hisse Fiyatı', description: 'Güncel fiyat verisi alınıyor...' },
  get_stock_history: { name: 'Geçmiş Veri', description: 'Tarihsel veriler analiz ediliyor...' },
  get_watchlist: { name: 'Takip Listesi', description: 'Takip listesi kontrol ediliyor...' },
  add_to_watchlist: { name: 'Takibe Ekle', description: 'Hisse takibe ekleniyor...' },
  remove_from_watchlist: { name: 'Takipten Çık', description: 'Hisse takipten çıkarılıyor...' },
  web_search: { name: 'Web Araması', description: 'Web\'de arama yapılıyor...' },
  get_kap_data: { name: 'KAP Verileri', description: 'KAP bildirimleri alınıyor...' },
  scan_market: { name: 'Piyasa Tarama', description: 'Piyasa taranıyor...' },
  analyze_chart_image: { name: 'Grafik Analizi', description: 'Grafik analiz ediliyor...' },
  read_txt_file: { name: 'TXT Analizi', description: 'Dosya analiz ediliyor...' },
};

// Groq tool definitions (OpenAI-compatible function calling format)
const GROQ_TOOL_DEFINITIONS: Groq.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_stock_price',
      description: 'BIST hissesinin güncel fiyat bilgisini al (fiyat, değişim, hacim, tavan/taban)',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Hisse sembolü (örn: THYAO, GARAN, ASELS)' }
        },
        required: ['symbol']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_stock_history',
      description: 'Hisse geçmiş fiyat verisi ve teknik göstergeler (SMA20, SMA50, RSI, trend)',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Hisse sembolü' },
          period: { type: 'string', enum: ['1M', '3M', '6M', '1Y'], description: 'Zaman dilimi' }
        },
        required: ['symbol']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_watchlist',
      description: 'Kullanıcının takip listesini göster',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_to_watchlist',
      description: 'Hisse senedini takip listesine ekle',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Hisse sembolü' },
          name: { type: 'string', description: 'Hisse adı' }
        },
        required: ['symbol', 'name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remove_from_watchlist',
      description: 'Hisseyi takip listesinden çıkar',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Hisse sembolü' }
        },
        required: ['symbol']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Borsa ve finans haberleri için web araması yap',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Arama sorgusu' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_kap_data',
      description: 'KAP (Kamuyu Aydınlatma Platformu) bildirimlerini al',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Hisse sembolü (opsiyonel)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scan_market',
      description: 'Tüm BIST piyasasını tara: en çok yükselen ve düşen hisseleri bul',
      parameters: { type: 'object', properties: {} }
    }
  }
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

// ============================================
// TOOL IMPLEMENTATIONS
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

    if (data.code === "0" && data.data?.hisseYuzeysel) {
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
          floor: d.taban
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
        date: string;
        date_utc: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>)
        .filter((e) => e.date_utc >= cutoff)
        .map((e) => ({
          date: e.date,
          open: e.open,
          high: e.high,
          low: e.low,
          close: e.close,
          volume: e.volume
        }))
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
          firstPrice
        },
        _meta: { tool: 'get_stock_history', duration: Date.now() - startTime }
      };
    }
    return { success: false, error: 'Veri bulunamadı', _meta: { tool: 'get_stock_history', duration: Date.now() - startTime } };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'get_stock_history', duration: Date.now() - startTime } };
  }
}

async function getWatchlist(userId: string | null): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const supabase = getSupabase();
    let query = supabase.from('watchlist').select('*').order('created_at', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    } else {
      query = query.is('user_id', null);
    }

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

    if (userId) {
      query = query.eq('user_id', userId);
    } else {
      query = query.is('user_id', null);
    }

    const { error } = await query;
    if (error) throw error;
    return { success: true, _meta: { tool: 'remove_from_watchlist', duration: Date.now() - startTime } };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'remove_from_watchlist', duration: Date.now() - startTime } };
  }
}

async function webSearch(query: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const zai = await createZaiClient();
    const results = await zai.functions.invoke('web_search', { query, num: 5 });
    return { success: true, data: results, _meta: { tool: 'web_search', duration: Date.now() - startTime } };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'web_search', duration: Date.now() - startTime } };
  }
}

async function getKapData(symbol?: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const zai = await createZaiClient();
    const query = symbol ? `${symbol} hisse KAP bildirim` : 'BIST KAP bildirim bugün';
    const results = await zai.functions.invoke('web_search', { query, num: 10 });
    return { success: true, data: results, _meta: { tool: 'get_kap_data', duration: Date.now() - startTime } };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'get_kap_data', duration: Date.now() - startTime } };
  }
}

async function scanMarket(): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const listResponse = await fetch('https://api.asenax.com/bist/list');
    const listData = await listResponse.json();

    if (listData.code !== "0") {
      return { success: false, error: 'Liste alınamadı', _meta: { tool: 'scan_market', duration: Date.now() - startTime } };
    }

    const stocks = listData.data.filter((item: { tip?: string }) => item.tip === "Hisse").slice(0, 50);

    const results = [];
    for (let i = 0; i < stocks.length; i += 10) {
      const batch = stocks.slice(i, i + 10);
      const batchResults = await Promise.all(
        batch.map(async (stock: { kod?: string; ad?: string }) => {
          const priceData = await getStockPrice(stock.kod || '');
          if (priceData.success && priceData.data) {
            return { code: stock.kod, name: stock.ad, ...priceData.data };
          }
          return null;
        })
      );
      results.push(...batchResults.filter(Boolean));
    }

    const sorted = results.sort((a: { changePercent: number }, b: { changePercent: number }) => b.changePercent - a.changePercent);

    return {
      success: true,
      data: {
        all: sorted,
        gainers: sorted.filter((s: { changePercent: number }) => s.changePercent > 0).slice(0, 10),
        losers: sorted.filter((s: { changePercent: number }) => s.changePercent < 0).sort((a: { changePercent: number }, b: { changePercent: number }) => a.changePercent - b.changePercent).slice(0, 10),
        total: sorted.length
      },
      _meta: { tool: 'scan_market', duration: Date.now() - startTime }
    };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'scan_market', duration: Date.now() - startTime } };
  }
}

async function analyzeChartImage(imageBase64: string, symbol?: string): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const zai = await createZaiClient();
    const response = await zai.chat.completions.createVision({
      model: process.env.ZAI_VISION_MODEL || 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Bu finansal grafiği analiz et. ${symbol ? `Hisse: ${symbol}` : ''}` },
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
    const zai = await createZaiClient();
    const response = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: 'Sen finansal analiz asistanısın. TXT dosyasını analiz et.' },
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
// TOOL EXECUTOR
// ============================================

async function executeTool(toolName: string, params: Record<string, unknown>, userId: string | null): Promise<ToolResult> {
  switch (toolName) {
    case 'get_stock_price':
      return getStockPrice(params.symbol as string);
    case 'get_stock_history':
      return getStockHistory(params.symbol as string, params.period as string);
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
    case 'scan_market':
      return scanMarket();
    case 'analyze_chart_image':
      return analyzeChartImage(params.imageBase64 as string, params.symbol as string | undefined);
    case 'read_txt_file':
      return readTxtFile(params.content as string, params.filename as string | undefined);
    default:
      return { success: false, error: `Bilinmeyen araç: ${toolName}` };
  }
}

// ============================================
// LLM SYSTEM PROMPT
// ============================================

const SYSTEM_PROMPT = `Sen profesyonel bir BIST (Borsa İstanbul) yatırım analiz asistanısın.

KURALLAR:
1. Türkçe yanıt ver
2. Markdown kullan (başlıklar ##, kalın **, listeler -)
3. Emoji kullan (📊 📈 🔴 🟢 ⚠️)
4. Asla "al/sat" tavsiyesi verme
5. Sadece analitik yorum yap
6. Tool'lardan gelen verileri detaylı analiz et ve yorumla
7. Teknik göstergeleri açıkla (RSI, SMA, Trend)
8. Risk faktörlerini belirt
9. Sonuna uyarı ekle: "⚠️ Bu analiz bilgilendirme amaçlıdır, yatırım tavsiyesi değildir."

YANIT FORMATI:
- Kısa başlık
- Önemli veriler (fiyat, değişim)
- Teknik analiz yorumu (tool verilerini kullanarak)
- Risk değerlendirmesi
- Uyarı`;

// ============================================
// GROQ FUNCTION CALLING AGENT (PRIMARY)
// ============================================

async function generateWithGroq(
  userMessage: string,
  userId: string | null,
  onToolCall: (toolName: string, params: Record<string, unknown>) => Promise<ToolResult>
): Promise<{ response: string; toolsUsed: string[] }> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage }
  ];

  const toolsUsed: string[] = [];
  let iterations = 0;
  const MAX_ITERATIONS = 5;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      tools: GROQ_TOOL_DEFINITIONS,
      tool_choice: 'auto',
      max_tokens: 2000,
      temperature: 0.7
    });

    const choice = completion.choices[0];

    if (!choice) break;

    // If no tool calls, return the final text response
    if (choice.finish_reason === 'stop' || !choice.message.tool_calls?.length) {
      const content = choice.message.content || '';
      if (content) {
        return { response: content, toolsUsed };
      }
      break;
    }

    // Process tool calls
    messages.push(choice.message);

    for (const toolCall of choice.message.tool_calls) {
      const toolName = toolCall.function.name;
      let params: Record<string, unknown> = {};

      try {
        params = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        params = {};
      }

      // Execute tool via callback (which also sends SSE events)
      const result = await onToolCall(toolName, params);

      if (!toolsUsed.includes(toolName)) {
        toolsUsed.push(toolName);
      }

      // Add tool result to messages so Groq can interpret it
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result.success ? result.data : { error: result.error })
      });
    }
  }

  throw new Error('Groq yanıt üretemedi');
}

// ============================================
// Z.AI FALLBACK GENERATOR
// ============================================

async function generateWithZAI(
  userMessage: string,
  toolResults: Map<string, ToolResult>
): Promise<string> {
  // Build context from tool results
  const contextData: string[] = [];

  const priceResult = toolResults.get('get_stock_price');
  if (priceResult?.success && priceResult.data) {
    const d = priceResult.data as Record<string, unknown>;
    contextData.push(`📊 HİSSE FİYAT BİLGİSİ:
Sembol: ${d.symbol}
Ad: ${d.name}
Güncel Fiyat: ${d.price} ₺
Değişim: ${d.change} ₺ (${d.changePercent}%)
Günlük Yüksek/Düşük: ${d.high}/${d.low} ₺
Hacim: ${d.volume} lot
Tavan/Taban: ${d.ceiling}/${d.floor} ₺`);
  }

  const historyResult = toolResults.get('get_stock_history');
  if (historyResult?.success && historyResult.data) {
    const d = historyResult.data as Record<string, unknown>;
    const indicators = d.indicators as Record<string, number | null>;
    contextData.push(`📈 TEKNİK ANALİZ:
SMA 20: ${indicators?.sma20 || 'N/A'} ₺
SMA 50: ${indicators?.sma50 || 'N/A'} ₺
RSI 14: ${indicators?.rsi || 'N/A'}
Trend: ${d.trend === 'BULLISH' ? 'Yükseliş' : d.trend === 'BEARISH' ? 'Düşüş' : 'Yatay'}
Dönem Değişimi: ${d.priceChange}%`);
  }

  const marketResult = toolResults.get('scan_market');
  if (marketResult?.success && marketResult.data) {
    const d = marketResult.data as Record<string, unknown>;
    const gainers = d.gainers as Array<Record<string, unknown>>;
    const losers = d.losers as Array<Record<string, unknown>>;

    contextData.push(`📊 PİYASA TARAMASI (${d.total} hisse):
YÜKSELENLER: ${gainers?.slice(0, 5).map((g) => `${g.code}: ${g.price}₺ (+${g.changePercent}%)`).join(', ') || 'Yok'}
DÜŞENLER: ${losers?.slice(0, 5).map((l) => `${l.code}: ${l.price}₺ (${l.changePercent}%)`).join(', ') || 'Yok'}`);
  }

  const webResult = toolResults.get('web_search');
  if (webResult?.success && webResult.data) {
    const results = webResult.data as Array<{ name?: string; snippet?: string; title?: string; description?: string }>;
    if (Array.isArray(results) && results.length > 0) {
      contextData.push(`🔍 WEB ARAMA: ${results.slice(0, 3).map((r) => r.title || r.name || r.snippet || r.description || '').filter(Boolean).join(' | ')}`);
    }
  }

  const kapResult = toolResults.get('get_kap_data');
  if (kapResult?.success && kapResult.data) {
    const results = kapResult.data as Array<{ name?: string; snippet?: string; title?: string; description?: string }>;
    if (Array.isArray(results) && results.length > 0) {
      contextData.push(`📢 KAP BİLDİRİMLERİ: ${results.slice(0, 3).map((r) => r.title || r.name || r.snippet || r.description || '').filter(Boolean).join(' | ')}`);
    }
  }

  const watchlistResult = toolResults.get('get_watchlist');
  if (watchlistResult?.success && watchlistResult.data) {
    const items = watchlistResult.data as Array<{ symbol: string; name?: string }>;
    if (Array.isArray(items) && items.length > 0) {
      contextData.push(`⭐ TAKİP LİSTESİ: ${items.map((item) => item.symbol).join(', ')}`);
    }
  }

  const userPrompt = `Kullanıcı Sorusu: ${userMessage}

VERİLER:
${contextData.join('\n\n')}

Lütfen bu verilere dayanarak profesyonel bir analiz yap.`;

  const zai = await createZaiClient();
  const response = await zai.chat.completions.create({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 2000,
    temperature: 0.7
  });

  if (response.choices?.[0]?.message?.content) {
    return response.choices[0].message.content;
  }

  throw new Error('Z.AI yanıt üretemedi');
}

// ============================================
// FALLBACK RESPONSE (no LLM)
// ============================================

function generateFallbackResponse(toolResults: Map<string, ToolResult>): string {
  const formatNumber = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let response = '';

  const priceResult = toolResults.get('get_stock_price');
  if (priceResult?.success && priceResult.data) {
    const d = priceResult.data as { symbol: string; name: string; price: number; changePercent: number; change: number; volume: number; high: number; low: number };
    response += `## 📊 ${d.symbol} - ${d.name}\n\n`;
    response += `**Fiyat:** ${formatNumber(d.price)} ₺\n`;
    response += `**Değişim:** ${d.changePercent >= 0 ? '+' : ''}${formatNumber(d.changePercent)}%\n`;
    response += `**Hacim:** ${d.volume?.toLocaleString('tr-TR') || 0} lot\n\n`;
  }

  const historyResult = toolResults.get('get_stock_history');
  if (historyResult?.success && historyResult.data) {
    const d = historyResult.data as { indicators: { sma20: number | null; sma50: number | null; rsi: number | null }; trend: string; priceChange: number };
    response += `## 📈 Teknik Analiz\n\n`;
    if (d.indicators?.sma20) response += `**SMA 20:** ${formatNumber(d.indicators.sma20)} ₺\n`;
    if (d.indicators?.sma50) response += `**SMA 50:** ${formatNumber(d.indicators.sma50)} ₺\n`;
    if (d.indicators?.rsi) response += `**RSI 14:** ${formatNumber(d.indicators.rsi)}\n`;
    response += `**Trend:** ${d.trend === 'BULLISH' ? '🟢 Yükseliş' : d.trend === 'BEARISH' ? '🔴 Düşüş' : '🟡 Yatay'}\n\n`;
  }

  const marketResult = toolResults.get('scan_market');
  if (marketResult?.success && marketResult.data) {
    const d = marketResult.data as { gainers: Array<{ code: string; price: number; changePercent: number }>; losers: Array<{ code: string; price: number; changePercent: number }>; total: number };
    response += `## 📊 Piyasa Özeti (${d.total} hisse)\n\n`;
    response += `### 🟢 Yükselenler\n`;
    d.gainers.slice(0, 5).forEach((g, i) => {
      response += `${i + 1}. **${g.code}** - ${formatNumber(g.price)} ₺ (+${formatNumber(g.changePercent)}%)\n`;
    });
    response += `\n### 🔴 Düşenler\n`;
    d.losers.slice(0, 5).forEach((l, i) => {
      response += `${i + 1}. **${l.code}** - ${formatNumber(l.price)} ₺ (${formatNumber(l.changePercent)}%)\n`;
    });
    response += `\n`;
  }

  response += `\n---\n⚠️ Bu analiz bilgilendirme amaçlıdır, yatırım tavsiyesi değildir.`;
  return response || 'Veri alındı ancak analiz yapılamadı.';
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

        // Normal message - use Groq function calling agent
        const { message } = body;
        if (!message) {
          await writer.write(encoder.encode({ type: 'error', data: { error: 'Mesaj gerekli' } }));
          await writer.close();
          return;
        }

        await writer.write(encoder.encode({
          type: 'progress',
          data: { message: '🤖 Groq AI analiz başlatıyor...' }
        }));

        // Collect tool results for Z.AI fallback
        const toolResults = new Map<string, ToolResult>();

        // Tool call callback - sends SSE events and executes tools
        const onToolCall = async (toolName: string, params: Record<string, unknown>): Promise<ToolResult> => {
          const toolInfo = TOOLS_INFO[toolName] || { name: toolName, description: `${toolName} çalışıyor...` };

          await writer.write(encoder.encode({
            type: 'tool_start',
            data: { tool: toolName, status: 'running', message: `${toolInfo.name}: ${toolInfo.description}` }
          }));

          const result = await executeTool(toolName, params, userId);
          toolResults.set(toolName, result);

          await writer.write(encoder.encode({
            type: 'tool_result',
            data: {
              tool: toolName,
              status: result.success ? 'completed' : 'error',
              result: result.data,
              message: result.success ? `${toolInfo.name} tamamlandı (${result._meta?.duration}ms)` : result.error
            }
          }));

          return result;
        };

        // Try Groq with function calling first (PRIMARY)
        await writer.write(encoder.encode({
          type: 'llm_start',
          data: { message: '🤖 Groq AI düşünüyor ve araçları çağırıyor...' }
        }));

        let finalResponse = '';
        let toolsUsed: string[] = [];

        try {
          const groqResult = await generateWithGroq(message, userId, onToolCall);
          finalResponse = groqResult.response;
          toolsUsed = groqResult.toolsUsed;
        } catch (groqError) {
          console.error('Groq failed, falling back to Z.AI:', groqError);

          // If Groq failed but we have no tool results yet, run basic tools
          if (toolResults.size === 0) {
            const upperMessage = message.toUpperCase();
            const symbolMatches: string[] = upperMessage.match(/\b([A-Z]{3,5})\b/g) || [];
            const symbols = [...new Set(symbolMatches)].filter((s) => s.length >= 3 && s.length <= 5);

            if (symbols.length > 0) {
              await onToolCall('get_stock_price', { symbol: symbols[0] });
              await onToolCall('get_stock_history', { symbol: symbols[0], period: '1M' });
            } else {
              await onToolCall('scan_market', {});
            }
          }

          // Z.AI fallback
          await writer.write(encoder.encode({
            type: 'llm_start',
            data: { message: '🔄 Z.AI ile yedek analiz yapılıyor...' }
          }));

          try {
            finalResponse = await generateWithZAI(message, toolResults);
            toolsUsed = Array.from(toolResults.keys());
          } catch (zaiError) {
            console.error('Z.AI also failed, using static fallback:', zaiError);
            finalResponse = generateFallbackResponse(toolResults);
            toolsUsed = Array.from(toolResults.keys());
          }
        }

        await writer.write(encoder.encode({
          type: 'complete',
          data: { response: finalResponse, toolsUsed, symbols: [] }
        }));

        await writer.close();
      } catch (error) {
        console.error('Agent error:', error);
        await writer.write(encoder.encode({
          type: 'error',
          data: { error: 'İşlem sırasında hata oluştu' }
        }));
        await writer.close();
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
