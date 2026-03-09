import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getPriceAlerts, createPriceAlert, deletePriceAlert } from '@/lib/db';
import { getSupabase } from '@/lib/supabase';

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
    const alerts = await getPriceAlerts(userId);

    // Güncel fiyatları ekle
    const withPrices = await Promise.all(
      alerts.map(async (alert) => {
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
    const supabase = getSupabase();
    let query = supabase
      .from('price_alerts')
      .select('id')
      .eq('symbol', symbol.toUpperCase())
      .eq('target_price', parseFloat(targetPrice))
      .eq('condition', condition)
      .eq('active', true);
    
    if (userId) {
      query = query.eq('user_id', userId);
    } else {
      query = query.is('user_id', null);
    }

    const { data: existing } = await query.limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({
        success: false,
        error: 'Bu bildirim zaten mevcut'
      });
    }

    // Oluştur
    const result = await createPriceAlert(
      symbol.toUpperCase(),
      parseFloat(targetPrice),
      condition,
      userId
    );

    if (!result) {
      return NextResponse.json({
        success: false,
        error: 'Oluşturulamadı'
      });
    }

    return NextResponse.json({
      success: true,
      data: result,
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

    const success = await deletePriceAlert(id, userId);

    if (!success) {
      return NextResponse.json({
        success: false,
        error: 'Silinemedi'
      });
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

    const supabase = getSupabase();
    let query = supabase
      .from('price_alerts')
      .update(
        triggered
          ? { active: false, triggered: true, triggered_at: new Date().toISOString() }
          : { active: active ?? true }
      )
      .eq('id', id);

    if (userId) {
      query = query.eq('user_id', userId);
    } else {
      query = query.is('user_id', null);
    }

    const { error } = await query;

    if (error) {
      return NextResponse.json({
        success: false,
        error: 'Güncellenemedi'
      });
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
