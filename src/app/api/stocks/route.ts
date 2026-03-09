import { NextResponse } from 'next/server';

// Cache için
let stocksCache: { data: unknown; timestamp: number } | null = null;
const CACHE_TTL = 60000; // 1 dakika

// Hisse tipi
interface StockData {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  ceiling: number;
  floor: number;
}

// Asenax API'den hisse listesi ve fiyatları
async function fetchStocksFromAPI(): Promise<{ success: boolean; data?: StockData[]; error?: string }> {
  try {
    // Asenax'tan 150 hisse al
    const seenCodes = new Set<string>();
    const allStocks: { code: string; name: string }[] = [];

    const asenaxRes = await fetch('https://api.asenax.com/bist/list', { next: { revalidate: 60 } });
    const asenaxData = await asenaxRes.json();

    if (asenaxData.code === "0" && Array.isArray(asenaxData.data)) {
      asenaxData.data
        .filter((item: { tip?: string }) => item.tip === "Hisse")
        .forEach((item: { kod?: string; ad?: string }) => {
          const code = item.kod || '';
          if (code.length > 0 && !seenCodes.has(code)) {
            seenCodes.add(code);
            allStocks.push({ code, name: item.ad || '' });
          }
        });
    }

    // BigPara'dan eksik hisseleri tamamla
    try {
      const bigparaRes = await fetch(
        'https://bigpara.hurriyet.com.tr/api/HisseSenedi/HisseSenediList',
        { next: { revalidate: 60 } }
      );
      const bigparaData = await bigparaRes.json();
      const list = bigparaData?.data?.hisseler ?? bigparaData?.data ?? bigparaData;
      if (Array.isArray(list)) {
        list.forEach((item: Record<string, string>) => {
          const code = (item.KOD || item.kod || item.symbol || item.Symbol || '').trim();
          const name = item.AD || item.ad || item.name || item.Name || '';
          if (code.length > 0 && !seenCodes.has(code)) {
            seenCodes.add(code);
            allStocks.push({ code, name });
          }
        });
      }
    } catch {
      // BigPara çalışmıyorsa sadece Asenax ile devam
    }

    if (allStocks.length === 0) {
      return { success: false, error: 'Liste alınamadı' };
    }

    const stocks = allStocks.slice(0, 1000);

    // Fiyatları toplu al (batch)
    const results: StockData[] = [];
    const batchSize = 20;

    for (let i = 0; i < Math.min(stocks.length, 1000); i += batchSize) {
      const batch = stocks.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (stock: { code: string; name: string }) => {
          try {
            const priceResponse = await fetch(
              `https://api.asenax.com/bist/get/${stock.code}`,
              { next: { revalidate: 60 } }
            );
            const priceData = await priceResponse.json();

            if (priceData.code === "0" && priceData.data?.hisseYuzeysel) {
              const d = priceData.data.hisseYuzeysel;
              return {
                code: d.sembol || stock.code,
                name: d.aciklama || stock.name,
                price: d.kapanis || 0,
                change: d.net || 0,
                changePercent: d.yuzdedegisim || 0,
                volume: d.hacimlot || 0,
                high: d.yuksek || 0,
                low: d.dusuk || 0,
                open: d.acilis || 0,
                previousClose: d.dunkukapanis || 0,
                ceiling: d.tavan || 0,
                floor: d.taban || 0
              };
            }
            return null;
          } catch {
            return null;
          }
        })
      );

      results.push(...batchResults.filter(Boolean) as StockData[]);
    }

    return { success: true, data: results };
  } catch (error) {
    console.error('Fetch stocks error:', error);
    return { success: false, error: 'API hatası' };
  }
}

// GET - Tüm hisseleri getir
export async function GET() {
  try {
    // Cache kontrolü
    if (stocksCache && Date.now() - stocksCache.timestamp < CACHE_TTL) {
      return NextResponse.json({
        success: true,
        data: stocksCache.data,
        cached: true
      });
    }

    const result = await fetchStocksFromAPI();

    if (!result.success || !result.data) {
      return NextResponse.json({
        success: false,
        error: result.error || 'Veri alınamadı'
      }, { status: 500 });
    }

    // Cache'e kaydet
    stocksCache = { data: result.data, timestamp: Date.now() };

    return NextResponse.json({
      success: true,
      data: result.data,
      count: result.data.length,
      cached: false
    });
  } catch (error) {
    console.error('Stocks API error:', error);
    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}
