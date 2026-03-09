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
  get_news: { name: 'Haberler', description: 'Finansal haberler alınıyor...' },
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
    
    // BIST haber kaynaklarından arama
    const queries = symbol 
      ? [
          `${symbol} hisse haberi son dakika`,
          `${symbol} borsa analizi yorum`,
          `KAP ${symbol} bildirim`
        ]
      : [
          'BIST 100 borsa haberi bugün',
          'Türkiye borsa son dakika',
          'BIST piyasa analizi'
        ];
    
    // Paralel arama
    const searchPromises = queries.map(q => 
      zai.functions.invoke('web_search', { query: q, num: 5 })
    );
    
    const results = await Promise.all(searchPromises);
    
    // Sonuçları birleştir ve tekrarları kaldır
    const allNews: Array<{ title: string; summary: string; source: string; url: string; date?: string }> = [];
    const seen = new Set<string>();
    
    for (const result of results) {
      if (Array.isArray(result)) {
        for (const item of result) {
          const title = item.name || item.title || '';
          if (title && !seen.has(title)) {
            seen.add(title);
            allNews.push({
              title,
              summary: item.snippet || item.description || '',
              source: item.host_name || 'BIST',
              url: item.url || '',
              date: item.date
            });
          }
        }
      }
    }
    
    // Son 10 haberi döndür
    return { 
      success: true, 
      data: {
        symbol: symbol || 'BIST 100',
        news: allNews.slice(0, 10),
        total: allNews.length,
        timestamp: new Date().toISOString()
      }, 
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
    const zai = await ZAI.create();
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
    case 'get_news':
      return getNews(params.symbol as string | undefined);
    case 'analyze_chart_image':
      return analyzeChartImage(params.imageBase64 as string, params.symbol as string | undefined);
    case 'read_txt_file':
      return readTxtFile(params.content as string, params.filename as string | undefined);
    default:
      return { success: false, error: `Bilinmeyen araç: ${toolName}` };
  }
}

// ============================================
// QUERY ANALYZER
// ============================================

function analyzeQuery(message: string): { type: string; symbols: string[]; tools: string[] } {
  const upperMessage = message.toUpperCase();
  const symbols = [...new Set(upperMessage.match(/\b([A-Z]{3,5})\b/g) || [])].filter(s => s.length >= 3 && s.length <= 5);

  let type = 'general';
  let tools: string[] = [];

  if (/(haber|son dakika|duyuru|gelişme)/i.test(message)) {
    type = 'news';
    tools = ['get_news'];
  } else if (/(tahmin|gelecek|ne olur|kaç olur|gün sonra)/i.test(message)) {
    type = 'price_prediction';
    tools = ['get_stock_price', 'get_stock_history', 'get_kap_data', 'get_news'];
  } else if (/satmalı|satsam|satayım/i.test(message)) {
    type = 'sell_decision';
    tools = ['get_stock_price', 'get_stock_history', 'get_kap_data', 'get_news'];
  } else if (/nereye|yatırım|öneri|hangi hisse/i.test(message)) {
    type = 'market_overview';
    tools = ['get_news'];
  } else if (/analiz|incele|detay/i.test(message)) {
    type = 'analysis';
    tools = symbols.length > 0 ? ['get_stock_price', 'get_stock_history', 'get_kap_data', 'get_news'] : ['get_news'];
  } else if (/takip|listem|watchlist/i.test(message)) {
    type = 'watchlist';
    tools = ['get_watchlist'];
  } else if (symbols.length > 0) {
    type = 'stock_price';
    tools = ['get_stock_price', 'get_stock_history', 'get_news'];
  } else {
    tools = ['get_news'];
  }

  return { type, symbols, tools };
}

// ============================================
// LLM RESPONSE GENERATOR (Z-AI SDK)
// ============================================

async function generateLLMResponse(
  userMessage: string,
  queryType: string,
  toolResults: Map<string, ToolResult>
): Promise<string> {
  // Tool sonuçlarını hazırla
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
    const results = webResult.data as Array<{ name?: string; snippet?: string }>;
    if (Array.isArray(results) && results.length > 0) {
      contextData.push(`🔍 WEB ARAMA: ${results.slice(0, 3).map((r) => r.name || r.snippet || '').join(' | ')}`);
    }
  }

  const kapResult = toolResults.get('get_kap_data');
  if (kapResult?.success && kapResult.data) {
    const results = kapResult.data as Array<{ name?: string; snippet?: string }>;
    if (Array.isArray(results) && results.length > 0) {
      contextData.push(`📢 KAP BİLDİRİMLERİ: ${results.slice(0, 3).map((r) => r.name || r.snippet || '').join(' | ')}`);
    }
  }

  const newsResult = toolResults.get('get_news');
  if (newsResult?.success && newsResult.data) {
    const data = newsResult.data as { news?: Array<{ title: string; summary: string; source: string }> };
    if (data.news && data.news.length > 0) {
      contextData.push(`📰 HABERLER (${data.news.length} adet):
${data.news.slice(0, 5).map((n, i) => `${i + 1}. ${n.title} (${n.source})`).join('\n')}`);
    }
  }

  const watchlistResult = toolResults.get('get_watchlist');
  if (watchlistResult?.success && watchlistResult.data) {
    const items = watchlistResult.data as Array<{ symbol: string; name?: string }>;
    if (Array.isArray(items) && items.length > 0) {
      contextData.push(`⭐ TAKİP LİSTESİ: ${items.map((item) => item.symbol).join(', ')}`);
    }
  }

  const systemPrompt = `Sen profesyonel bir BIST (Borsa İstanbul) yatırım analiz asistanısın.

KURALLAR:
1. Türkçe yanıt ver
2. Markdown kullan (başlıklar ##, kalın **, listeler -)
3. Emoji kullan (📊 📈 🔴 🟢 ⚠️)
4. Asla "al/sat" tavsiyesi verme
5. Sadece analitik yorum yap
6. Teknik göstergeleri açıkla (RSI, SMA, Trend)
7. Risk faktörlerini belirt
8. Sonuna uyarı ekle: "⚠️ Bu analiz bilgilendirme amaçlıdır, yatırım tavsiyesi değildir."

YANIT FORMATI:
- Kısa başlık
- Önemli veriler (fiyat, değişim)
- Teknik analiz yorumu
- Risk değerlendirmesi
- Uyarı`;

  const userPrompt = `Kullanıcı Sorusu: ${userMessage}

Sorgu Tipi: ${queryType}

VERİLER:
${contextData.join('\n\n')}

Lütfen bu verilere dayanarak profesyonel bir analiz yap.`;

  try {
    const zai = await ZAI.create();
    const response = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 2000,
      temperature: 0.7
    });

    if (response.choices?.[0]?.message?.content) {
      return response.choices[0].message.content;
    }
    
    return generateFallbackResponse(queryType, toolResults);
  } catch (error) {
    console.error('LLM error:', error);
    return generateFallbackResponse(queryType, toolResults);
  }
}

// ============================================
// FALLBACK RESPONSE
// ============================================

function generateFallbackResponse(queryType: string, toolResults: Map<string, ToolResult>): string {
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
  return response || 'Veri bulundu.';
}

// ============================================
// MAIN API HANDLER - SSE STREAMING
// ============================================

export async function POST(request: NextRequest) {
  const encoder = createSSEEncoder();
  const userId = await getCurrentUserId();

  try {
    const body = await request.json();

    // Create a TransformStream for SSE
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Process in background
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

        // Auth kontrolü - kayıtsız kullanıcı sadece temel bilgileri görebilir
        if (!userId) {
          const upperMessage = message.toUpperCase();
          const symbols = [...new Set(upperMessage.match(/\b([A-Z]{3,5})\b/g) || [])].filter(s => s.length >= 3 && s.length <= 5);
          
          // Sadece fiyat ve haber göster
          let basicResponse = '';
          
          if (symbols.length > 0) {
            // Hisse fiyatı al
            const priceResult = await getStockPrice(symbols[0]);
            if (priceResult.success && priceResult.data) {
              const d = priceResult.data as { symbol: string; name: string; price: number; changePercent: number };
              basicResponse += `## 📊 ${d.symbol} - ${d.name}\n\n`;
              basicResponse += `**Fiyat:** ${d.price} ₺\n`;
              basicResponse += `**Değişim:** ${d.changePercent >= 0 ? '+' : ''}${d.changePercent}%\n\n`;
            }
            
            // Haber al
            const newsResult = await getNews(symbols[0]);
            if (newsResult.success && newsResult.data) {
              const data = newsResult.data as { news?: Array<{ title: string; source: string }> };
              if (data.news && data.news.length > 0) {
                basicResponse += `## 📰 Son Haberler\n\n`;
                data.news.slice(0, 3).forEach((n, i) => {
                  basicResponse += `${i + 1}. ${n.title} (${n.source})\n`;
                });
              }
            }
          } else {
            // Genel haber
            const newsResult = await getNews();
            if (newsResult.success && newsResult.data) {
              const data = newsResult.data as { news?: Array<{ title: string; source: string }> };
              basicResponse = `## 📰 BIST Güncel Haberler\n\n`;
              if (data.news && data.news.length > 0) {
                data.news.slice(0, 5).forEach((n, i) => {
                  basicResponse += `${i + 1}. ${n.title} (${n.source})\n`;
                });
              }
            }
          }
          
          basicResponse += `\n\n---\n⚠️ **Kayıt olmadan sadece temel bilgileri görebilirsiniz.**\nDetaylı analiz ve yorum için lütfen giriş yapın.`;
          
          await writer.write(encoder.encode({
            type: 'complete',
            data: { response: basicResponse, toolsUsed: ['get_stock_price', 'get_news'], queryType: 'basic', symbols, requiresAuth: true }
          }));
          
          await writer.close();
          return;
        }

        const { type, symbols, tools } = analyzeQuery(message);
        const toolResults = new Map<string, ToolResult>();

        // Send initial progress
        await writer.write(encoder.encode({
          type: 'progress',
          data: { message: 'Sorgu analiz ediliyor...', tools: tools.join(', ') }
        }));

        // Execute tools sequentially with progress updates
        for (const tool of tools) {
          const toolInfo = TOOLS_INFO[tool] || { name: tool, description: `${tool} çalışıyor...` };

          // Send tool start event
          await writer.write(encoder.encode({
            type: 'tool_start',
            data: { tool, status: 'running', message: `${toolInfo.name}: ${toolInfo.description}` }
          }));

          // Get params for tool
          let params: Record<string, unknown> = {};
          switch (tool) {
            case 'get_stock_price':
            case 'get_stock_history':
            case 'get_kap_data':
              params = { symbol: symbols[0], period: '1Y' };
              break;
            case 'web_search':
              params = { query: symbols.length > 0 ? `${symbols[0]} hisse analiz` : 'BIST borsa' };
              break;
            default:
              params = {};
          }

          // Execute tool
          const result = await executeTool(tool, params, userId);
          toolResults.set(tool, result);

          // Send tool result event
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

        // Send LLM start event
        await writer.write(encoder.encode({
          type: 'llm_start',
          data: { message: '🤖 AI analiz yapıyor...' }
        }));

        // Generate LLM response
        const response = await generateLLMResponse(message, type, toolResults);

        // Send complete event
        await writer.write(encoder.encode({
          type: 'complete',
          data: { response, toolsUsed: tools, queryType: type, symbols }
        }));

        await writer.close();
      } catch (error) {
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
