/**
 * @file auto-mobile-qa.ts
 * @description 등록 직후 모바일 페이지를 fetch → HTML 검증 → ai_quality_log 적재.
 *
 * 박제 사유 (2026-05-13): 푸꾸옥 등록 사고에서 V2 confidence 0.905 라 보고됐지만
 * 모바일 페이지에 노출된 결함(투어비 9%, notices 빈 화면)이 실제로는 78%.
 * → 실제 렌더 결과를 자동 점검해서 V2 산식과의 gap 을 잡아야 함.
 *
 * 동작:
 *   1. ISR revalidate 호출 (페이지 캐시 무효화)
 *   2. 페이지 fetch (HTML)
 *   3. 정규식 검사: leak 패턴 + 누락 검사
 *   4. ai_quality_log.failed_checks 에 추가 누락 적재
 *
 * fail-soft: 모든 단계 catch → 로깅만, 등록 자체엔 영향 없음.
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { LEAK_PATTERNS } from '@/lib/customer-leak-sanitizer';
import { isCustomerVisibleStatus } from '@/lib/visibility-status';
import { getSecret } from '@/lib/secret-registry';

interface QAIncident {
  id: string;
  severity: 'critical' | 'high' | 'medium';
  message: string;
}

type ItineraryDay = {
  hotel?: { name?: string | null } | null;
};

type ExpectedRender = {
  title: string | null;
  hotelNames: string[];
  hasOptionalTours: boolean;
  status: string | null;
  shortCode: string | null;
  internalCode: string | null;
};

const AUTO_QA_CHECK_PREFIXES = [
  'mobile_',
  'lp_',
  'mobile_attraction_',
];

function isAutoQACheck(check: unknown): boolean {
  const id = typeof check === 'object' && check !== null && 'id' in check
    ? String((check as { id?: unknown }).id ?? '')
    : '';
  return AUTO_QA_CHECK_PREFIXES.some(prefix => id.startsWith(prefix));
}

async function loadExpectedRender(packageId: string): Promise<ExpectedRender> {
  try {
    const { data } = await supabaseAdmin
      .from('travel_packages')
      .select('title, display_title, itinerary_data, optional_tours, status, short_code, internal_code')
      .eq('id', packageId)
      .maybeSingle();
    if (!data) {
      return { title: null, hotelNames: [], hasOptionalTours: false, status: null, shortCode: null, internalCode: null };
    }

    const title = (data as { display_title?: string | null; title?: string | null }).display_title
      || (data as { title?: string | null }).title
      || null;

    const days: ItineraryDay[] = Array.isArray((data as { itinerary_data?: { days?: ItineraryDay[] } }).itinerary_data?.days)
      ? ((data as { itinerary_data: { days: ItineraryDay[] } }).itinerary_data.days)
      : [];
    // 마지막 날은 hotel.name null 정상 (귀국일). 0..N-2 만 검사 대상.
    const hotelNames = days
      .slice(0, Math.max(0, days.length - 1))
      .map(d => (d?.hotel?.name ?? '').trim())
      .filter(n => n.length >= 2);

    const tours = (data as { optional_tours?: unknown[] }).optional_tours;
    const hasOptionalTours = Array.isArray(tours) && tours.length > 0;

    return {
      title,
      hotelNames,
      hasOptionalTours,
      status: (data as { status?: string | null }).status ?? null,
      shortCode: (data as { short_code?: string | null }).short_code ?? null,
      internalCode: (data as { internal_code?: string | null }).internal_code ?? null,
    };
  } catch {
    return { title: null, hotelNames: [], hasOptionalTours: false, status: null, shortCode: null, internalCode: null };
  }
}

function extractCoreTitleTokens(title: string): string[] {
  // "★스팟특가★ 부산出 보홀 PKG 5/6일 [제주항공]" → ["보홀", "제주항공"] 같은 핵심 명사.
  // 한국어 명사 길이 2자 이상 / 영문 3자 이상 토큰만.
  const clean = title.replace(/[★☆▶◆●○※\[\]()\/\-_,．.·]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = clean.split(' ').filter(t => {
    if (/^\d+/.test(t)) return false;                       // "5/6일" 같은 숫자 토큰 제외
    if (/^[가-힣]{2,}$/.test(t)) return true;
    if (/^[A-Za-z]{3,}$/.test(t)) return true;
    return false;
  });
  // 너무 일반적 단어 제거
  const stopwords = new Set(['일정표', 'PKG', 'pkg', '특가', '스팟', '여행', '패키지', '상품']);
  return tokens.filter(t => !stopwords.has(t)).slice(0, 4);
}

function buildRevalidatePaths(packageId: string, shortCode?: string | null): string[] {
  const paths = [`/packages/${packageId}`, `/m/packages/${packageId}`, `/lp/${packageId}`];
  if (shortCode && shortCode !== packageId) paths.push(`/lp/${shortCode}`);
  return paths;
}

function analyzeMobileHtml(
  html: string,
  expected: ExpectedRender,
  surface: 'packages' | 'lp',
): QAIncident[] {
  const prefix = surface === 'lp' ? 'lp_' : 'mobile_';
  const incidents: QAIncident[] = [];

  for (const rule of LEAK_PATTERNS) {
    const match = html.match(rule.pattern);
    if (match && match.length > 0) {
      incidents.push({
        id: `${prefix}leak_${rule.id}`,
        severity: rule.severity,
        message: `[${surface}] HTML leak (${rule.description}): "${match[0]}"`,
      });
    }
  }

  const hasNoticesSection = /유의사항|중요\s*공지|결제\s*조건|현장\s*규정/.test(html);
  const bulletCount = (html.match(/[•▶]\s/g) ?? []).length;
  if (hasNoticesSection && bulletCount < 3) {
    incidents.push({
      id: `${prefix}notices_empty`,
      severity: 'high',
      message: `[${surface}] 유의사항 섹션 비어 보임 (불렛 ${bulletCount}개)`,
    });
  }

  const hasFlightCard = /가는편|오는편/.test(html);
  if (!hasFlightCard) {
    incidents.push({
      id: `${prefix}flight_card_missing`,
      severity: 'high',
      message: `[${surface}] 항공편 카드 (가는편/오는편) 누락`,
    });
  } else {
    const flightTimes = html.match(/\b\d{1,2}:\d{2}\b/g) ?? [];
    if (flightTimes.length < 2) {
      incidents.push({
        id: `${prefix}flight_time_merged`,
        severity: 'high',
        message: `[${surface}] 항공편 출/도 시간 분리 안됨 (시간 토큰 ${flightTimes.length}개)`,
      });
    }
  }

  if (expected.title) {
    const tokens = extractCoreTitleTokens(expected.title);
    const missing = tokens.filter(t => !html.includes(t));
    if (tokens.length > 0 && missing.length === tokens.length) {
      incidents.push({
        id: `${prefix}hero_title_missing`,
        severity: 'critical',
        message: `[${surface}] hero 제목 핵심 토큰 모두 누락 (expected: ${tokens.join('·')})`,
      });
    } else if (missing.length > tokens.length / 2 && tokens.length >= 2) {
      incidents.push({
        id: `${prefix}hero_title_partial`,
        severity: 'medium',
        message: `[${surface}] hero 제목 일부 누락 (missing: ${missing.join('·')})`,
      });
    }
  }

  if (expected.hotelNames.length > 0) {
    const missingHotels = expected.hotelNames.filter(h => !html.includes(h));
    if (missingHotels.length === expected.hotelNames.length) {
      incidents.push({
        id: `${prefix}hotel_all_missing`,
        severity: 'critical',
        message: `[${surface}] 모든 호텔명 렌더 누락 (${expected.hotelNames.length}개)`,
      });
    } else if (missingHotels.length > 0) {
      incidents.push({
        id: `${prefix}hotel_partial_missing`,
        severity: 'high',
        message: `[${surface}] 호텔명 일부 누락: ${missingHotels.slice(0, 3).join(', ')}${missingHotels.length > 3 ? ' …' : ''}`,
      });
    }
  }

  if (expected.hasOptionalTours && !/선택\s*관광|Optional|옵션\s*투어/.test(html)) {
    incidents.push({
      id: `${prefix}optional_tours_missing`,
      severity: 'high',
      message: `[${surface}] optional_tours DB 에 있으나 섹션 미렌더`,
    });
  }

  return incidents;
}

async function fetchSurfaceHtml(pageUrl: string): Promise<string | null> {
  const res = await fetch(pageUrl, { headers: { 'User-Agent': 'YeosonamAutoQA/1.0' } });
  if (!res.ok) return null;
  return res.text();
}

export async function runAutoMobileQA(packageId: string, baseUrl?: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const url = baseUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeosonam.com';

  try {
    const expected = await loadExpectedRender(packageId);
    if (!isCustomerVisibleStatus(expected.status)) {
      console.log(`[AutoQA] ${packageId}: status=${expected.status ?? 'null'} — 고객 비노출, QA skip`);
      return;
    }

    const revalidatePaths = buildRevalidatePaths(packageId, expected.shortCode);

    const secret = getSecret('REVALIDATE_SECRET');
    if (secret) {
      void fetch(`${url}/api/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: revalidatePaths, secret }),
      }).catch((e) =>
        console.warn(`[AutoQA] revalidate fetch failed for ${packageId}:`, e?.message ?? e),
      );
    }

    await new Promise(r => setTimeout(r, 3000));

    const surfaces: Array<{ surface: 'packages' | 'lp'; pageUrl: string }> = [
      { surface: 'packages', pageUrl: `${url}/packages/${packageId}` },
      { surface: 'lp', pageUrl: `${url}/lp/${packageId}` },
    ];

    const incidents: QAIncident[] = [];
    for (const { surface, pageUrl } of surfaces) {
      const html = await fetchSurfaceHtml(pageUrl);
      if (!html) {
        console.warn(`[AutoQA] ${packageId}: ${surface} fetch fail`);
        continue;
      }
      incidents.push(...analyzeMobileHtml(html, expected, surface));
    }

    // G5 박제 (2026-05-15): 관광지 매칭률 검증 + admin_alerts 자동 적재
    //   ai_quality_log 의 attraction_matched_count / attraction_unmatched_count 로 비율 계산
    //   < 60% 면 admin_alerts 적재 + critical 시 Slack. 사장님이 모바일 안 봐도 자동 알림.
    let matchRate = 1;
    let matchedCount = 0;
    let unmatchedCount = 0;
    try {
      const { data: ql } = await supabaseAdmin
        .from('ai_quality_log')
        .select('attraction_matched_count, attraction_unmatched_count')
        .eq('package_id', packageId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ql) {
        matchedCount = ((ql as { attraction_matched_count?: number }).attraction_matched_count ?? 0);
        unmatchedCount = ((ql as { attraction_unmatched_count?: number }).attraction_unmatched_count ?? 0);
        const denom = matchedCount + unmatchedCount;
        matchRate = denom > 0 ? matchedCount / denom : 1;
        if (denom >= 3 && matchRate < 0.6) {
          incidents.push({
            id: 'mobile_attraction_match_low',
            severity: 'high',
            message: `관광지 매칭률 ${(matchRate * 100).toFixed(0)}% (${matchedCount}/${denom}) — 60% 미달, attraction 시드 / aliases 점검 필요`,
          });
        }
      }
    } catch { /* swallow — ai_quality_log fetch fail 시 alert skip */ }

    // 4) ai_quality_log 적재. 이전 AutoQA 결과는 현재 HTML 기준으로 대체한다.
    const { data: latestLog } = await supabaseAdmin
      .from('ai_quality_log')
      .select('id, failed_checks')
      .eq('package_id', packageId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestLog?.id) {
      const existing = Array.isArray((latestLog as { failed_checks?: unknown[] }).failed_checks)
        ? ((latestLog as { failed_checks: unknown[] }).failed_checks)
        : [];
      const merged = [
        ...existing.filter(check => !isAutoQACheck(check)),
        ...incidents.map(i => ({ id: i.id, severity: i.severity, passed: false, message: i.message })),
      ];
      await supabaseAdmin
        .from('ai_quality_log')
        .update({ failed_checks: merged })
        .eq('id', latestLog.id);
    }

    if (incidents.length > 0) {
      console.warn(`[AutoQA] ${packageId}: ${incidents.length} mobile incident(s)`);

      // G5: high/critical incident 시 admin_alerts 적재 (사장님 어드민 대시보드 빨간 배지)
      const hiSev = incidents.filter(i => i.severity === 'high' || i.severity === 'critical');
      if (hiSev.length > 0) {
        const checkedAt = new Date().toISOString();
        try {
          await supabaseAdmin
            .from('travel_packages')
            .update({
              status: 'pending_review',
              audit_status: 'blocked',
              audit_checked_at: checkedAt,
              audit_report: {
                source: 'auto_mobile_qa',
                incidents: hiSev,
                checked_at: checkedAt,
              },
              updated_at: checkedAt,
            })
            .eq('id', packageId);

          if (expected.internalCode) {
            await supabaseAdmin
              .from('products')
              .update({ status: 'pending_review', updated_at: checkedAt })
              .eq('internal_code', expected.internalCode);
          }
        } catch (e) {
          console.warn('[AutoQA] failed to block customer-visible package:', e instanceof Error ? e.message : e);
        }

        try {
          const { postAlert } = await import('@/lib/admin-alerts');
          const summary = hiSev.slice(0, 3).map(i => `[${i.severity}] ${i.message}`).join(' / ');
          await postAlert({
            category: 'general',
            severity: hiSev.some(i => i.severity === 'critical') ? 'critical' : 'warning',
            title: `모바일 QA 실패 (${hiSev.length}건)${matchRate < 0.6 && matchedCount + unmatchedCount >= 3 ? ` · 매칭률 ${(matchRate * 100).toFixed(0)}%` : ''}`,
            message: summary,
            ref_type: 'travel_package',
            ref_id: packageId,
            meta: { incidents: hiSev, matched: matchedCount, unmatched: unmatchedCount, matchRate },
            dedupe: true,
          });
        } catch (e) {
          console.warn('[AutoQA] admin_alerts 적재 실패(무시):', e instanceof Error ? e.message : e);
        }
      }
    } else {
      console.log(`[AutoQA] ${packageId}: mobile clean ✓`);
    }
  } catch (e) {
    console.warn('[AutoQA] 실패(무시):', (e as Error).message);
  }
}
