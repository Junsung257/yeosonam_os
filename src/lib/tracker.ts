'use client';

/**
 * 3대 광고 통합 트래커 — Google / Meta / Naver
 *
 * 클라이언트 전용 모듈. Next.js App Router의 'use client' 컴포넌트에서만 호출.
 *
 * 저장 위치:
 *   sessionStorage: session_id (탭 단위 UUID, 탭 닫으면 소멸)
 *   localStorage:   utm_data (30일 유효), user_id (로그인 후 지속)
 *
 * 모든 이벤트 전송은 fire-and-forget (202 응답, 에러 무시)
 */

const SESSION_KEY = 'ys_session_id';
const UTM_KEY = 'ys_utm_data';
const USER_KEY = 'ys_user_id';
const CONSENT_KEY = 'tc_consent'; // 마케팅 동의 여부 ('true' | 'false')
const UTM_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일

interface UtmData {
  source?: string;
  medium?: string;
  campaign_name?: string;
  keyword?: string;
  gclid?: string;
  fbclid?: string;
  n_keyword?: string;
  current_cpc?: number;
  consent_agreed: boolean;
  saved_at: number; // Date.now()
}

// ── 제휴/인플루언서 추천 코드 ──────────────────────────────────

export function getReferrer(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)aff_ref=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// ── 세션 ID ────────────────────────────────────────────────────

export function getSessionId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

// ── 마케팅 동의 여부 ───────────────────────────────────────────

function isConsentAgreed(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(CONSENT_KEY) === 'true';
}

// ── 저장된 사용자 ID ───────────────────────────────────────────

function getSavedUserId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return localStorage.getItem(USER_KEY) ?? undefined;
}

// ── fire-and-forget POST ───────────────────────────────────────

function post(body: Record<string, unknown>): void {
  fetch('/api/tracking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

// ── initTracker ────────────────────────────────────────────────
/**
 * 페이지 진입 시 1회 호출.
 * URL의 UTM/gclid/fbclid/n_keyword를 파싱해 localStorage에 저장하고
 * /api/tracking으로 traffic 이벤트를 전송한다.
 */
export function initTracker(): void {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  const consent = isConsentAgreed();

  const utmSource = params.get('utm_source') ?? undefined;
  const utmMedium = params.get('utm_medium') ?? undefined;
  const utmCampaign = params.get('utm_campaign') ?? undefined;
  const utmTerm = params.get('utm_term') ?? undefined;
  const rawGclid = params.get('gclid') ?? undefined;
  const rawFbclid = params.get('fbclid') ?? undefined;
  const rawNKeyword = params.get('n_keyword') ?? undefined;

  // UTM 파라미터가 하나도 없으면 이전 localStorage 값 재사용 (last-click 귀속)
  const hasUtmParams = !!(utmSource || rawGclid || rawFbclid || rawNKeyword);

  let utmData: UtmData;

  if (hasUtmParams) {
    utmData = {
      source: utmSource,
      medium: utmMedium,
      campaign_name: utmCampaign,
      keyword: utmTerm,
      // PIPA: consent=false이면 개인식별 클릭 ID 저장 안 함
      gclid: consent ? rawGclid : undefined,
      fbclid: consent ? rawFbclid : undefined,
      n_keyword: rawNKeyword, // 검색 키워드는 비식별 정보로 허용
      consent_agreed: consent,
      saved_at: Date.now(),
    };
    localStorage.setItem(UTM_KEY, JSON.stringify(utmData));
  } else {
    // 이전 세션의 UTM 데이터 재사용 (30일 이내)
    const stored = localStorage.getItem(UTM_KEY);
    if (stored) {
      try {
        const parsed: UtmData = JSON.parse(stored);
        if (Date.now() - parsed.saved_at < UTM_TTL_MS) {
          utmData = parsed;
        } else {
          // 만료 → 직접 유입
          localStorage.removeItem(UTM_KEY);
          utmData = { consent_agreed: consent, saved_at: Date.now() };
        }
      } catch {
        utmData = { consent_agreed: consent, saved_at: Date.now() };
      }
    } else {
      utmData = { consent_agreed: consent, saved_at: Date.now() };
    }
  }

  const referrer = getReferrer();

  post({
    type: 'traffic',
    session_id: getSessionId(),
    user_id: getSavedUserId(),
    ...utmData,
    // 인플루언서/제휴 추천이면 source에 반영
    ...(referrer && !utmData.source ? { source: referrer, medium: 'affiliate' } : {}),
    consent_agreed: consent,
    landing_page: window.location.pathname + window.location.search,
  });
}

/**
 * 콘텐츠 페이지(블로그 등) 진입 시 호출.
 * content_creative_id를 포함한 traffic 이벤트를 전송한다.
 */
export function trackContentView(contentCreativeId: string): void {
  if (typeof window === 'undefined') return;
  post({
    type: 'traffic',
    session_id: getSessionId(),
    user_id: getSavedUserId(),
    consent_agreed: isConsentAgreed(),
    landing_page: window.location.pathname + window.location.search,
    content_creative_id: contentCreativeId,
    source: document.referrer ? new URL(document.referrer).hostname : undefined,
    medium: 'content',
  });
}

// ── mergeUserId ────────────────────────────────────────────────
/**
 * 로그인 완료 시 호출.
 * localStorage에 user_id를 저장하고, 서버에서 이전 session 로그들에 user_id를 채운다.
 */
export function mergeUserId(userId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_KEY, userId);
  post({
    type: 'merge',
    session_id: getSessionId(),
    user_id: userId,
  });
}

// ── trackSearch ────────────────────────────────────────────────

export function trackSearch(params: {
  search_query: string;
  search_category?: string;
  result_count?: number;
  lead_time_days?: number;
}): void {
  post({
    type: 'search',
    session_id: getSessionId(),
    user_id: getSavedUserId(),
    ...params,
  });
}

// ── trackEngagement ────────────────────────────────────────────

export type EngagementEventType =
  | 'page_view'
  | 'product_view'
  | 'cart_added'
  | 'checkout_start'
  | 'scroll_25'
  | 'scroll_50'
  | 'scroll_75'
  | 'scroll_90';

export function trackEngagement(params: {
  event_type: EngagementEventType;
  product_id?: string;
  product_name?: string;
  page_url?: string;
  lead_time_days?: number;
}): void {
  post({
    type: 'engagement',
    session_id: getSessionId(),
    user_id: getSavedUserId(),
    cart_added: params.event_type === 'cart_added',
    ...params,
  });
}

/** 스크롤 깊이 마일스톤 — 이탈 구간·히트맵 보조용 (ad_engagement_logs.event_type) */
export function trackScrollMilestone(depthPct: 25 | 50 | 75 | 90, pageUrl: string): void {
  const event_type = `scroll_${depthPct}` as EngagementEventType;
  trackEngagement({ event_type, page_url: pageUrl });
}

// ── trackConversion ────────────────────────────────────────────

export function trackConversion(params: {
  booking_id: string;
  final_sales_price: number;
  base_cost: number;
}): void {
  post({
    type: 'conversion',
    session_id: getSessionId(),
    user_id: getSavedUserId(),
    ...params,
  });
}
