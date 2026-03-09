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

function calcIndicators(closes: number[], period: string) {
  const sma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const sma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;

  let rsi: number | null = null;
  if (closes.length >= 15) {
    const changes = closes.slice(-15).slice(1).map((c, i) => c - closes.slice(-15)[i]);
    const gains = changes.filter(c => c > 0);
    const losses = changes.filter(c => c < 0).map(c => Math.abs(c));
    const avgGain = gains.reduce((a, b) => a + b, 0) / 14;
    const avgLoss = losses.reduce((a, b) => a + b, 0) / 14;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi = Math.round((100 - (100 / (1 + rs))) * 100) / 100;
  }

  const firstPrice = closes[0] || 0;
  const lastPrice = closes[closes.length - 1] || 0;
  const priceChange = firstPrice > 0 ? Math.round(((lastPrice - firstPrice) / firstPrice * 100) * 100) / 100 : 0;
  const trend = sma20 && sma50 ? (sma20 > sma50 ? 'BULLISH' : 'BEARISH') : (closes[closes.length - 1] > closes[0] ? 'BULLISH' : 'BEARISH');

  return {
    sma20: sma20 ? Math.round(sma20 * 100) / 100 : null,
    sma50: sma50 ? Math.round(sma50 * 100) / 100 : null,
    rsi,
    trend,
    priceChange,
    firstPrice,
    lastPrice,
    period
  };
}

async function getStockHistory(symbol: string, period: string = '1M'): Promise<ToolResult> {
  const startTime = Date.now();

  const rangeMap: Record<string, string> = { '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y' };
  const yahooRange = rangeMap[period] || '1mo';
  const yahooSymbol = `${symbol.toUpperCase()}.IS`;

  // 1) Yahoo Finance (birincil kaynak)
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=${yahooRange}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const data = await res.json();
    const result = data?.chart?.result?.[0];

    if (result?.timestamp && result?.indicators?.quote?.[0]) {
      const timestamps: number[] = result.timestamp;
      const q = result.indicators.quote[0];
      const closes: number[] = q.close.map((c: number | null) => c ?? 0).filter((c: number) => c > 0);

      if (closes.length > 0) {
        const indicators = calcIndicators(closes, period);
        return {
          success: true,
          data: { count: closes.length, ...indicators },
          _meta: { tool: 'get_stock_history', duration: Date.now() - startTime }
        };
      }
    }
  } catch {
    // Yahoo Finance başarısız, Z.AI'ye dön
  }

  // 2) Z.AI Finance API (yedek)
  try {
    const rangeMapDays: Record<string, number> = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };
    const days = rangeMapDays[period] || 30;
    const res = await fetch(
      `https://internal-api.z.ai/external/finance/v1/markets/stock/history?symbol=${symbol.toUpperCase()}.IS&interval=1d`,
      { headers: { 'X-Z-AI-From': 'Z' } }
    );
    const data = await res.json();
    const cutoff = Date.now() / 1000 - (days * 86400);

    if (data.body) {
      const historical = (Object.values(data.body) as Array<{ date: string; date_utc: number; close: number }>)
        .filter(e => e.date_utc >= cutoff)
        .sort((a, b) => a.date_utc - b.date_utc);

      const closes = historical.map(h => h.close);
      if (closes.length > 0) {
        const indicators = calcIndicators(closes, period);
        return {
          success: true,
          data: { count: closes.length, ...indicators },
          _meta: { tool: 'get_stock_history', duration: Date.now() - startTime }
        };
      }
    }
  } catch {
    // Z.AI de başarısız
  }

  return { success: false, error: 'Tarihsel veri alınamadı', _meta: { tool: 'get_stock_history', duration: Date.now() - startTime } };
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
// QUERY ANALYZER (düzeltilmiş sembol regex)
// ============================================

function analyzeQuery(message: string): { type: string; symbols: string[]; tools: string[] } {
  // Orijinal mesajdan BÜYÜK HARFLİ kelimeleri al (toUpperCase() KULLANMA)
  // Bu sayede "THYAO" eşleşir ama "Bugün"den "BUG" çıkmaz
  const rawSymbols = message.match(/\b([A-Z]{3,5})\b/g) || [];
  const symbols = [...new Set(rawSymbols)];

  let type = 'general';
  let tools: string[] = [];

  if (/(tahmin|gelecek|ne olur|kaç olur|gün sonra)/i.test(message)) {
    type = 'price_prediction';
    tools = symbols.length > 0
      ? ['get_stock_price', 'get_stock_history', 'get_kap_data', 'web_search']
      : ['scan_market'];
  } else if (/satmalı|satsam|satayım/i.test(message)) {
    type = 'sell_decision';
    tools = symbols.length > 0
      ? ['get_stock_price', 'get_stock_history', 'get_kap_data', 'web_search']
      : ['scan_market'];
  } else if (/nereye|yatırım|öneri|hangi hisse/i.test(message)) {
    type = 'market_overview';
    tools = ['scan_market'];
  } else if (/analiz|incele|detay/i.test(message)) {
    type = 'analysis';
    tools = symbols.length > 0
      ? ['get_stock_price', 'get_stock_history', 'get_kap_data', 'web_search']
      : ['scan_market'];
  } else if (/yükselen|kazandıran/i.test(message)) {
    type = 'gainers';
    tools = ['scan_market'];
  } else if (/düşen|kaybettiren/i.test(message)) {
    type = 'losers';
    tools = ['scan_market'];
  } else if (/takip|listem|watchlist/i.test(message)) {
    type = 'watchlist';
    tools = ['get_watchlist'];
  } else if (symbols.length > 0) {
    type = 'stock_price';
    tools = ['get_stock_price', 'get_stock_history'];
  } else {
    tools = ['scan_market'];
  }

  return { type, symbols, tools };
}

// ============================================
// CONTEXT BUILDER (araç sonuçlarından metin)
// ============================================

function buildContext(toolResults: Map<string, ToolResult>): string {
  const contextData: string[] = [];

  const priceResult = toolResults.get('get_stock_price');
  if (priceResult?.success && priceResult.data) {
    const d = priceResult.data as Record<string, unknown>;
    contextData.push(`📊 HİSSE FİYAT BİLGİSİ:
Sembol: ${d.symbol}
Ad: ${d.name}
Güncel Fiyat: ${d.price} ₺
Değişim: ${d.change} ₺ (%${d.changePercent})
Günlük Yüksek/Düşük: ${d.high} / ${d.low} ₺
Hacim: ${d.volume} lot
Tavan/Taban: ${d.ceiling} / ${d.floor} ₺`);
  }

  const historyResult = toolResults.get('get_stock_history');
  if (historyResult?.success && historyResult.data) {
    const d = historyResult.data as Record<string, unknown>;
    const ind = d.indicators as Record<string, number | null>;
    contextData.push(`📈 TEKNİK ANALİZ (${d.period}):
SMA 20: ${ind?.sma20 ?? 'Hesaplanamadı'} ₺
SMA 50: ${ind?.sma50 ?? 'Hesaplanamadı'} ₺
RSI 14: ${ind?.rsi ?? 'Hesaplanamadı'}
Trend: ${d.trend === 'BULLISH' ? 'YÜKSELİŞ' : d.trend === 'BEARISH' ? 'DÜŞÜŞ' : 'YATAY'}
Dönem Değişimi: %${d.priceChange}
İlk Fiyat: ${d.firstPrice} ₺ → Son Fiyat: ${d.lastPrice} ₺`);
  }

  const marketResult = toolResults.get('scan_market');
  if (marketResult?.success && marketResult.data) {
    const d = marketResult.data as Record<string, unknown>;
    const gainers = d.gainers as Array<Record<string, unknown>>;
    const losers = d.losers as Array<Record<string, unknown>>;
    contextData.push(`📊 PİYASA TARAMASI (${d.total} hisse tarandı):
EN ÇOK YÜKSELENLER:
${gainers?.slice(0, 8).map((g, i) => `${i + 1}. ${g.code} (${g.name}): ${g.price}₺ | %+${g.changePercent}`).join('\n') || 'Yok'}
EN ÇOK DÜŞENLER:
${losers?.slice(0, 8).map((l, i) => `${i + 1}. ${l.code} (${l.name}): ${l.price}₺ | %${l.changePercent}`).join('\n') || 'Yok'}`);
  }

  const webResult = toolResults.get('web_search');
  if (webResult?.success && webResult.data) {
    const results = webResult.data as Array<{ name?: string; snippet?: string; title?: string; description?: string }>;
    if (Array.isArray(results) && results.length > 0) {
      const items = results.slice(0, 5).map((r) => r.title || r.name || r.snippet || r.description || '').filter(Boolean);
      if (items.length > 0) contextData.push(`🔍 WEB HABERLERI:\n${items.join('\n')}`);
    }
  }

  const kapResult = toolResults.get('get_kap_data');
  if (kapResult?.success && kapResult.data) {
    const results = kapResult.data as Array<{ name?: string; snippet?: string; title?: string; description?: string }>;
    if (Array.isArray(results) && results.length > 0) {
      const items = results.slice(0, 5).map((r) => r.title || r.name || r.snippet || r.description || '').filter(Boolean);
      if (items.length > 0) contextData.push(`📢 KAP BİLDİRİMLERİ:\n${items.join('\n')}`);
    }
  }

  const watchlistResult = toolResults.get('get_watchlist');
  if (watchlistResult?.success && watchlistResult.data) {
    const items = watchlistResult.data as Array<{ symbol: string; name?: string }>;
    if (Array.isArray(items) && items.length > 0) {
      contextData.push(`⭐ TAKİP LİSTESİ: ${items.map((item) => `${item.symbol}${item.name ? ` (${item.name})` : ''}`).join(', ')}`);
    }
  }

  return contextData.join('\n\n');
}

// ============================================
// LLM SYSTEM PROMPT
// ============================================

const SYSTEM_PROMPT = `Sen profesyonel bir BIST (Borsa İstanbul) yatırım analiz asistanısın.

GÖREVIN: Sana verilen gerçek piyasa verilerini kullanarak detaylı analiz yap.

KURALLAR:
1. SADECE Türkçe yanıt ver
2. Markdown kullan (## başlıklar, **kalın**, - listeler)
3. Uygun emoji kullan (📊 📈 🔴 🟢 ⚠️ 💡)
4. ASLA "al" veya "sat" tavsiyesi verme
5. Verilen sayısal verileri kullan ve yorumla
6. RSI değerini yorumla: <30 aşırı satım, >70 aşırı alım
7. SMA kesişimlerini yorumla
8. Risk faktörlerini belirt
9. SONUNA MUTLAKA ekle: "⚠️ Bu analiz bilgilendirme amaçlıdır, yatırım tavsiyesi değildir."

ÖNEMLİ: Verilen verileri MUTLAKA yanıtına dahil et. Veri yoksa genel yorum yap.`;

// ============================================
// GROQ TEXT COMPLETION (BİRİNCİL LLM)
// ============================================

async function generateWithGroq(
  userMessage: string,
  context: string
): Promise<string> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const userPrompt = context
    ? `Kullanıcı sorusu: ${userMessage}\n\nGüncel piyasa verileri:\n${context}\n\nBu verileri kullanarak profesyonel analiz yap.`
    : `Kullanıcı sorusu: ${userMessage}\n\nGenel BIST piyasası hakkında yorum yap.`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 2000,
    temperature: 0.7
  });

  const content = completion.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq boş yanıt döndü');
  return content;
}

// ============================================
// Z.AI TEXT COMPLETION (YEDEK LLM)
// ============================================

async function generateWithZAI(
  userMessage: string,
  context: string
): Promise<string> {
  const zai = await createZaiClient();

  const userPrompt = context
    ? `Kullanıcı sorusu: ${userMessage}\n\nGüncel piyasa verileri:\n${context}\n\nBu verileri kullanarak profesyonel analiz yap.`
    : `Kullanıcı sorusu: ${userMessage}\n\nGenel BIST piyasası hakkında yorum yap.`;

  const response = await zai.chat.completions.create({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 2000,
    temperature: 0.7
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error('Z.AI boş yanıt döndü');
  return content;
}

// ============================================
// FALLBACK RESPONSE (no LLM)
// ============================================

function generateFallbackResponse(toolResults: Map<string, ToolResult>): string {
  const fmt = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let response = '';

  // Hisse fiyat analizi
  const priceResult = toolResults.get('get_stock_price');
  const historyResult = toolResults.get('get_stock_history');

  if (priceResult?.success && priceResult.data) {
    const d = priceResult.data as { symbol: string; name: string; price: number; changePercent: number; change: number; volume: number; high: number; low: number; ceiling: number; floor: number; open: number; previousClose: number };

    const changeIcon = d.changePercent > 0 ? '🟢' : d.changePercent < 0 ? '🔴' : '🟡';
    response += `## 📊 ${d.symbol} - ${d.name}\n\n`;
    response += `| Gösterge | Değer |\n|---|---|\n`;
    response += `| 💰 Güncel Fiyat | **${fmt(d.price)} ₺** |\n`;
    response += `| ${changeIcon} Değişim | **${d.changePercent >= 0 ? '+' : ''}${fmt(d.changePercent)}%** (${d.change >= 0 ? '+' : ''}${fmt(d.change)} ₺) |\n`;
    response += `| 📈 Gün Yüksek | ${fmt(d.high)} ₺ |\n`;
    response += `| 📉 Gün Düşük | ${fmt(d.low)} ₺ |\n`;
    response += `| 🔓 Açılış | ${fmt(d.open)} ₺ |\n`;
    response += `| 📦 Hacim | ${d.volume?.toLocaleString('tr-TR') || 0} lot |\n`;
    response += `| 🔼 Tavan | ${fmt(d.ceiling)} ₺ |\n`;
    response += `| 🔽 Taban | ${fmt(d.floor)} ₺ |\n\n`;

    // Günlük yorum
    const dayRange = d.high - d.low;
    const position = dayRange > 0 ? ((d.price - d.low) / dayRange) * 100 : 50;
    response += `### 💡 Günlük Değerlendirme\n\n`;
    if (d.changePercent > 3) response += `- Güçlü yükseliş günü (%${fmt(d.changePercent)}). Hacim takibi önemli.\n`;
    else if (d.changePercent > 0) response += `- Pozitif seyir. Alıcılar kontrolde.\n`;
    else if (d.changePercent < -3) response += `- Sert satış baskısı (%${fmt(d.changePercent)}). Destek seviyeleri kritik.\n`;
    else if (d.changePercent < 0) response += `- Hafif negatif. Satıcılar baskısı var.\n`;
    else response += `- Yatay seyir. Yön belirsizliği devam ediyor.\n`;

    if (position > 70) response += `- Fiyat günlük aralığın üst bölgesinde (**%${fmt(position)}** konumda). Alıcılar güçlü.\n`;
    else if (position < 30) response += `- Fiyat günlük aralığın alt bölgesinde (**%${fmt(position)}** konumda). Satıcılar baskılı.\n`;
    response += '\n';
  }

  // Teknik analiz
  if (historyResult?.success && historyResult.data) {
    const d = historyResult.data as { sma20: number | null; sma50: number | null; rsi: number | null; trend: string; priceChange: number; firstPrice: number; lastPrice: number; period: string };

    response += `## 📈 Teknik Analiz (${d.period || '1Y'})\n\n`;
    response += `| Gösterge | Değer | Yorum |\n|---|---|---|\n`;

    if (d.sma20) {
      const vs20 = d.lastPrice && d.sma20 ? ((d.lastPrice - d.sma20) / d.sma20 * 100) : 0;
      response += `| SMA 20 | ${fmt(d.sma20)} ₺ | Fiyat SMA20'nin **${vs20 >= 0 ? `%${fmt(vs20)} üstünde` : `%${fmt(Math.abs(vs20))} altında`}** |\n`;
    }
    if (d.sma50) {
      const vs50 = d.lastPrice && d.sma50 ? ((d.lastPrice - d.sma50) / d.sma50 * 100) : 0;
      response += `| SMA 50 | ${fmt(d.sma50)} ₺ | Fiyat SMA50'nin **${vs50 >= 0 ? `%${fmt(vs50)} üstünde` : `%${fmt(Math.abs(vs50))} altında`}** |\n`;
    }
    if (d.rsi) {
      const rsiYorum = d.rsi > 70 ? '⚠️ Aşırı alım' : d.rsi < 30 ? '⚠️ Aşırı satım' : d.rsi > 55 ? '🟢 Güçlü bölge' : d.rsi < 45 ? '🔴 Zayıf bölge' : '🟡 Nötr';
      response += `| RSI 14 | **${fmt(d.rsi)}** | ${rsiYorum} |\n`;
    }
    response += `| Dönem Getirisi | **%${d.priceChange >= 0 ? '+' : ''}${fmt(d.priceChange)}** | ${d.priceChange >= 0 ? '🟢' : '🔴'} |\n\n`;

    // Trend analizi
    response += `### 🎯 Trend Değerlendirmesi\n\n`;
    const trendIcon = d.trend === 'BULLISH' ? '🟢' : d.trend === 'BEARISH' ? '🔴' : '🟡';
    response += `**${trendIcon} ${d.trend === 'BULLISH' ? 'YÜKSELİŞ TRENDI' : d.trend === 'BEARISH' ? 'DÜŞÜŞ TRENDI' : 'YATAY TREND'}**\n\n`;

    if (d.sma20 && d.sma50) {
      if (d.sma20 > d.sma50) response += `- 20 günlük SMA, 50 günlük SMA'nın **üzerinde** → Kısa vadeli momentum pozitif\n`;
      else response += `- 20 günlük SMA, 50 günlük SMA'nın **altında** → Kısa vadeli momentum negatif\n`;
    }
    if (d.rsi) {
      if (d.rsi > 70) response += `- RSI aşırı alım bölgesinde (**${fmt(d.rsi)}**) → Kısa vadede düzeltme gelebilir\n`;
      else if (d.rsi < 30) response += `- RSI aşırı satım bölgesinde (**${fmt(d.rsi)}**) → Teknik toparlanma potansiyeli var\n`;
      else response += `- RSI nötr bölgede (**${fmt(d.rsi)}**) → Belirgin bir sinyal yok\n`;
    }
    response += '\n';
  }

  // Piyasa tarama
  const marketResult = toolResults.get('scan_market');
  if (marketResult?.success && marketResult.data) {
    const d = marketResult.data as { gainers: Array<{ code: string; name?: string; price: number; changePercent: number }>; losers: Array<{ code: string; name?: string; price: number; changePercent: number }>; total: number };
    response += `## 📊 BIST Piyasa Özeti (${d.total} hisse tarandı)\n\n`;
    response += `### 🟢 En Çok Yükselen ${d.gainers.length > 0 ? `(Top ${Math.min(d.gainers.length, 8)})` : ''}\n\n`;
    if (d.gainers.length > 0) {
      d.gainers.slice(0, 8).forEach((g, i) => {
        response += `${i + 1}. **${g.code}**${g.name ? ` - ${g.name}` : ''} → ${fmt(g.price)} ₺ | 🟢 **+${fmt(g.changePercent)}%**\n`;
      });
    } else {
      response += `*Yükselen hisse bulunamadı*\n`;
    }
    response += `\n### 🔴 En Çok Düşen ${d.losers.length > 0 ? `(Top ${Math.min(d.losers.length, 8)})` : ''}\n\n`;
    if (d.losers.length > 0) {
      d.losers.slice(0, 8).forEach((l, i) => {
        response += `${i + 1}. **${l.code}**${l.name ? ` - ${l.name}` : ''} → ${fmt(l.price)} ₺ | 🔴 **${fmt(l.changePercent)}%**\n`;
      });
    } else {
      response += `*Düşen hisse bulunamadı*\n`;
    }
    response += '\n';
  }

  // Takip listesi
  const watchlistResult = toolResults.get('get_watchlist');
  if (watchlistResult?.success && watchlistResult.data) {
    const items = watchlistResult.data as Array<{ symbol: string; name?: string; target_price?: number }>;
    if (Array.isArray(items) && items.length > 0) {
      response += `## ⭐ Takip Listesi (${items.length} hisse)\n\n`;
      items.forEach((item) => {
        response += `- **${item.symbol}**${item.name ? ` - ${item.name}` : ''}${item.target_price ? ` | Hedef: ${fmt(item.target_price)} ₺` : ''}\n`;
      });
      response += '\n';
    } else {
      response += `## ⭐ Takip Listesi\n\n*Takip listesi boş.*\n\n`;
    }
  }

  if (!response) response = '## ℹ️ Bilgi\n\nVeri alınamadı. Lütfen hisse sembolünü kontrol edip tekrar deneyin.\n\n';

  response += `\n---\n⚠️ **Bu analiz bilgilendirme amaçlıdır, yatırım tavsiyesi değildir.** Yatırım kararı vermeden önce uzman görüşü alınız.`;
  return response;
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

        // 1) Sorguyu analiz et: hangi araçlar, hangi semboller
        const { type, symbols, tools } = analyzeQuery(message);
        const toolResults = new Map<string, ToolResult>();

        await writer.write(encoder.encode({
          type: 'progress',
          data: { message: `🔍 Sorgu analiz edildi. ${tools.length} araç çalışacak...` }
        }));

        // 2) Araçları çalıştır
        for (const tool of tools) {
          const toolInfo = TOOLS_INFO[tool] || { name: tool, description: `${tool} çalışıyor...` };

          await writer.write(encoder.encode({
            type: 'tool_start',
            data: { tool, status: 'running', message: `${toolInfo.name}: ${toolInfo.description}` }
          }));

          let params: Record<string, unknown> = {};
          switch (tool) {
            case 'get_stock_price':
            case 'get_stock_history':
            case 'get_kap_data':
              params = { symbol: symbols[0], period: '1Y' };
              break;
            case 'web_search':
              params = { query: symbols.length > 0 ? `${symbols[0]} hisse BIST analiz` : 'BIST piyasa analiz bugün' };
              break;
            default:
              params = {};
          }

          const result = await executeTool(tool, params, userId);
          toolResults.set(tool, result);

          await writer.write(encoder.encode({
            type: 'tool_result',
            data: {
              tool,
              status: result.success ? 'completed' : 'error',
              result: result.data,
              message: result.success ? `${toolInfo.name} tamamlandı (${result._meta?.duration}ms)` : result.error
            }
          }));
        }

        // 3) Context oluştur
        const context = buildContext(toolResults);
        const toolsUsed = Array.from(toolResults.keys());

        // 4) LLM ile analiz yap (Groq → Z.AI → static)
        await writer.write(encoder.encode({
          type: 'llm_start',
          data: { message: '🤖 Groq AI analiz yapıyor...' }
        }));

        let finalResponse = '';

        try {
          finalResponse = await generateWithGroq(message, context);
        } catch (groqError) {
          console.error('Groq failed, falling back to Z.AI:', groqError);
          await writer.write(encoder.encode({
            type: 'llm_start',
            data: { message: '🔄 Z.AI yedek analiz yapıyor...' }
          }));
          try {
            finalResponse = await generateWithZAI(message, context);
          } catch (zaiError) {
            console.error('Z.AI also failed, static fallback:', zaiError);
            finalResponse = generateFallbackResponse(toolResults);
          }
        }

        await writer.write(encoder.encode({
          type: 'complete',
          data: { response: finalResponse, toolsUsed, queryType: type, symbols }
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
