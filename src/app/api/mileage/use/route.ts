/**
 * Mileage usage API.
 *
 * POST /api/mileage/use
 *   Body: { bookingId: string, useAmount: number, sellingPrice: number }
 *   -> { used: number, marginImpact: number, remainingBalance: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  calcMaxUsable,
  getBalance,
  useMileage as consumeMileage,
} from '@/lib/mileage-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await import('@/lib/supabase');
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
        { error: 'useAmount must be greater than 0' },
        { status: 400 },
      );
    }

    const balance = await getBalance(user.id);
    const maxUsable = calcMaxUsable(balance, sellingPrice);

    if (useAmount > maxUsable) {
      return NextResponse.json(
        { error: `Maximum usable mileage is ${maxUsable.toLocaleString('ko-KR')}` },
        { status: 400 },
      );
    }

    const result = await consumeMileage({
      userId: user.id,
      bookingId,
      useAmount,
      sellingPrice,
    });

    if (!result) {
      return NextResponse.json(
        { error: 'Failed to use mileage' },
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
    console.error('[Mileage/Use] error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * GET /api/mileage/use?sellingPrice=100000
 *   -> { maxUsable: 30000, balance: 50000, sellingPrice: 100000 }
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase } = await import('@/lib/supabase');
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sellingPrice = parseInt(searchParams.get('sellingPrice') ?? '0', 10);

    if (sellingPrice <= 0) {
      return NextResponse.json(
        { error: 'sellingPrice is required' },
        { status: 400 },
      );
    }

    const balance = await getBalance(user.id);
    const maxUsable = calcMaxUsable(balance, sellingPrice);

    return NextResponse.json({
      maxUsable,
      balance,
      sellingPrice,
    });
  } catch (error) {
    console.error('[Mileage/Use/GET] error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
