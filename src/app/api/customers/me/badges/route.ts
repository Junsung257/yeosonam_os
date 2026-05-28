/**
 * 내 뱃지 목록 조회 API
 *
 * GET /api/customers/me/badges
 *   → { badges: CustomerBadge[] }
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, getSupabase } from '@/lib/supabase';
import { getCustomerBadges } from '@/lib/gamification-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
    const { data: { user } } = await sb.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const badges = await getCustomerBadges(user.id);

    return NextResponse.json({ badges });
  } catch (error) {
    console.error('[Badges] 오류:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
