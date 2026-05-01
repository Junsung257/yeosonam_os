/**
 * GET /r/[code]
 *
 * 자유여행 어필리에이트 클릭 추적 리다이렉터.
 * MRT CSV 파라미터 보존 여부와 무관하게 클릭 데이터를 여소남 DB에 직접 기록.
 *
 * [code] = free_travel_commissions.id (UUID)
 *
 * 흐름:
 *   고객 클릭 → /r/{commissionId}
 *   → DB에 clicked_at, click_count 업데이트
 *   → affiliate_link URL로 302 redirect
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: { code: string } },
) {
  const { code } = params;

  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  try {
    // 커미션 레코드 조회
    const { data, error } = await supabaseAdmin
      .from('free_travel_commissions')
      .select('id, affiliate_link, click_count')
      .eq('id', code)
      .limit(1);

    if (error || !data?.[0] || !data[0].affiliate_link) {
      return NextResponse.redirect(new URL('/', request.url));
    }

    const record = data[0];

    // 클릭 기록: DB 레벨 increment로 race condition 방지 (SELECT→UPDATE 패턴 대신)
    await supabaseAdmin.rpc('increment_commission_click', { p_id: code })
      .then(({ error: rpcErr }: { error: unknown }) => {
        if (rpcErr) {
          // RPC가 없는 환경(로컬)은 단순 UPDATE 폴백
          return supabaseAdmin!
            .from('free_travel_commissions')
            .update({ clicked_at: new Date().toISOString() })
            .eq('id', code);
        }
      })
      .catch(() => { /* 클릭 기록 실패는 redirect 막지 않음 */ });

    return NextResponse.redirect(record.affiliate_link, { status: 302 });
  } catch {
    return NextResponse.redirect(new URL('/', request.url));
  }
}
