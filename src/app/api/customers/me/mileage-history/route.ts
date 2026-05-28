/**
 * 내 마일리지 거래 내역 조회 API
 *
 * GET /api/customers/me/mileage-history?limit=20&offset=0&type=EARNED
 *   → { transactions: MileageTx[], hasMore: boolean }
 *
 * 인증: 세션 기반 (로그인 사용자)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // ── 세션 확인 ────────────────────────────────────────────
    const { supabase } = await import('@/lib/supabase');
    const sb = await supabase();
    const { data: { user } } = await sb.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── 쿼리 파라미터 ────────────────────────────────────────
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);
    const typeFilter = searchParams.get('type'); // 'EARNED' | 'USED' | 'EXPIRED' | 'CLAWBACK' | null

    // ── 쿼리 빌드 ────────────────────────────────────────────
    let query = supabaseAdmin
      .from('mileage_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (typeFilter && ['EARNED', 'USED', 'EXPIRED', 'CLAWBACK'].includes(typeFilter)) {
      query = query.eq('type', typeFilter);
    }

    const { data, count } = await query;

    const transactions = (data ?? []) as Array<{
      id: string;
      amount: number;
      type: 'EARNED' | 'USED' | 'EXPIRED' | 'CLAWBACK';
      memo: string | null;
      base_net_profit: number;
      mileage_rate: number;
      created_at: string;
      expires_at: string | null;
    }>;

    return NextResponse.json({
      transactions,
      hasMore: count !== null ? offset + limit < count : transactions.length >= limit,
      total: count,
    });
  } catch (error) {
    console.error('[MileageHistory] 오류:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
