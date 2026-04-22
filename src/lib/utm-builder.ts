/**
 * UTM Parameter Builder · Normalizer · Cleaner
 *
 * 2026 업계 표준 준수:
 *  - GA4 case-sensitive 문제 방어 → 모든 값 소문자 정규화
 *  - utm_source/medium/campaign 필수, utm_term/content 선택
 *  - 내부 링크 UTM 제거 (세션 덮어쓰기 방지)
 *  - Google Ads auto-tagging (gclid) 우선 정책 — UTM 은 백업
 *
 * 표준 소스 맵핑:
 *   naver   → naver_search / naver_blog / naver_display
 *   google  → google_search / google_display / youtube
 *   meta    → facebook / instagram
 *   kakao   → kakao_moment / kakao_channel
 */

export interface UtmParams {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term?: string;
  utm_content?: string;
}

export interface BuildUtmInput {
  base_url: string;
  platform: 'naver' | 'google' | 'meta' | 'kakao';
  campaign_slug: string;       // 예: 'danang-luxury-q2-2026'
  keyword?: string;            // 실제 광고 키워드 (utm_term 원본)
  medium?: 'cpc' | 'display' | 'cpv' | 'referral' | 'social' | 'email';
  creative_variant?: string;   // A/B 테스트 variant 식별자 → utm_content
}

/** 모든 UTM 값을 GA4 안전 포맷으로 정규화: 소문자 + 공백→언더스코어 + 특수문자 제거 */
export function normalizeUtmValue(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\-가-힣]/g, '')   // 한글 키워드 허용 (utm_term 용)
    .substring(0, 100);
}

/** 블로그용 UTM 파라미터 생성 */
export function buildUtm(input: BuildUtmInput): UtmParams {
  const medium = input.medium ?? (input.platform === 'meta' ? 'social' : 'cpc');

  // 플랫폼별 source 세분화 (네이버 검색 vs 블로그 vs 디스플레이)
  const platformSource: Record<string, string> = {
    naver: 'naver',
    google: 'google',
    meta: medium === 'social' ? 'facebook' : 'meta',
    kakao: 'kakao',
  };

  return {
    utm_source: normalizeUtmValue(platformSource[input.platform]) || input.platform,
    utm_medium: normalizeUtmValue(medium) || 'cpc',
    utm_campaign: normalizeUtmValue(input.campaign_slug) || 'default',
    utm_term: input.keyword ? normalizeUtmValue(input.keyword) : undefined,
    utm_content: input.creative_variant ? normalizeUtmValue(input.creative_variant) : undefined,
  };
}

/** UTM 파라미터를 URL에 안전하게 붙임 (기존 쿼리 존중) */
export function applyUtmToUrl(baseUrl: string, utm: UtmParams): string {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('utm_source', utm.utm_source);
    url.searchParams.set('utm_medium', utm.utm_medium);
    url.searchParams.set('utm_campaign', utm.utm_campaign);
    if (utm.utm_term) url.searchParams.set('utm_term', utm.utm_term);
    if (utm.utm_content) url.searchParams.set('utm_content', utm.utm_content);
    return url.toString();
  } catch {
    // URL 파싱 실패 시 query string 직접 append
    const q = new URLSearchParams();
    q.set('utm_source', utm.utm_source);
    q.set('utm_medium', utm.utm_medium);
    q.set('utm_campaign', utm.utm_campaign);
    if (utm.utm_term) q.set('utm_term', utm.utm_term);
    if (utm.utm_content) q.set('utm_content', utm.utm_content);
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}${q.toString()}`;
  }
}

/** 내부 링크(같은 도메인)면 UTM 제거 — GA4 세션 유지 */
export function stripUtmIfInternal(url: string, currentHost: string): string {
  try {
    const u = new URL(url);
    if (u.host === currentHost) {
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(p => u.searchParams.delete(p));
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/** URL 에서 UTM 만 추출 (tracker.ts에서 활용) */
export function parseUtmFromUrl(url: string): Partial<UtmParams> {
  try {
    const u = new URL(url);
    const out: Partial<UtmParams> = {};
    const src = u.searchParams.get('utm_source');
    const med = u.searchParams.get('utm_medium');
    const cmp = u.searchParams.get('utm_campaign');
    const trm = u.searchParams.get('utm_term');
    const cnt = u.searchParams.get('utm_content');
    if (src) out.utm_source = src;
    if (med) out.utm_medium = med;
    if (cmp) out.utm_campaign = cmp;
    if (trm) out.utm_term = trm;
    if (cnt) out.utm_content = cnt;
    return out;
  } catch {
    return {};
  }
}

/** 일관성 검증 — 케이스 불일치 경고 (어드민 UI 에서 사용) */
export function validateUtmConsistency(utms: UtmParams[]): string[] {
  const warnings: string[] = [];
  const sources = new Set(utms.map(u => u.utm_source));
  const sourcesLower = new Set(utms.map(u => u.utm_source.toLowerCase()));

  if (sources.size > sourcesLower.size) {
    warnings.push('⚠️ utm_source 대소문자 혼용 발견 — GA4에서 별개로 카운트됨. 전부 소문자로 통일하세요.');
  }

  const campaigns = new Set(utms.map(u => u.utm_campaign));
  const campaignsNormalized = new Set(utms.map(u => u.utm_campaign.toLowerCase().replace(/\s+/g, '_')));
  if (campaigns.size > campaignsNormalized.size) {
    warnings.push('⚠️ utm_campaign 표기 일관성 문제 (공백/대소문자). snake_case 권장.');
  }

  return warnings;
}
