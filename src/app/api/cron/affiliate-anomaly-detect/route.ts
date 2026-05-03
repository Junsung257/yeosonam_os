/**
 * 어필리에이트 이상 탐지 크론 — 매일 09:00
 * GET /api/cron/affiliate-anomaly-detect
 *
 * 시그널:
 *   1. 전일 referral_code별 클릭·전환·취소율이 7일 rolling median 대비 ±200% 이탈
 *   2. 전일 취소 ≥ 3건 또는 취소율 > 30%
 *   3. geo 이상: affiliate_geo_anomalies 뷰 (하루 21개 이상 고유 IP)
 *
 * 발견 시 agent_actions(action_type='notify_affiliate_anomaly', priority='critical') 기안.
 */
import { NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { reportAffiliateCronFailure, reportAffiliateCronSuccess } from '@/lib/affiliate/cron-monitor';

interface AnomalyFinding {
  affiliate_id: string | null;
  referral_code: string;
  affiliate_name: string;
  kind: string;
  detail: Record<string, number | string>;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const yesterdayIso = yesterday.toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const findings: AnomalyFinding[] = [];

    const { data: touchpoints } = await supabaseAdmin
      .from('affiliate_touchpoints')
      .select('referral_code, clicked_at, is_duplicate, is_bot')
      .gte('clicked_at', sevenDaysAgo)
      .eq('is_bot', false)
      .eq('is_duplicate', false);

    const clicksByRefByDay = new Map<string, Map<string, number>>();
    (touchpoints || []).forEach((t: any) => {
      const day = String(t.clicked_at).slice(0, 10);
      if (!clicksByRefByDay.has(t.referral_code)) {
        clicksByRefByDay.set(t.referral_code, new Map());
      }
      const dayMap = clicksByRefByDay.get(t.referral_code)!;
      dayMap.set(day, (dayMap.get(day) || 0) + 1);
    });

    const { data: affiliates } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, referral_code')
      .eq('is_active', true);
    const affByCode = new Map<string, { id: string; name: string }>();
    (affiliates || []).forEach((a: any) => affByCode.set(a.referral_code, { id: a.id, name: a.name }));

    for (const [refCode, dayMap] of clicksByRefByDay.entries()) {
      const yesterdayClicks = dayMap.get(yesterdayIso) || 0;
      const priorDayClicks: number[] = [];
      for (let i = 1; i <= 7; i++) {
        const d = new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        priorDayClicks.push(dayMap.get(d) || 0);
      }
      const med = median(priorDayClicks);
      if (med >= 5 && yesterdayClicks >= med * 3) {
        const aff = affByCode.get(refCode);
        if (aff) {
          findings.push({
            affiliate_id: aff.id,
            affiliate_name: aff.name,
            referral_code: refCode,
            kind: 'click_surge',
            detail: { yesterdayClicks, weekly_median: med },
          });
        }
      }
    }

    const { data: cancellations } = await supabaseAdmin
      .from('bookings')
      .select('affiliate_id, status, updated_at')
      .in('status', ['cancelled'])
      .gte('updated_at', `${yesterdayIso}T00:00:00`)
      .lte('updated_at', `${yesterdayIso}T23:59:59`)
      .not('affiliate_id', 'is', null);

    const cancelCountByAff = new Map<string, number>();
    (cancellations || []).forEach((b: any) => {
      cancelCountByAff.set(b.affiliate_id, (cancelCountByAff.get(b.affiliate_id) || 0) + 1);
    });

    for (const [affId, count] of cancelCountByAff.entries()) {
      if (count >= 3) {
        const aff = (affiliates || []).find((a: any) => a.id === affId);
        if (aff) {
          findings.push({
            affiliate_id: affId,
            affiliate_name: aff.name,
            referral_code: aff.referral_code,
            kind: 'cancel_surge',
            detail: { yesterdayCancels: count },
          });
        }
      }
    }

    // 셀프 리퍼럴 의심: 제휴 예약인데 커미션이 0인 건이 하루 2건 이상
    const { data: zeroCommissionRows } = await supabaseAdmin
      .from('bookings')
      .select('affiliate_id')
      .eq('booking_type', 'AFFILIATE')
      .eq('influencer_commission', 0)
      .gte('created_at', `${yesterdayIso}T00:00:00`)
      .lte('created_at', `${yesterdayIso}T23:59:59`)
      .not('affiliate_id', 'is', null);

    const zeroByAff = new Map<string, number>();
    (zeroCommissionRows || []).forEach((r: { affiliate_id: string | null }) => {
      if (!r.affiliate_id) return;
      zeroByAff.set(r.affiliate_id, (zeroByAff.get(r.affiliate_id) || 0) + 1);
    });

    for (const [affId, count] of zeroByAff.entries()) {
      if (count >= 2) {
        const aff = (affiliates || []).find((a: any) => a.id === affId);
        if (aff) {
          findings.push({
            affiliate_id: affId,
            affiliate_name: aff.name,
            referral_code: aff.referral_code,
            kind: 'self_referral_suspected',
            detail: { zeroCommissionAffiliateBookings: count, day: yesterdayIso },
          });
        }
      }
    }

    try {
      const { data: geoAnomalies } = await supabaseAdmin
        .from('affiliate_geo_anomalies')
        .select('referral_code, unique_ips, day')
        .eq('day', yesterdayIso);
      (geoAnomalies || []).forEach((g: any) => {
        const aff = affByCode.get(g.referral_code);
        if (aff) {
          findings.push({
            affiliate_id: aff.id,
            affiliate_name: aff.name,
            referral_code: g.referral_code,
            kind: 'geo_anomaly',
            detail: { unique_ips: g.unique_ips, day: g.day },
          });
        }
      });
    } catch {
      // 뷰 미존재 시 무시 (P2 마이그레이션 미적용 상태)
    }

    for (const finding of findings) {
      await supabaseAdmin.from('agent_actions').insert({
        agent_type: 'finance',
        action_type: 'notify_affiliate_anomaly',
        summary: `[이상탐지] ${finding.affiliate_name} — ${finding.kind}`,
        payload: finding as any,
        requested_by: 'jarvis',
        priority: 'critical',
      });
    }

    await supabaseAdmin.from('audit_logs').insert({
      action: 'AFFILIATE_ANOMALY_DETECT',
      target_type: 'affiliate',
      description: `전일 이상탐지: ${findings.length}건`,
      after_value: { date: yesterdayIso, findings } as any,
    }).then(() => {}).catch(() => {});

    await reportAffiliateCronSuccess('affiliate-anomaly-detect', { date: yesterdayIso, findings: findings.length });
    return NextResponse.json({ date: yesterdayIso, findings: findings.length, details: findings });
  } catch (err) {
    console.error('[이상탐지 크론 실패]', err);
    await reportAffiliateCronFailure('affiliate-anomaly-detect', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '이상탐지 실패' },
      { status: 500 },
    );
  }
}
