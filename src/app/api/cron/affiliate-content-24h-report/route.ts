/**
 * GET /api/cron/affiliate-content-24h-report
 *
 * 어필리에이터 콘텐츠 발행 후 24시간 경과 → 클릭/전환 리포트 자동 푸시 기안.
 *
 * 트리거: 매일 오전 9시 (vercel.json crons 등록 권장).
 *
 * 흐름:
 *   1. 24h 전 ~ 7일 전 발행된 어필리에이터 콘텐츠 조회
 *   2. 각 콘텐츠 → bookings(content_creative_id) 매칭
 *   3. 어필리에이터별 합산 (예약 0건이면 스팸 방지로 스킵)
 *   4. agent_actions 에 send_alimtalk 기안 (사장님 승인 후 발송)
 *
 * 실제 발송은 /admin/jarvis 결재함에서 수동 또는 자동 승인 후 KakaoNotificationAdapter 가 처리.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }
  try {
    const { supabaseAdmin } = await import('@/lib/supabase');

    const now = Date.now();
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: contents, error } = await supabaseAdmin
      .from('content_distributions')
      .select('id, affiliate_id, product_id, platform, status, created_at')
      .not('affiliate_id', 'is', null)
      .lt('created_at', since24h)
      .gt('created_at', since7d)
      .limit(200);

    if (error) throw error;
    if (!contents || contents.length === 0) {
      return NextResponse.json({ ok: true, drafted: 0, reason: '대상 콘텐츠 없음' });
    }

    const contentIds = contents.map((c: { id: string }) => c.id);
    const { data: bookings } = await supabaseAdmin
      .from('bookings')
      .select('content_creative_id, total_price, influencer_commission')
      .in('content_creative_id', contentIds);

    type Row = {
      content_id: string;
      affiliate_id: string;
      platform: string;
      bookings: number;
      revenue: number;
      commission: number;
    };

    const byContent = new Map<string, Row>();
    for (const c of contents as Array<{ id: string; affiliate_id: string; platform: string }>) {
      byContent.set(c.id, {
        content_id: c.id,
        affiliate_id: c.affiliate_id,
        platform: c.platform,
        bookings: 0,
        revenue: 0,
        commission: 0,
      });
    }

    for (const b of (bookings || []) as Array<{
      content_creative_id: string;
      total_price: number;
      influencer_commission: number;
    }>) {
      const row = byContent.get(b.content_creative_id);
      if (!row) continue;
      row.bookings += 1;
      row.revenue += Number(b.total_price) || 0;
      row.commission += Number(b.influencer_commission) || 0;
    }

    // 어필리에이터별 묶기 (전환 0 건 어필리에이터 스킵)
    const byAff = new Map<string, Row[]>();
    for (const r of byContent.values()) {
      if (r.bookings === 0) continue;
      const arr = byAff.get(r.affiliate_id) || [];
      arr.push(r);
      byAff.set(r.affiliate_id, arr);
    }

    const drafted: string[] = [];
    for (const [affiliate_id, rows] of byAff.entries()) {
      const totalBookings = rows.reduce((s: number, r: Record<string, unknown>) => s + Number(r.bookings), 0);
      const totalRevenue = rows.reduce((s: number, r: Record<string, unknown>) => s + Number(r.revenue), 0);
      const totalCommission = rows.reduce((s: number, r: Record<string, unknown>) => s + Number(r.commission), 0);

      const { data: action } = await supabaseAdmin
        .from('agent_actions')
        .insert({
          action_type: 'send_alimtalk',
          status: 'pending',
          priority: 'normal',
          summary: `[24h 리포트] ${rows.length}개 콘텐츠 → 예약 ${totalBookings}건 (${Math.round(totalRevenue / 10000)}만원, 커미션 ${Math.round(totalCommission / 10000)}만원)`,
          payload: {
            affiliate_id,
            template: 'content_24h_report',
            data: { rows, totalBookings, totalRevenue, totalCommission },
          },
        } as never)
        .select('id')
        .single();
      if (action) drafted.push((action as { id: string }).id);
    }

    return NextResponse.json({
      ok: true,
      drafted: drafted.length,
      content_count: contents.length,
      action_ids: drafted,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '실행 실패' },
      { status: 500 },
    );
  }
}
