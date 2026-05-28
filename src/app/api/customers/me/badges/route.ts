/**
 * 내 뱃지 목록 조회 API
 *
 * GET /api/customers/me/badges
 *   → { badges: CustomerBadge[] }
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCustomerBadges } from '@/lib/gamification-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { supabase } = await import('@/lib/supabase');
    const sb = await supabase();
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
