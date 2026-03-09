import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createUser, getUserByRumuz, getUserById, getUserStats } from '@/lib/db';

// GET - Mevcut kullanıcıyı getir
export async function GET() {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('userId')?.value;

    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'Oturum bulunamadı'
      });
    }

    // Kullanıcıyı getir
    const user = await getUserById(userId);

    if (!user) {
      const cookieStore = await cookies();
      cookieStore.delete('userId');
      return NextResponse.json({
        success: false,
        error: 'Kullanıcı bulunamadı'
      });
    }

    // İstatistikleri al
    const stats = await getUserStats(userId);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        rumuz: user.rumuz,
        avatar: user.avatar,
        watchlistCount: stats.watchlistCount,
        alertsCount: stats.alertsCount,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Auth GET error:', error);
    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}

// POST - Giriş veya Kayıt
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { rumuz, action } = body;

    if (!rumuz || rumuz.trim().length < 2 || rumuz.trim().length > 20) {
      return NextResponse.json({
        success: false,
        error: 'Rumuz 2-20 karakter arası olmalıdır'
      });
    }

    const cleanRumuz = rumuz.trim().toLowerCase();

    if (action === 'register') {
      // Yeni kayıt
      const existing = await getUserByRumuz(cleanRumuz);

      if (existing) {
        return NextResponse.json({
          success: false,
          error: 'Bu rumuz zaten alınmış'
        });
      }

      // Rastgele avatar rengi
      const colors = ['emerald', 'cyan', 'violet', 'amber', 'rose', 'blue'];
      const avatar = colors[Math.floor(Math.random() * colors.length)];

      const user = await createUser(cleanRumuz, avatar);

      if (!user) {
        return NextResponse.json({
          success: false,
          error: 'Kayıt oluşturulamadı'
        });
      }

      // Cookie set (7 gün)
      const cookieStore = await cookies();
      cookieStore.set('userId', user.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7 // 7 gün
      });

      return NextResponse.json({
        success: true,
        message: 'Kayıt başarılı! Hoş geldiniz.',
        user: {
          id: user.id,
          rumuz: user.rumuz,
          avatar: user.avatar,
          watchlistCount: 0,
          alertsCount: 0,
          createdAt: user.created_at
        }
      });
    } else {
      // Giriş
      const user = await getUserByRumuz(cleanRumuz);

      if (!user) {
        return NextResponse.json({
          success: false,
          error: 'Bu rumuz kayıtlı değil. Kayıt olmak ister misiniz?'
        });
      }

      // Cookie set (7 gün)
      const cookieStore = await cookies();
      cookieStore.set('userId', user.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7 // 7 gün
      });

      const stats = await getUserStats(user.id);

      return NextResponse.json({
        success: true,
        message: 'Giriş başarılı! Hoş geldiniz.',
        user: {
          id: user.id,
          rumuz: user.rumuz,
          avatar: user.avatar,
          watchlistCount: stats.watchlistCount,
          alertsCount: stats.alertsCount,
          createdAt: user.created_at
        }
      });
    }
  } catch (error) {
    console.error('Auth POST error:', error);
    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}

// DELETE - Çıkış
export async function DELETE() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete('userId');

    return NextResponse.json({
      success: true,
      message: 'Çıkış yapıldı'
    });
  } catch (error) {
    console.error('Auth DELETE error:', error);
    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}
