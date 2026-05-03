import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';
import {
  parseBasis,
  bookingMonthByBasis,
  bookingPassesBasis,
  getBasisMeta,
  generateMonthKeys,
  type KPIBasis,
} from '@/lib/kpi-basis';

/**
 * 어필리에이트 분석 — dual-basis 지원 (2026-04-28 확장).
 *
 * ?basis=commission (default): 예약 생성일 기준, 취소 포함 (어필리에이트 정산 정책)
 * ?basis=accounting:           출발일 기준, 취소 제외 (IFRS 15 / ASC 606 회계)
 *
 * 두 산식은 src/lib/kpi-basis.ts의 단일 정의를 공유. 산식 변경 시 그 한 곳만 수정.
 */
export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) return NextResponse.json({ stats: null });

  const basis: KPIBasis = parseBasis(request.nextUrl.searchParams.get('basis'));
  const basisMeta = getBasisMeta(basis);

  try {
    // 1. 어필리에이트별 링크 통계
    const { data: affiliates } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, referral_code, grade, bonus_rate, commission_rate, booking_count, total_commission, is_active')
      .order('total_commission', { ascending: false }) as any;

    // 2. 링크 통계 (클릭/전환) — basis 무관
    const { data: links } = await supabaseAdmin
      .from('influencer_links')
      .select('affiliate_id, click_count, conversion_count') as any;

    // 3. 어필리에이트 예약 — basis 필터 적용을 위해 created_at + departure_date + status 모두 select
    const { data: bookings } = await supabaseAdmin
      .from('bookings')
      .select('affiliate_id, adult_count, adult_price, child_count, child_price, influencer_commission, created_at, departure_date, status')
      .not('affiliate_id', 'is', null)
      .or('is_deleted.is.null,is_deleted.eq.false') as any;

    // 파트너별 집계
    const linkMap = new Map<string, { clicks: number; conversions: number }>();
    (links || []).forEach((l: any) => {
      const prev = linkMap.get(l.affiliate_id) || { clicks: 0, conversions: 0 };
      linkMap.set(l.affiliate_id, {
        clicks: prev.clicks + (l.click_count || 0),
        conversions: prev.conversions + (l.conversion_count || 0),
      });
    });

    // basis 필터 적용한 예약만 집계 (취소건 등)
    const filteredBookings = (bookings || []).filter((b: any) => bookingPassesBasis(b, basis));

    const bookingMap = new Map<string, { revenue: number; commission: number; count: number }>();
    filteredBookings.forEach((b: any) => {
      const prev = bookingMap.get(b.affiliate_id) || { revenue: 0, commission: 0, count: 0 };
      const revenue = (b.adult_count || 0) * (b.adult_price || 0) + (b.child_count || 0) * (b.child_price || 0);
      bookingMap.set(b.affiliate_id, {
        revenue: prev.revenue + revenue,
        commission: prev.commission + (b.influencer_commission || 0),
        count: prev.count + 1,
      });
    });

    // 월별 추세 — basis가 결정한 dateField 사용
    const monthlyMap = new Map<string, { revenue: number; commission: number; count: number }>();
    filteredBookings.forEach((b: any) => {
      const month = bookingMonthByBasis(b, basis);
      if (!month) return;
      const prev = monthlyMap.get(month) || { revenue: 0, commission: 0, count: 0 };
      const revenue = (b.adult_count || 0) * (b.adult_price || 0) + (b.child_count || 0) * (b.child_price || 0);
      monthlyMap.set(month, {
        revenue: prev.revenue + revenue,
        commission: prev.commission + (b.influencer_commission || 0),
        count: prev.count + 1,
      });
    });

    // 전체 KPI
    let totalClicks = 0, totalConversions = 0, totalRevenue = 0, totalCommission = 0;
    linkMap.forEach(v => { totalClicks += v.clicks; totalConversions += v.conversions; });
    bookingMap.forEach(v => { totalRevenue += v.revenue; totalCommission += v.commission; });

    // 파트너별 데이터
    const partners = (affiliates || []).map((a: any) => {
      const linkStats = linkMap.get(a.id) || { clicks: 0, conversions: 0 };
      const bookingStats = bookingMap.get(a.id) || { revenue: 0, commission: 0, count: 0 };
      return {
        id: a.id,
        name: a.name,
        referral_code: a.referral_code,
        grade: a.grade,
        is_active: a.is_active,
        commission_rate: a.commission_rate,
        clicks: linkStats.clicks,
        conversions: linkStats.conversions,
        conversion_rate: linkStats.clicks > 0 ? Math.round((linkStats.conversions / linkStats.clicks) * 1000) / 10 : 0,
        revenue: bookingStats.revenue,
        commission: bookingStats.commission,
        booking_count: bookingStats.count,
        avg_commission: bookingStats.count > 0 ? Math.round(bookingStats.commission / bookingStats.count) : 0,
      };
    });

    // 월별 데이터 — 최근 6개월 윈도우, 빈 달은 0으로 채움
    const windowKeys = generateMonthKeys(6);
    const monthly = windowKeys.map(month => ({
      month,
      ...(monthlyMap.get(month) || { revenue: 0, commission: 0, count: 0 }),
    }));

    // 최근 30일 sub_id 성과 (top 20) — 일 집계 테이블 우선 사용
    const sinceDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    let subStats: Array<{
      referral_code: string;
      sub_id: string;
      clicks_30d: number;
      unique_sessions_30d: number;
      touched_packages_30d: number;
    }> = [];
    const { data: subDaily, error: subErr } = await supabaseAdmin
      .from('affiliate_sub_attribution_daily')
      .select('day, referral_code, sub_id, clicks, unique_sessions, touched_packages')
      .gte('day', sinceDate)
      .limit(20000);
    const subTrendMap = new Map<string, { clicks: number; unique_sessions: number; touched_packages: number }>();
    if (!subErr && subDaily && subDaily.length > 0) {
      const roll = new Map<string, { referral_code: string; sub_id: string; clicks: number; unique_sessions: number; touched_packages: number }>();
      subDaily.forEach((r: any) => {
        const referralCode = String(r.referral_code || '').trim();
        const subId = String(r.sub_id || 'default').trim() || 'default';
        if (!referralCode) return;
        const key = `${referralCode}::${subId}`;
        const prev = roll.get(key) || { referral_code: referralCode, sub_id: subId, clicks: 0, unique_sessions: 0, touched_packages: 0 };
        prev.clicks += Number(r.clicks) || 0;
        prev.unique_sessions += Number(r.unique_sessions) || 0;
        prev.touched_packages += Number(r.touched_packages) || 0;
        roll.set(key, prev);

        const dayKey = String(r.day || '').slice(0, 10);
        if (dayKey) {
          const dayPrev = subTrendMap.get(dayKey) || { clicks: 0, unique_sessions: 0, touched_packages: 0 };
          dayPrev.clicks += Number(r.clicks) || 0;
          dayPrev.unique_sessions += Number(r.unique_sessions) || 0;
          dayPrev.touched_packages += Number(r.touched_packages) || 0;
          subTrendMap.set(dayKey, dayPrev);
        }
      });
      subStats = [...roll.values()]
        .map((s) => ({
          referral_code: s.referral_code,
          sub_id: s.sub_id,
          clicks_30d: s.clicks,
          unique_sessions_30d: s.unique_sessions,
          touched_packages_30d: s.touched_packages,
        }))
        .sort((a, b) => b.clicks_30d - a.clicks_30d)
        .slice(0, 20);
    } else {
      const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: touchpoints } = await supabaseAdmin
        .from('affiliate_touchpoints')
        .select('referral_code, sub_id, session_id, package_id')
        .gte('clicked_at', since30)
        .eq('is_bot', false)
        .eq('is_duplicate', false)
        .limit(10000);
      const subMap = new Map<string, { referral_code: string; sub_id: string; clicks: number; sessions: Set<string>; packages: Set<string> }>();
      (touchpoints || []).forEach((t: any) => {
        const referralCode = String(t.referral_code || '').trim();
        if (!referralCode) return;
        const subId = String(t.sub_id || 'default').trim() || 'default';
        const key = `${referralCode}::${subId}`;
        if (!subMap.has(key)) {
          subMap.set(key, { referral_code: referralCode, sub_id: subId, clicks: 0, sessions: new Set<string>(), packages: new Set<string>() });
        }
        const cur = subMap.get(key)!;
        cur.clicks += 1;
        if (t.session_id) cur.sessions.add(String(t.session_id));
        if (t.package_id) cur.packages.add(String(t.package_id));
      });
      subStats = [...subMap.values()]
        .map((s) => ({
          referral_code: s.referral_code,
          sub_id: s.sub_id,
          clicks_30d: s.clicks,
          unique_sessions_30d: s.sessions.size,
          touched_packages_30d: s.packages.size,
        }))
        .sort((a, b) => b.clicks_30d - a.clicks_30d)
        .slice(0, 20);
      // fallback 실시간 조회에서는 trend를 간소화(미제공)
    }
    const subTrend = [...subTrendMap.entries()]
      .map(([day, v]) => ({ day, clicks: v.clicks, unique_sessions: v.unique_sessions, touched_packages: v.touched_packages }))
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-30);

    // 모델별 비교(최근 30일) — 일집계 캐시 우선, 없으면 경량 fallback
    const compareSinceDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const { data: modelDaily } = await supabaseAdmin
      .from('affiliate_model_compare_daily')
      .select('sample_size, first_touch_match_count, last_touch_match_count, linear_multi_touch_candidates, attribution_switch_count, affected_commission_pool_krw')
      .gte('day', compareSinceDate)
      .limit(60);

    const modelCompare = {
      sample_size: 0,
      first_touch_match_count: 0,
      last_touch_match_count: 0,
      linear_multi_touch_candidates: 0,
      attribution_switch_count: 0,
      affected_commission_pool_krw: 0,
    };
    if (modelDaily && modelDaily.length > 0) {
      for (const r of modelDaily as any[]) {
        modelCompare.sample_size += Number(r.sample_size) || 0;
        modelCompare.first_touch_match_count += Number(r.first_touch_match_count) || 0;
        modelCompare.last_touch_match_count += Number(r.last_touch_match_count) || 0;
        modelCompare.linear_multi_touch_candidates += Number(r.linear_multi_touch_candidates) || 0;
        modelCompare.attribution_switch_count += Number(r.attribution_switch_count) || 0;
        modelCompare.affected_commission_pool_krw += Number(r.affected_commission_pool_krw) || 0;
      }
      modelCompare.affected_commission_pool_krw = Math.round(modelCompare.affected_commission_pool_krw);
    } else {
      const compareSince = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: cmpBookings } = await supabaseAdmin
        .from('bookings')
        .select('id, created_at, affiliate_id, influencer_commission')
        .gte('created_at', compareSince)
        .or('is_deleted.is.null,is_deleted.eq.false')
        .limit(120);
      modelCompare.sample_size = (cmpBookings || []).length;
      modelCompare.affected_commission_pool_krw = Math.round(
        (cmpBookings || []).reduce((s: number, b: any) => s + (Number(b.influencer_commission) || 0), 0),
      );
    }

    // 크론 헬스(최근 7일): 성공/실패 로그 기반 성공률 + 마지막 실패
    const cronNames = [
      'affiliate-dormant',
      'affiliate-anomaly-detect',
      'affiliate-settlement-draft',
      'affiliate-content-24h-report',
      'affiliate-attribution-recalc',
      'affiliate-sub-daily-rollup',
      'affiliate-model-compare-rollup',
      'affiliate-tier-rewards',
      'affiliate-reactivation-campaign',
      'affiliate-live-celebration',
      'affiliate-lifetime-commission',
    ];
    const healthSince = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: cronLogs } = await supabaseAdmin
      .from('audit_logs')
      .select('action, target_id, created_at, description, after_value')
      .in('action', ['AFFILIATE_CRON_SUCCEEDED', 'AFFILIATE_CRON_FAILED'])
      .gte('created_at', healthSince)
      .in('target_id', cronNames)
      .order('created_at', { ascending: false })
      .limit(1000);
    const cronMap = new Map<string, { success: number; failure: number; last_failure_at: string | null; last_failure_message: string | null }>();
    cronNames.forEach((name) => {
      cronMap.set(name, { success: 0, failure: 0, last_failure_at: null, last_failure_message: null });
    });
    (cronLogs || []).forEach((log: any) => {
      const key = String(log.target_id || '').trim();
      if (!cronMap.has(key)) return;
      const cur = cronMap.get(key)!;
      if (log.action === 'AFFILIATE_CRON_SUCCEEDED') {
        cur.success += 1;
        return;
      }
      if (log.action === 'AFFILIATE_CRON_FAILED') {
        cur.failure += 1;
        if (!cur.last_failure_at) {
          cur.last_failure_at = String(log.created_at || '');
          const msg = (log?.after_value as { message?: string } | null)?.message;
          cur.last_failure_message = String(msg || log.description || '실패');
        }
      }
    });
    const cronHealth = cronNames.map((name) => {
      const v = cronMap.get(name)!;
      const total = v.success + v.failure;
      const success_rate = total > 0 ? Math.round((v.success / total) * 1000) / 10 : 100;
      return {
        cron: name,
        success_count_7d: v.success,
        failure_count_7d: v.failure,
        success_rate_7d: success_rate,
        last_failure_at: v.last_failure_at,
        last_failure_message: v.last_failure_message,
      };
    });

    return NextResponse.json({
      basis,
      basisMeta: {
        id: basisMeta.id,
        label: basisMeta.label,
        shortLabel: basisMeta.shortLabel,
        description: basisMeta.description,
      },
      kpi: {
        totalClicks,
        totalConversions,
        conversionRate: totalClicks > 0 ? Math.round((totalConversions / totalClicks) * 1000) / 10 : 0,
        totalRevenue,
        totalCommission,
        partnerCount: (affiliates || []).length,
        activeCount: (affiliates || []).filter((a: any) => a.is_active).length,
      },
      partners,
      monthly,
      sub_stats: subStats,
      sub_trend: subTrend,
      model_compare: modelCompare,
      cron_health: cronHealth,
    });
  } catch (err) {
    console.error('[Affiliate Analytics]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}
