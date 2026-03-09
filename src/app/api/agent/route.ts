import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { sql } from '@vercel/postgres';
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
  type: 'progress' | 'tool_start' | 'tool_result' | 'complete' | 'error';
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

      // RSI Calculation
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
          historical,
          count: historical.length,
          period,
          indicators: {
            sma20: sma20 ? Math.round(sma20 * 100) / 100 : null,
            sma50: sma50 ? Math.round(sma50 * 100) / 100 : null,
            rsi: rsi ? Math.round(rsi * 100) / 100 : null
          },
          trend: sma20 && sma50 ? (sma20 > sma50 ? 'BULLISH' : 'BEARISH') : 'NEUTRAL',
          priceChange: Math.round(priceChange * 100) / 100
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
    const result = userId
      ? await sql`SELECT * FROM watchlist WHERE user_id = ${userId} ORDER BY created_at DESC`
      : await sql`SELECT * FROM watchlist WHERE user_id IS NULL ORDER BY created_at DESC`;

    return { success: true, data: result.rows, _meta: { tool: 'get_watchlist', duration: Date.now() - startTime } };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'get_watchlist', duration: Date.now() - startTime } };
  }
}

async function addToWatchlist(symbol: string, name: string, userId: string | null): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    const result = userId
      ? await sql`
          INSERT INTO watchlist (symbol, name, user_id)
          VALUES (${symbol.toUpperCase()}, ${name}, ${userId})
          ON CONFLICT DO NOTHING
          RETURNING *
        `
      : await sql`
          INSERT INTO watchlist (symbol, name, user_id)
          VALUES (${symbol.toUpperCase()}, ${name}, NULL)
          ON CONFLICT DO NOTHING
          RETURNING *
        `;

    return { success: true, data: result.rows[0], _meta: { tool: 'add_to_watchlist', duration: Date.now() - startTime } };
  } catch (error) {
    return { success: false, error: String(error), _meta: { tool: 'add_to_watchlist', duration: Date.now() - startTime } };
  }
}

async function removeFromWatchlist(symbol: string, userId: string | null): Promise<ToolResult> {
  const startTime = Date.now();
  try {
    if (userId) {
      await sql`DELETE FROM watchlist WHERE symbol = ${symbol.toUpperCase()} AND user_id = ${userId}`;
    } else {
      await sql`DELETE FROM watchlist WHERE symbol = ${symbol.toUpperCase()} AND user_id IS NULL`;
    }
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
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY || ''}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'Sen finansal analiz asistanısın. TXT dosyasını analiz et.' },
          { role: 'user', content: `Dosya: ${filename || 'bilinmiyor'}\n\n${content.slice(0, 8000)}` }
        ],
        max_tokens: 1500
      })
    });

    const data = await response.json();
    return {
      success: true,
      data: { analysis: data.choices?.[0]?.message?.content },
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
// QUERY ANALYZER
// ============================================

function analyzeQuery(message: string): { type: string; symbols: string[]; tools: string[] } {
  const upperMessage = message.toUpperCase();
  const symbols = [...new Set(upperMessage.match(/\b([A-Z]{3,5})\b/g) || [])].filter(s => s.length >= 3 && s.length <= 5);

  let type = 'general';
  let tools: string[] = [];

  if (/(tahmin|gelecek|ne olur|kaç olur|gün sonra)/i.test(message)) {
    type = 'price_prediction';
    tools = ['get_stock_price', 'get_stock_history', 'get_kap_data', 'web_search'];
  } else if (/satmalı|satsam|satayım/i.test(message)) {
    type = 'sell_decision';
    tools = ['get_stock_price', 'get_stock_history', 'get_kap_data', 'web_search'];
  } else if (/nereye|yatırım|öneri|hangi hisse/i.test(message)) {
    type = 'market_overview';
    tools = ['scan_market'];
  } else if (/analiz|incele|detay/i.test(message)) {
    type = 'analysis';
    tools = symbols.length > 0 ? ['get_stock_price', 'get_stock_history', 'get_kap_data'] : ['scan_market'];
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
    tools = ['get_stock_price'];
  } else {
    tools = ['scan_market'];
  }

  return { type, symbols, tools };
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

        // Generate response
        const response = generateFallbackResponse(type, toolResults);

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
