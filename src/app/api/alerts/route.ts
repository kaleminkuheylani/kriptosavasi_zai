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

// GET - Bildirimleri listele
export async function GET() {
  try {
    const userId = await getCurrentUserId();

    const result = userId
      ? await sql`
          SELECT * FROM price_alerts 
          WHERE user_id = ${userId} AND active = true
          ORDER BY created_at DESC
        `
      : await sql`
          SELECT * FROM price_alerts 
          WHERE user_id IS NULL AND active = true
          ORDER BY created_at DESC
        `;

    // Güncel fiyatları ekle
    const withPrices = await Promise.all(
      result.rows.map(async (alert) => {
        try {
          const response = await fetch(`https://api.asenax.com/bist/get/${alert.symbol}`);
          const data = await response.json();

          if (data.code === "0" && data.data?.hisseYuzeysel) {
            const currentPrice = data.data.hisseYuzeysel.kapanis || 0;
            const targetPrice = alert.target_price;

            // Mesafe hesapla
            let distance = '0';
            if (currentPrice > 0) {
              const diff = alert.condition === 'above'
                ? ((targetPrice - currentPrice) / currentPrice * 100)
                : ((currentPrice - targetPrice) / currentPrice * 100);
              distance = diff.toFixed(2);
            }

            // Tetiklendi mi kontrol et
            let shouldTrigger = false;
            if (alert.condition === 'above' && currentPrice >= targetPrice) {
              shouldTrigger = true;
            } else if (alert.condition === 'below' && currentPrice <= targetPrice) {
              shouldTrigger = true;
            }

            return {
              ...alert,
              currentPrice,
              distance,
              shouldTrigger
            };
          }
          return { ...alert, currentPrice: 0, distance: 'N/A', shouldTrigger: false };
        } catch {
          return { ...alert, currentPrice: 0, distance: 'N/A', shouldTrigger: false };
        }
      })
    );

    return NextResponse.json({
      success: true,
      data: withPrices,
      count: withPrices.length
    });
  } catch (error) {
    console.error('Alerts GET error:', error);
    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}

// POST - Yeni bildirim oluştur
export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const body = await request.json();
    const { symbol, targetPrice, condition } = body;

    if (!symbol || !targetPrice || !condition) {
      return NextResponse.json({
        success: false,
        error: 'Tüm alanlar gerekli (symbol, targetPrice, condition)'
      });
    }

    if (!['above', 'below'].includes(condition)) {
      return NextResponse.json({
        success: false,
        error: 'Condition "above" veya "below" olmalı'
      });
    }

    // Aynı bildirim var mı kontrol et
    const existing = userId
      ? await sql`
          SELECT 1 FROM price_alerts 
          WHERE symbol = ${symbol.toUpperCase()}
            AND target_price = ${parseFloat(targetPrice)}
            AND condition = ${condition}
            AND user_id = ${userId}
            AND active = true
        `
      : await sql`
          SELECT 1 FROM price_alerts 
          WHERE symbol = ${symbol.toUpperCase()}
            AND target_price = ${parseFloat(targetPrice)}
            AND condition = ${condition}
            AND user_id IS NULL
            AND active = true
        `;

    if (existing.rows.length > 0) {
      return NextResponse.json({
        success: false,
        error: 'Bu bildirim zaten mevcut'
      });
    }

    // Oluştur
    const result = userId
      ? await sql`
          INSERT INTO price_alerts (symbol, target_price, condition, user_id)
          VALUES (${symbol.toUpperCase()}, ${parseFloat(targetPrice)}, ${condition}, ${userId})
          RETURNING *
        `
      : await sql`
          INSERT INTO price_alerts (symbol, target_price, condition, user_id)
          VALUES (${symbol.toUpperCase()}, ${parseFloat(targetPrice)}, ${condition}, NULL)
          RETURNING *
        `;

    return NextResponse.json({
      success: true,
      data: result.rows[0],
      message: `${symbol.toUpperCase()} için ${targetPrice} ₺ ${condition === 'above' ? 'üzerine çıkınca' : 'altına inince'} bildirim oluşturuldu`
    });
  } catch (error) {
    console.error('Alerts POST error:', error);
    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}

// DELETE - Bildirim sil
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return NextResponse.json({
        success: false,
        error: 'Bildirim ID gerekli'
      });
    }

    if (userId) {
      await sql`
        DELETE FROM price_alerts 
        WHERE id = ${id} AND user_id = ${userId}
      `;
    } else {
      await sql`
        DELETE FROM price_alerts 
        WHERE id = ${id} AND user_id IS NULL
      `;
    }

    return NextResponse.json({
      success: true,
      message: 'Bildirim silindi'
    });
  } catch (error) {
    console.error('Alerts DELETE error:', error);
    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}

// PATCH - Bildirim güncelle
export async function PATCH(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const body = await request.json();
    const { id, active, triggered } = body;

    if (!id) {
      return NextResponse.json({
        success: false,
        error: 'Bildirim ID gerekli'
      });
    }

    if (userId) {
      if (triggered) {
        await sql`
          UPDATE price_alerts 
          SET active = false, triggered = true, triggered_at = NOW()
          WHERE id = ${id} AND user_id = ${userId}
        `;
      } else {
        await sql`
          UPDATE price_alerts 
          SET active = ${active ?? true}
          WHERE id = ${id} AND user_id = ${userId}
        `;
      }
    } else {
      if (triggered) {
        await sql`
          UPDATE price_alerts 
          SET active = false, triggered = true, triggered_at = NOW()
          WHERE id = ${id} AND user_id IS NULL
        `;
      } else {
        await sql`
          UPDATE price_alerts 
          SET active = ${active ?? true}
          WHERE id = ${id} AND user_id IS NULL
        `;
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Güncellendi'
    });
  } catch (error) {
    console.error('Alerts PATCH error:', error);
    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}
