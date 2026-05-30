/**
 * 마일리지 사용 API
 *
 * POST /api/mileage/use
 *   Body: { bookingId: string, useAmount: number, sellingPrice: number }
 *   → { used: number, marginImpact: number, remainingBalance: number }
 *
 * 보안: 세션 인증, 잔액 검증, 최대 사용 한도 검증
 */
import { NextRequest, NextResponse } from 'next/server';
import { useMileage as applyMileage } from '@/lib/mileage-service';
import { calcMaxUsable } from '@/lib/mileage-service';
import { getBalance } from '@/lib/mileage-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // ── 세션 확인 ────────────────────────────────────────────
    const { supabase } = await import('@/lib/supabase');
    const sb = supabase;
    const { data: { user } } = await sb.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── 요청 파싱 ────────────────────────────────────────────
    const body = await request.json();
    const { bookingId, useAmount, sellingPrice } = body as {
      bookingId?: string;
      useAmount?: number;
      sellingPrice?: number;
    };

    if (!bookingId || !useAmount || !sellingPrice) {
      return NextResponse.json(
        { error: 'bookingId, useAmount, sellingPrice are required' },
        { status: 400 },
      );
    }

    if (useAmount <= 0) {
      return NextResponse.json(
        { error: '사용 금액은 0보다 커야 합니다' },
        { status: 400 },
      );
    }

    // ── 잔액 확인 ────────────────────────────────────────────
    const balance = await getBalance(user.id);
    const maxUsable = calcMaxUsable(balance, sellingPrice);

    if (useAmount > maxUsable) {
      return NextResponse.json(
        { error: `최대 사용 가능 금액은 ₩${maxUsable.toLocaleString('ko-KR')}입니다` },
        { status: 400 },
      );
    }

    // ── 마일리지 사용 처리 ──────────────────────────────────
    const result = await applyMileage({
      userId: user.id,
      bookingId,
      useAmount,
      sellingPrice,
    });

    if (!result) {
      return NextResponse.json(
        { error: '마일리지 사용 처리에 실패했습니다' },
        { status: 400 },
      );
    }

    return NextResponse.json({
      used: result.used,
      marginImpact: result.margin_impact,
      remainingBalance: result.remaining_balance,
      transactionId: result.transaction_id,
    });
  } catch (error) {
    console.error('[Mileage/Use] 오류:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * 마일리지 최대 사용 가능 금액 계산 (GET)
 *
 * GET /api/mileage/use?sellingPrice=100000
 *   → { maxUsable: 30000, balance: 50000 }
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase } = await import('@/lib/supabase');
    const sb = supabase;
    const { data: { user } } = await sb.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sellingPrice = parseInt(searchParams.get('sellingPrice') ?? '0', 10);

    if (sellingPrice <= 0) {
      return NextResponse.json(
        { error: 'sellingPrice is required (양수)' },
        { status: 400 },
      );
    }

    const balance = await getBalance(user.id);
    const maxUsable = calcMaxUsable(balance, sellingPrice);

    return NextResponse.json({
      balance,
      maxUsable,
      sellingPrice,
    });
  } catch (error) {
    console.error('[Mileage/Use] GET 오류:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
