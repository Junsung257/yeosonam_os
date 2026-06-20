'use client';

import type { AnalyticsEventName } from './analytics-events';

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

// 365일 first-party 쿠키 — 비로그인 재방문 식별
const VISITOR_UID_COOKIE = 'ysm_uid';
const VISITOR_UID_TTL_DAYS = 365;

interface UtmData {
  source?: string;
  medium?: string;
  campaign_name?: string;
  keyword?: string;
  ad_landing_mapping_id?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
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

// ── 365일 first-party visitor_uid (재방문 식별) ────────────────
// PIPA: 비식별 UUID 만 저장. 개인정보 아님.
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name: string, value: string, ttlDays: number) {
  if (typeof document === 'undefined') return;
  const exp = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`;
}

/** 365일 first-party visitor UID. 신규 발급 여부도 함께 반환 (is_returning 판정). */
export function getVisitorUid(): { uid: string; isReturning: boolean } {
  if (typeof window === 'undefined') return { uid: 'ssr', isReturning: false };
  const existing = readCookie(VISITOR_UID_COOKIE);
  if (existing && existing.length >= 8) {
    // 재방문 — TTL 재연장 (rolling 365)
    writeCookie(VISITOR_UID_COOKIE, existing, VISITOR_UID_TTL_DAYS);
    return { uid: existing, isReturning: true };
  }
  const fresh = crypto.randomUUID();
  writeCookie(VISITOR_UID_COOKIE, fresh, VISITOR_UID_TTL_DAYS);
  return { uid: fresh, isReturning: false };
}

// ── 디바이스 감지 (User-Agent 기반 가벼운 분류) ──────────────────
function detectDevice(): { type: string; os: string; browser: string } {
  if (typeof navigator === 'undefined') return { type: 'unknown', os: 'unknown', browser: 'unknown' };
  const ua = navigator.userAgent || '';
  const isTablet = /iPad|Tablet|PlayBook|(Android(?!.*Mobile))/i.test(ua);
  const isMobile = /Mobi|iPhone|Android|IEMobile|BlackBerry|webOS|Opera Mini/i.test(ua) && !isTablet;
  const type = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';
  let os = 'other';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  let browser = 'other';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/KAKAOTALK/i.test(ua)) browser = 'KakaoIn';
  return { type, os, browser };
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
  const adLandingMappingId = params.get('ad_mapping_id') ?? params.get('ad_landing_mapping_id') ?? params.get('admid') ?? undefined;
  const rawGclid = params.get('gclid') ?? undefined;
  const rawGbraid = params.get('gbraid') ?? undefined;
  const rawWbraid = params.get('wbraid') ?? undefined;
  const rawFbclid = params.get('fbclid') ?? undefined;
  const rawNKeyword = params.get('n_keyword') ?? undefined;

  // UTM 파라미터가 하나도 없으면 이전 localStorage 값 재사용 (last-click 귀속)
  const hasUtmParams = !!(utmSource || rawGclid || rawGbraid || rawWbraid || rawFbclid || rawNKeyword || adLandingMappingId);

  let utmData: UtmData;

  if (hasUtmParams) {
    utmData = {
      source: utmSource,
      medium: utmMedium,
      campaign_name: utmCampaign,
      keyword: utmTerm,
      ad_landing_mapping_id: adLandingMappingId,
      // PIPA: consent=false이면 개인식별 클릭 ID 저장 안 함
      gclid: consent ? rawGclid : undefined,
      gbraid: consent ? rawGbraid : undefined,
      wbraid: consent ? rawWbraid : undefined,
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
  const { uid: visitor_uid, isReturning: is_returning } = getVisitorUid();
  const device = detectDevice();

  post({
    type: 'traffic',
    session_id: getSessionId(),
    user_id: getSavedUserId(),
    visitor_uid,
    is_returning,
    device_type: device.type,
    device_os: device.os,
    browser_name: device.browser,
    viewport_w: typeof window !== 'undefined' ? window.innerWidth : undefined,
    viewport_h: typeof window !== 'undefined' ? window.innerHeight : undefined,
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
  const params = new URLSearchParams(window.location.search);
  const utmSource = params.get('utm_source') ?? undefined;
  const utmMedium = params.get('utm_medium') ?? undefined;
  const utmCampaign = params.get('utm_campaign') ?? undefined;
  const utmTerm = params.get('utm_term') ?? undefined;
  const adLandingMappingId = params.get('ad_mapping_id') ?? params.get('ad_landing_mapping_id') ?? params.get('admid') ?? undefined;

  post({
    type: 'traffic',
    session_id: getSessionId(),
    user_id: getSavedUserId(),
    consent_agreed: isConsentAgreed(),
    landing_page: window.location.pathname + window.location.search,
    content_creative_id: contentCreativeId,
    source: utmSource || (document.referrer ? new URL(document.referrer).hostname : undefined),
    medium: utmMedium || 'content',
    campaign_name: utmCampaign,
    keyword: utmTerm,
    ad_landing_mapping_id: adLandingMappingId,
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
  const { uid: visitor_uid } = getVisitorUid();
  post({
    type: 'search',
    session_id: getSessionId(),
    user_id: getSavedUserId(),
    visitor_uid,
    ...params,
  });
}

// ── trackEngagement ────────────────────────────────────────────

export type EngagementEventType =
  | AnalyticsEventName
  | 'page_view'
  | 'product_view'
  | 'cart_abandon_exit'
  | 'page_exit'
  | 'scroll_25'
  | 'scroll_50'
  | 'scroll_75'
  | 'scroll_90';

type TrackEngagementParams = {
  event_type: EngagementEventType;
  product_id?: string;
  product_name?: string;
  source?: string;
  cta_type?: string;
  filter_name?: string;
  filter_value?: string;
  page_url?: string;
  event_source?: string | null;
  lead_time_days?: number;
  time_on_page_ms?: number;
  max_scroll_pct?: number;
  interaction_count?: number;
  intent?: string | null;
  budget?: string | null;
  destination?: string | null;
  party_type?: string | null;
  selected_products?: string[] | null;
  ready_count?: number | null;
  missing_fields?: string[] | null;
  decision_summary?: string | null;
  handoff_preview?: string | null;
  next_action?: string | null;
  next_action_reason?: string | null;
  result_summary?: string | null;
  applied_filters?: string | null;
  recommended_rank?: number | null;
  rank?: number | null;
  price?: number | null;
  task_flow?: string | null;
  queue_key?: string | null;
  command_source?: string | null;
  action_stage?: 'navigation' | 'completed' | null;
  click_count?: number | null;
  time_to_complete_ms?: number | null;
  metadata?: Record<string, unknown>;
};

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function inferAdminTaskFlow(surface: string | null, action: string | null, pageUrl: string | null): string | null {
  const source = `${pageUrl ?? ''} ${surface ?? ''} ${action ?? ''}`;
  if (source.includes('payments')) return 'payment_operations';
  if (source.includes('bookings')) return 'booking_operations';
  if (source.includes('packages')) return 'package_operations';
  if (source.includes('today_work') || source.includes('operator_command') || pageUrl === '/admin') return 'dashboard_triage';
  if (source.includes('jarvis') || source.includes('ai')) return 'ai_operations';
  return null;
}

function inferAdminQueueKey(metadata: Record<string, unknown> | undefined, surface: string | null, pageUrl: string | null): string | null {
  const explicitQueue = asText(metadata?.queue) ?? asText(metadata?.queue_key) ?? asText(metadata?.filter);
  if (explicitQueue) return explicitQueue;

  const href = asText(metadata?.href);
  if (href) {
    if (href.includes('filter=unpaid')) return 'bookings_unpaid';
    if (href.includes('filter=unmatched')) return 'payments_unmatched';
    if (href.includes('filter=outstanding')) return 'payments_outstanding';
    if (href.includes('filter=review')) return 'payments_review';
    if (href.includes('/admin/land-settlements')) return 'land_settlements';
    if (href.includes('/admin/ledger')) return 'finance_ledger';
    if (href.includes('mode=upcoming')) return 'bookings_upcoming';
    if (href.includes('status=pending,confirmed')) return 'bookings_active';
    if (href.includes('/admin/packages')) return 'packages_pending_review';
    if (href.includes('/admin/jarvis')) return 'ai_action_review';
    if (href.includes('/admin/bookings')) return 'bookings_queue';
    if (href.includes('/admin/payments')) return 'payments_queue';
  }

  if (surface?.includes('bulk')) return 'bulk_selection';
  if (surface?.includes('work_queue')) return surface;
  if (surface?.includes('command')) return surface;
  if (pageUrl?.includes('/admin/bookings')) return 'bookings_current_filter';
  if (pageUrl?.includes('/admin/packages')) return 'packages_current_filter';
  if (pageUrl?.includes('/admin/payments')) return 'payments_current_filter';
  if (pageUrl === '/admin') return 'dashboard_today_work';
  return null;
}

function inferAdminCommandSource(surface: string | null, metadata: Record<string, unknown> | undefined): string | null {
  const explicitSource = asText(metadata?.source) ?? asText(metadata?.command_source);
  if (explicitSource) return explicitSource;
  if (!surface) return null;
  if (surface.includes('today_work')) return 'today_work_queue';
  if (surface.includes('command')) return 'command_bar';
  if (surface.includes('work_queue')) return 'work_queue';
  if (surface.includes('row')) return 'table_row';
  if (surface.includes('mobile')) return 'mobile_card';
  if (surface.includes('drawer')) return 'detail_drawer';
  if (surface.includes('modal')) return 'modal';
  if (surface.includes('bulk')) return 'bulk_action';
  return surface;
}

function inferAdminActionStage(action: string | null, surface: string | null): 'navigation' | 'completed' | null {
  const source = `${surface ?? ''} ${action ?? ''}`;
  if (!source.trim()) return null;
  if (/(opened|_open|clicked|select|toggle|drawer|menu|queue_opened|command_opened)/.test(source)) return 'navigation';
  if (/(copied|bulk|match|cancel|restore|approve|publish|delete|resync|import|create|settle|refund|retry|complete|save|update)/.test(source)) return 'completed';
  return 'navigation';
}

function inferAdminClickCount(action: string | null, surface: string | null): number | null {
  const source = `${surface ?? ''} ${action ?? ''}`;
  if (!source.trim()) return null;
  if (/(opened|open|select|selected|clicked|toggle|copied)/.test(source)) return 1;
  if (/(bulk|match|cancel|restore|approve|publish|delete|resync|import|create|settle|refund|retry|complete)/.test(source)) return 2;
  return 1;
}

function withAdminProductivityMetadata(params: TrackEngagementParams): TrackEngagementParams {
  if (params.event_type !== 'admin_action_completed') return params;

  const metadata = params.metadata;
  const surface = asText(metadata?.surface);
  const action = asText(metadata?.action);
  const pageUrl = params.page_url ?? asText(metadata?.page_url);

  return {
    ...params,
    task_flow: params.task_flow ?? inferAdminTaskFlow(surface, action, pageUrl),
    queue_key: params.queue_key ?? inferAdminQueueKey(metadata, surface, pageUrl),
    command_source: params.command_source ?? inferAdminCommandSource(surface, metadata),
    action_stage: params.action_stage ?? inferAdminActionStage(action, surface),
    click_count: params.click_count ?? inferAdminClickCount(action, surface),
  };
}

export function trackEngagement(params: TrackEngagementParams): void {
  const { uid: visitor_uid } = getVisitorUid();
  const enrichedParams = withAdminProductivityMetadata(params);
  post({
    type: 'engagement',
    session_id: getSessionId(),
    user_id: getSavedUserId(),
    visitor_uid,
    cart_added: enrichedParams.event_type === 'cart_added',
    ...enrichedParams,
  });
}

/** 스크롤 깊이 마일스톤 — 이탈 구간·히트맵 보조용 (ad_engagement_logs.event_type) */
export function trackScrollMilestone(depthPct: 25 | 50 | 75 | 90, pageUrl: string): void {
  const event_type = `scroll_${depthPct}` as EngagementEventType;
  trackEngagement({ event_type, page_url: pageUrl });
}

/**
 * 페이지 떠날 때(beforeunload/pagehide) 체류시간 + 최대 스크롤 기록.
 * sendBeacon 우선 사용 (브라우저가 페이지 닫힘에도 전송 보장).
 */
export function trackPageExit(params: {
  page_url: string;
  time_on_page_ms: number;
  max_scroll_pct: number;
  interaction_count: number;
}): void {
  if (typeof window === 'undefined') return;
  const { uid: visitor_uid } = getVisitorUid();
  const body = JSON.stringify({
    type: 'engagement',
    session_id: getSessionId(),
    user_id: getSavedUserId(),
    visitor_uid,
    event_type: 'page_exit',
    ...params,
  });
  // sendBeacon: 페이지 닫힘에도 전송 보장 (대신 응답 무시)
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/api/tracking', blob);
      return;
    } catch {
      // fallback to fetch
    }
  }
  fetch('/api/tracking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
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
