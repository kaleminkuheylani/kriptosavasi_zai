import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

// Cache
let marketCache: { data: unknown; timestamp: number } | null = null;
const CACHE_TTL = 120000; // 2 dakika

interface StockData {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
}

// Piyasa verisi çek
async function fetchMarketData() {
  if (marketCache && Date.now() - marketCache.timestamp < CACHE_TTL) {
    return marketCache.data;
  }

  try {
    const listResponse = await fetch('https://api.asenax.com/bist/list');
    const listData = await listResponse.json();

    if (listData.code !== "0" || !Array.isArray(listData.data)) {
      return null;
    }

    const stocks = listData.data
      .filter((item: { tip?: string }) => item.tip === "Hisse")
      .slice(0, 1000)
      .map((item: { kod?: string; ad?: string }) => ({
        code: item.kod || '',
        name: item.ad || ''
      }));

    const results: StockData[] = [];

    // Batch fetch
    for (let i = 0; i < stocks.length; i += 20) {
      const batch = stocks.slice(i, i + 20);
      const batchResults = await Promise.all(
        batch.map(async (stock: { code: string; name: string }) => {
          try {
            const priceResponse = await fetch(`https://api.asenax.com/bist/get/${stock.code}`);
            const priceData = await priceResponse.json();

            if (priceData.code === "0" && priceData.data?.hisseYuzeysel) {
              const d = priceData.data.hisseYuzeysel;
              return {
                code: d.sembol || stock.code,
                name: d.aciklama || stock.name,
                price: d.kapanis || 0,
                changePercent: d.yuzdedegisim || 0,
                volume: d.hacimlot || 0
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

    // Sırala ve kategorize et
    const sorted = results.sort((a, b) => b.changePercent - a.changePercent);

    const data = {
      success: true,
      data: {
        all: sorted,
        gainers: sorted.filter(s => s.changePercent > 0).slice(0, 15),
        losers: sorted.filter(s => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 15),
        mostActive: [...sorted].sort((a, b) => b.volume - a.volume).slice(0, 10),
        total: sorted.length,
        gainersCount: sorted.filter(s => s.changePercent > 0).length,
        losersCount: sorted.filter(s => s.changePercent < 0).length,
        avgChange: sorted.length > 0
          ? Math.round(sorted.reduce((a, b) => a + b.changePercent, 0) / sorted.length * 100) / 100
          : 0
      }
    };

    marketCache = { data, timestamp: Date.now() };
    return data;
  } catch (error) {
    console.error('Market fetch error:', error);
    return null;
  }
}

// Popüler hisseler
async function getPopularStocks() {
  try {
    const result = await sql`
      SELECT symbol, name, COUNT(*) as count
      FROM watchlist
      GROUP BY symbol, name
      ORDER BY count DESC
      LIMIT 10
    `;

    // Fiyatları ekle
    const withPrices = await Promise.all(
      result.rows.map(async (item) => {
        try {
          const response = await fetch(`https://api.asenax.com/bist/get/${item.symbol}`);
          const data = await response.json();

          if (data.code === "0" && data.data?.hisseYuzeysel) {
            return {
              symbol: item.symbol,
              name: item.name || item.symbol,
              count: Number(item.count),
              price: data.data.hisseYuzeysel.kapanis || 0,
              changePercent: data.data.hisseYuzeysel.yuzdedegisim || 0
            };
          }
          return {
            symbol: item.symbol,
            name: item.name || item.symbol,
            count: Number(item.count),
            price: 0,
            changePercent: 0
          };
        } catch {
          return {
            symbol: item.symbol,
            name: item.name || item.symbol,
            count: Number(item.count),
            price: 0,
            changePercent: 0
          };
        }
      })
    );

    return withPrices;
  } catch (error) {
    console.error('Popular stocks error:', error);
    return [];
  }
}

// GET - Piyasa verileri
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type');

    // Popüler hisseler
    if (type === 'popular') {
      const popular = await getPopularStocks();
      return NextResponse.json({
        success: true,
        data: popular
      });
    }

    // Yükselenler
    if (type === 'gainers') {
      const marketData = await fetchMarketData();
      if (!marketData) {
        return NextResponse.json({
          success: false,
          error: 'Veri alınamadı'
        }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        data: (marketData as { data: { gainers: StockData[] } }).data.gainers
      });
    }

    // Düşenler
    if (type === 'losers') {
      const marketData = await fetchMarketData();
      if (!marketData) {
        return NextResponse.json({
          success: false,
          error: 'Veri alınamadı'
        }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        data: (marketData as { data: { losers: StockData[] } }).data.losers
      });
    }

    // Tüm piyasa özeti
    const marketData = await fetchMarketData();
    if (!marketData) {
      return NextResponse.json({
        success: false,
        error: 'Veri alınamadı'
      }, { status: 500 });
    }

    return NextResponse.json(marketData);
  } catch (error) {
    console.error('Market API error:', error);
    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}
