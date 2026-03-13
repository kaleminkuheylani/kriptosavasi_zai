import { NextRequest, NextResponse } from 'next/server';

// Cache
const priceCache: Map<string, { data: unknown; timestamp: number }> = new Map();
const historyCache: Map<string, { data: unknown; timestamp: number }> = new Map();
const CACHE_TTL = 60000; // 1 dakika

// Hisse fiyatı al
async function getStockPrice(symbol: string) {
  const cached = priceCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetch(`https://api.asenax.com/bist/get/${symbol.toUpperCase()}`);
    const data = await response.json();

    if (data.code === "0" && data.data?.hisseYuzeysel) {
      const d = data.data.hisseYuzeysel;
      const result = {
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
        }
      };
      priceCache.set(symbol, { data: result, timestamp: Date.now() });
      return result;
    }
    return { success: false, error: 'Hisse bulunamadı' };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Geçmiş veriler al
async function getStockHistory(symbol: string, period: string = '1M') {
  const cacheKey = `${symbol}-${period}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL * 5) {
    return cached.data;
  }

  try {
    const rangeMap: Record<string, number> = {
      '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '3Y': 1095, '5Y': 1825,
    };
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
        .filter((e) => {
          if (!e.date) return false;
          if (e.date_utc) return e.date_utc >= cutoff;
          // fallback: parse date string when date_utc is missing
          return new Date(e.date).getTime() / 1000 >= cutoff;
        })
        .map((e) => ({
          date: e.date,
          open: e.open,
          high: e.high,
          low: e.low,
          close: e.close,
          volume: e.volume,
        }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Teknik göstergeler
      const closes = historical.map(h => h.close);
      const sma20 = closes.length >= 20
        ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20
        : null;
      const sma50 = closes.length >= 50
        ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50
        : null;

      // RSI hesapla
      const rsi = calculateRSI(closes, 14);

      // Trend belirleme
      let trend = 'NEUTRAL';
      if (sma20 && sma50) {
        trend = sma20 > sma50 ? 'BULLISH' : 'BEARISH';
      }

      const result = {
        success: true,
        data: historical,
        count: historical.length,
        indicators: {
          sma20: sma20 ? Math.round(sma20 * 100) / 100 : null,
          sma50: sma50 ? Math.round(sma50 * 100) / 100 : null,
          rsi: rsi ? Math.round(rsi * 100) / 100 : null
        },
        trend,
        period
      };

      historyCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    }
    return { success: false, error: 'Veri bulunamadı' };
  } catch (error) {
    console.error('History fetch error:', error);
    return { success: false, error: String(error) };
  }
}

// RSI hesaplama
function calculateRSI(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null;

  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  const recentChanges = changes.slice(-period);
  const gains = recentChanges.filter(c => c > 0).reduce((a, b) => a + b, 0);
  const losses = Math.abs(recentChanges.filter(c => c < 0).reduce((a, b) => a + b, 0));

  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

// GET - Hisse detayı
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const searchParams = request.nextUrl.searchParams;
    const period = searchParams.get('period') || '1M';

    // Paralel fiyat ve geçmiş al
    const [priceResult, historyResult] = await Promise.all([
      getStockPrice(symbol),
      getStockHistory(symbol, period)
    ]);

    if (!priceResult.success) {
      return NextResponse.json({
        success: false,
        error: (priceResult as { error: string }).error || 'Hisse bulunamadı'
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        detail: (priceResult as { data: unknown }).data,
        historical: historyResult.success ? (historyResult as { data: unknown }).data : [],
        indicators: historyResult.success ? (historyResult as { indicators: unknown }).indicators : null,
        trend: historyResult.success ? (historyResult as { trend: string }).trend : null,
        period
      }
    });
  } catch (error) {
    console.error('Stock detail error:', error);
    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}
