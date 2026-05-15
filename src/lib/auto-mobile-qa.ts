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
};

async function loadExpectedRender(packageId: string): Promise<ExpectedRender> {
  try {
    const { data } = await supabaseAdmin
      .from('travel_packages')
      .select('title, display_title, itinerary_data, optional_tours')
      .eq('id', packageId)
      .maybeSingle();
    if (!data) return { title: null, hotelNames: [], hasOptionalTours: false };

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

    return { title, hotelNames, hasOptionalTours };
  } catch {
    return { title: null, hotelNames: [], hasOptionalTours: false };
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

export async function runAutoMobileQA(packageId: string, baseUrl?: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const url = baseUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeosonam.com';

  try {
    // 1) ISR revalidate
    const secret = process.env.REVALIDATE_SECRET;
    if (secret) {
      void fetch(`${url}/api/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [`/packages/${packageId}`], secret }),
      }).catch(() => {});
    }

    // ISR 빌드 대기
    await new Promise(r => setTimeout(r, 3000));

    // 2) 페이지 fetch
    const pageUrl = `${url}/packages/${packageId}`;
    const res = await fetch(pageUrl, { headers: { 'User-Agent': 'YeosonamAutoQA/1.0' } });
    if (!res.ok) {
      console.warn(`[AutoQA] ${packageId}: fetch fail ${res.status}`);
      return;
    }
    const html = await res.text();

    // 3) 검증
    const incidents: QAIncident[] = [];

    // 4) DB SSOT 로드 — expected vs actual 대조용
    const expected = await loadExpectedRender(packageId);

    // leak 패턴 (sanitizer set 재사용)
    for (const rule of LEAK_PATTERNS) {
      const match = html.match(rule.pattern);
      if (match && match.length > 0) {
        incidents.push({
          id: `mobile_leak_${rule.id}`,
          severity: rule.severity,
          message: `모바일 HTML 에 leak 노출 (${rule.description}): "${match[0]}"`,
        });
      }
    }

    // notices 섹션 비어있는지
    const hasNoticesSection = /유의사항|중요\s*공지|결제\s*조건|현장\s*규정/.test(html);
    const bulletCount = (html.match(/[•▶]\s/g) ?? []).length;
    if (hasNoticesSection && bulletCount < 3) {
      incidents.push({
        id: 'mobile_notices_empty',
        severity: 'high',
        message: `유의사항 섹션 비어 보임 (불렛 ${bulletCount}개)`,
      });
    }

    // 항공편 카드 존재 여부 (가는편/오는편 텍스트)
    const hasFlightCard = /가는편|오는편/.test(html);
    if (!hasFlightCard) {
      incidents.push({
        id: 'mobile_flight_card_missing',
        severity: 'high',
        message: '항공편 카드 (가는편/오는편) 누락',
      });
    } else {
      // 항공편 시간 분리 — 카드 영역에 \d{2}:\d{2} 패턴이 2회 이상 (출발/도착)
      // "→" 한 토큰으로 병합된 레거시 표기는 시간이 1회만 나옴 → 깨진 카드 감지.
      const flightTimes = html.match(/\b\d{1,2}:\d{2}\b/g) ?? [];
      if (flightTimes.length < 2) {
        incidents.push({
          id: 'mobile_flight_time_merged',
          severity: 'high',
          message: `항공편 출/도 시간 분리 안됨 (시간 토큰 ${flightTimes.length}개) — flight_segments 정규화 필요`,
        });
      }
    }

    // hero 제목 핵심 토큰 노출 — display_title/title 의 핵심 명사가 페이지에 등장하는지
    if (expected.title) {
      const tokens = extractCoreTitleTokens(expected.title);
      const missing = tokens.filter(t => !html.includes(t));
      if (tokens.length > 0 && missing.length === tokens.length) {
        // 모든 핵심 토큰 누락 — hero 영역이 비어있거나 다른 상품 렌더 가능성
        incidents.push({
          id: 'mobile_hero_title_missing',
          severity: 'critical',
          message: `hero 제목 핵심 토큰 모두 누락 (expected: ${tokens.join('·')})`,
        });
      } else if (missing.length > tokens.length / 2 && tokens.length >= 2) {
        incidents.push({
          id: 'mobile_hero_title_partial',
          severity: 'medium',
          message: `hero 제목 일부 누락 (missing: ${missing.join('·')})`,
        });
      }
    }

    // 호텔명 노출 — 마지막날 제외한 호텔이 모두 HTML 에 나오는지
    if (expected.hotelNames.length > 0) {
      const missingHotels = expected.hotelNames.filter(h => !html.includes(h));
      if (missingHotels.length === expected.hotelNames.length) {
        incidents.push({
          id: 'mobile_hotel_all_missing',
          severity: 'critical',
          message: `모든 호텔명 렌더 누락 (${expected.hotelNames.length}개) — hotel.name SSOT 미반영`,
        });
      } else if (missingHotels.length > 0) {
        incidents.push({
          id: 'mobile_hotel_partial_missing',
          severity: 'high',
          message: `호텔명 일부 누락: ${missingHotels.slice(0, 3).join(', ')}${missingHotels.length > 3 ? ' …' : ''}`,
        });
      }
    }

    // 선택관광 섹션 노출 — DB 에 있는데 페이지에 섹션 헤더 없으면 렌더 누락
    if (expected.hasOptionalTours && !/선택\s*관광|Optional|옵션\s*투어/.test(html)) {
      incidents.push({
        id: 'mobile_optional_tours_missing',
        severity: 'high',
        message: 'optional_tours DB 에 있으나 모바일 섹션 미렌더',
      });
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

    // 4) ai_quality_log 적재
    if (incidents.length > 0) {
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
          ...existing,
          ...incidents.map(i => ({ id: i.id, severity: i.severity, passed: false, message: i.message })),
        ];
        await supabaseAdmin
          .from('ai_quality_log')
          .update({ failed_checks: merged })
          .eq('id', latestLog.id);
      }
      console.warn(`[AutoQA] ${packageId}: ${incidents.length} mobile incident(s)`);

      // G5: high/critical incident 시 admin_alerts 적재 (사장님 어드민 대시보드 빨간 배지)
      const hiSev = incidents.filter(i => i.severity === 'high' || i.severity === 'critical');
      if (hiSev.length > 0) {
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
