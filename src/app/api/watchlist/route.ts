import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getWatchlist, addToWatchlist, removeFromWatchlist, isInWatchlist } from '@/lib/db';

// Kullanıcı ID al
async function getCurrentUserId(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get('userId')?.value || null;
  } catch {
    return null;
  }
}

// GET - Takip listesi
export async function GET() {
  try {
    const userId = await getCurrentUserId();
    const items = await getWatchlist(userId);

    // Fiyatları ekle
    const withPrices = await Promise.all(
      items.map(async (item) => {
        try {
          const response = await fetch(`https://api.asenax.com/bist/get/${item.symbol}`);
          const data = await response.json();

          if (data.code === "0" && data.data?.hisseYuzeysel) {
            return {
              ...item,
              currentPrice: data.data.hisseYuzeysel.kapanis || 0,
              changePercent: data.data.hisseYuzeysel.yuzdedegisim || 0,
              change: data.data.hisseYuzeysel.net || 0
            };
          }
          return { ...item, currentPrice: 0, changePercent: 0, change: 0 };
        } catch {
          return { ...item, currentPrice: 0, changePercent: 0, change: 0 };
        }
      })
    );

    return NextResponse.json({
      success: true,
      data: withPrices,
      count: withPrices.length
    });
  } catch (error) {
    console.error('Watchlist GET error:', error);
    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}

// POST - Listeye ekle
export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const body = await request.json();
    const { symbol, name } = body;

    if (!symbol || typeof symbol !== 'string') {
      return NextResponse.json({
        success: false,
        error: 'Hisse kodu gerekli'
      });
    }

    const upperSymbol = symbol.toUpperCase();

    // Zaten var mı kontrol et
    const existing = await isInWatchlist(upperSymbol, userId);

    if (existing) {
      return NextResponse.json({
        success: false,
        error: 'Bu hisse zaten takip listesinde'
      });
    }

    // Hisse adını al
    let stockName = name;
    if (!stockName) {
      try {
        const response = await fetch(`https://api.asenax.com/bist/get/${upperSymbol}`);
        const data = await response.json();
        if (data.code === "0" && data.data?.hisseYuzeysel) {
          stockName = data.data.hisseYuzeysel.aciklama || upperSymbol;
        }
      } catch {
        stockName = upperSymbol;
      }
    }

    // Ekle
    const result = await addToWatchlist(upperSymbol, stockName || upperSymbol, userId);

    if (!result) {
      return NextResponse.json({
        success: false,
        error: 'Eklenemedi'
      });
    }

    return NextResponse.json({
      success: true,
      data: result,
      message: `${upperSymbol} takip listesine eklendi`
    });
  } catch (error) {
    console.error('Watchlist POST error:', error);
    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}

// DELETE - Listeden çıkar
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const symbol = request.nextUrl.searchParams.get('symbol');

    if (!symbol) {
      return NextResponse.json({
        success: false,
        error: 'Hisse kodu gerekli'
      });
    }

    const upperSymbol = symbol.toUpperCase();
    const success = await removeFromWatchlist(upperSymbol, userId);

    if (!success) {
      return NextResponse.json({
        success: false,
        error: 'Kaldırılamadı'
      });
    }

    return NextResponse.json({
      success: true,
      message: `${upperSymbol} takip listesinden kaldırıldı`
    });
  } catch (error) {
    console.error('Watchlist DELETE error:', error);
    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}
