import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sql } from '@vercel/postgres';

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

    const result = userId
      ? await sql`
          SELECT * FROM watchlist 
          WHERE user_id = ${userId}
          ORDER BY created_at DESC
        `
      : await sql`
          SELECT * FROM watchlist 
          WHERE user_id IS NULL
          ORDER BY created_at DESC
        `;

    // Fiyatları ekle
    const withPrices = await Promise.all(
      result.rows.map(async (item) => {
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
    const existing = userId
      ? await sql`
          SELECT 1 FROM watchlist 
          WHERE symbol = ${upperSymbol} AND user_id = ${userId}
        `
      : await sql`
          SELECT 1 FROM watchlist 
          WHERE symbol = ${upperSymbol} AND user_id IS NULL
        `;

    if (existing.rows.length > 0) {
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
    const result = userId
      ? await sql`
          INSERT INTO watchlist (symbol, name, user_id)
          VALUES (${upperSymbol}, ${stockName || upperSymbol}, ${userId})
          RETURNING *
        `
      : await sql`
          INSERT INTO watchlist (symbol, name, user_id)
          VALUES (${upperSymbol}, ${stockName || upperSymbol}, NULL)
          RETURNING *
        `;

    return NextResponse.json({
      success: true,
      data: result.rows[0],
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

    if (userId) {
      await sql`
        DELETE FROM watchlist 
        WHERE symbol = ${upperSymbol} AND user_id = ${userId}
      `;
    } else {
      await sql`
        DELETE FROM watchlist 
        WHERE symbol = ${upperSymbol} AND user_id IS NULL
      `;
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
