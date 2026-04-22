/**
 * Dynamic Keyword Insertion (DKI) Resolver
 *
 * 2026 검증된 QS 향상 기법:
 *   광고 클릭 URL 에 utm_term 이 있으면 랜딩페이지 H1/부제를 키워드 매칭형으로 동적 변경.
 *   ad_landing_mappings 에 사전 등록된 (utm_campaign + utm_term) 조합을 조회.
 *
 * 우선순위 (Fallback chain):
 *   1) ad_landing_mappings.dki_headline (수동 설정, 가장 정확)
 *   2) content_creatives.landing_headline (블로그 기본값)
 *   3) utm_term 을 간단 템플릿에 주입
 *   4) 기본 seo_title
 */

import { supabaseAdmin } from './supabase';

export interface DkiContext {
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_source?: string | null;
  content_creative_id: string;
}

export interface DkiResult {
  headline: string;
  subtitle?: string;
  matched: boolean;           // 사전 등록 매핑 히트 여부
  mapping_id?: string | null; // 매핑 ID (클릭 카운트용)
}

/**
 * 서버 사이드 (SSR/서버 컴포넌트) 에서 호출
 * 광고 유입 URL 의 utm 파라미터 기반으로 랜딩 헤드라인 결정
 */
export async function resolveDki(
  ctx: DkiContext,
  fallback: { seo_title: string; landing_headline?: string | null; landing_subtitle?: string | null },
): Promise<DkiResult> {
  // 1) 사전 등록된 매핑 조회
  if (ctx.utm_campaign && ctx.utm_term) {
    const { data } = await supabaseAdmin
      .from('ad_landing_mappings')
      .select('id, dki_headline, dki_subtitle')
      .eq('content_creative_id', ctx.content_creative_id)
      .eq('utm_campaign', ctx.utm_campaign)
      .eq('utm_term', ctx.utm_term)
      .eq('active', true)
      .limit(1);

    const mapping = data?.[0] as { id: string; dki_headline?: string; dki_subtitle?: string } | undefined;
    if (mapping?.dki_headline) {
      // 클릭 카운트 증가 (fire-and-forget)
      supabaseAdmin.rpc('increment_alm_clicks', { p_mapping_id: mapping.id }).then(() => {});
      return {
        headline: mapping.dki_headline,
        subtitle: mapping.dki_subtitle,
        matched: true,
        mapping_id: mapping.id,
      };
    }
  }

  // 2) content_creatives.landing_headline fallback
  if (fallback.landing_headline) {
    return {
      headline: fallback.landing_headline,
      subtitle: fallback.landing_subtitle ?? undefined,
      matched: false,
    };
  }

  // 3) utm_term → 간단 템플릿 (원시적 DKI)
  if (ctx.utm_term) {
    return {
      headline: insertKeywordIntoTitle(fallback.seo_title, ctx.utm_term),
      matched: false,
    };
  }

  // 4) 기본 seo_title
  return {
    headline: fallback.seo_title,
    matched: false,
  };
}

/**
 * 간단한 키워드 삽입 — utm_term 을 제목 앞에 붙여서 키워드 매칭 강화
 * 예: seo_title = "호화호특 4박5일 럭셔리 패키지"
 *     utm_term = "부산_호화호특"
 *     → "부산 호화호특 4박5일 럭셔리 패키지"
 */
function insertKeywordIntoTitle(title: string, utmTerm: string): string {
  const kw = utmTerm.replace(/_/g, ' ').trim();
  if (!kw) return title;

  // 이미 포함되어 있으면 중복 방지
  if (title.toLowerCase().includes(kw.toLowerCase())) return title;

  // 60자 초과 시 자르기 (SEO title 안전)
  const combined = `${kw} ${title}`;
  return combined.length > 60 ? combined.substring(0, 57) + '...' : combined;
}
