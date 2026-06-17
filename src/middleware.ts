import { NextRequest, NextResponse } from 'next/server';
import { looksLikeReferralCode, normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { getAffiliateRefCookieMaxAgeSec } from '@/lib/affiliate-ref-cookie-policy';
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';
import { getSecret } from '@/lib/secret-registry';
import { isUuid } from '@/lib/uuid';
import { resolveBlogSlugRedirect } from '@/lib/blog-slug-redirects';

function safeDecodeRouteValue(value: string): string {
  let decoded = value;
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function destinationSlugFromRouteValue(value: string): string {
  return safeDecodeRouteValue(value)
    .trim()
    .replace(/[\/\\／]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getLegacyDestinationRedirectPath(request: NextRequest): string | null {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/destinations/') || pathname.startsWith('/destinations/region/')) return null;

  let rest = pathname.slice('/destinations/'.length);
  let suffix = '';
  if (rest.endsWith('/rss.xml')) {
    rest = rest.slice(0, -'/rss.xml'.length);
    suffix = '/rss.xml';
  }

  const segments = rest.split('/').filter(Boolean);
  const hasExtraCitySegments = segments.length > 1;
  const hasEncodedSlash = /%2f|%252f/i.test(request.url) || /%2f|%252f/i.test(rest);
  if (!hasExtraCitySegments && !hasEncodedSlash) return null;

  const slug = destinationSlugFromRouteValue(rest);
  return slug ? `/destinations/${encodeURIComponent(slug)}${suffix}` : null;
}

function getLegacyBlogRedirectPath(request: NextRequest): string | null {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/blog/')) return null;
  const rest = pathname.slice('/blog/'.length);
  if (!rest || rest.includes('/')) return null;
  const slug = safeDecodeRouteValue(rest).trim();
  const redirectedSlug = resolveBlogSlugRedirect(slug);
  return redirectedSlug ? `/blog/${encodeURIComponent(redirectedSlug)}` : null;
}

function setAffiliateRefCookie(res: NextResponse, request: NextRequest, value: string, isSecure: boolean) {
  const maxAge = getAffiliateRefCookieMaxAgeSec(request);
  res.cookies.set('aff_ref', value, {
    httpOnly: false,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    ...(maxAge !== undefined ? { maxAge } : {}),
  });
}

// 정확히 일치하는 공개 경로 — O(1) Set 조회
const PUBLIC_EXACT = new Set([
  '/',
  '/login',
  '/privacy',
  '/private-tour',
  '/packages',
  '/terms',
  '/auth/callback',
  '/auth/reset-password',
  '/api/auth/session',
  '/api/auth/refresh',
  '/api/dev/admin-session',
  '/api/v1/health',
  '/api/user-actions',
  '/api/bookings',
  '/api/leads',
  '/api/qa',
  '/m/admin/login',
  '/api/qa/chat',
  '/api/qa/chat/v2',
  '/api/qa/escalation-cta',
  '/api/qa/vision',
  '/api/sms/receive',
  '/api/notify/alimtalk',
  '/api/slack-webhook',
  '/api/exchange-rate',
  // Programmatic SEO
  '/things-to-do',
  // Phase 1.5 IR 파이프 (Canary)
  '/api/register-via-ir',
  '/api/audit-pkg-to-ir',
  '/api/register-via-assembler',
  // 단체여행 RFQ
  '/group-inquiry',
  // Meta webhook
  '/api/webhooks/instagram',
  '/api/webhooks/threads',
  // 카카오 웹훅
  '/api/webhooks/kakao',
  // 블로그
  '/api/rss',
  '/api/blog-engagement',
  '/api/web-vitals',
  // ISR 캐시 무효화
  '/api/revalidate',
  // 크론 (서버-to-서버)
  '/api/cron/meta-optimize',
  '/api/cron/visual-baseline-monitor',
  '/api/cron/journey-scheduler',
  '/api/cron/rfq-timeout',
  '/api/cron/post-travel',
  '/api/cron/ad-optimizer',
  '/api/cron/settlement-auto',
  '/api/cron/sync-creative-performance',
  '/api/cron/auto-archive',
  '/api/cron/magic-tokens-cleanup',
  '/api/cron/unmatched-orchestrator',
  '/api/cron/unmatched-classify',
  '/api/cron/resweep-unmatched',
  '/api/cron/upload-review-auto-replay',
  '/api/cron/embed-products',
  '/api/cron/blog-lifecycle',
  '/api/cron/blog-scheduler',
  '/api/cron/blog-publisher',
  '/api/cron/blog-indexing-worker',
  '/api/cron/blog-learn',
  '/api/cron/publish-scheduled',
  '/api/cron/sync-engagement',
  '/api/cron/card-news-refine',
  '/api/cron/meta-token-refresh',
  '/api/cron/slack-gap-fill',
  '/api/cron/dlq-replay',
  '/api/cron/payment-heartbeat',
  '/api/cron/booking-tasks-runner',
  '/api/cron/scoring-recompute',
  '/api/cron/land-operator-reliability',
  '/api/cron/payment-rules-learn',
  '/api/cron/payment-stale-alert',
  '/api/cron/refresh-seasonal',
  '/api/cron/ltr-funnel-report',
  '/api/cron/policy-ab-compare',
  '/api/cron/rag-incremental',
  '/api/cron/card-news-seasonal',
  '/api/cron/free-travel-plan-housekeeping',
  '/api/cron/unmatched-auto-resolve',
  '/api/cron/entity-master-candidates',
  '/api/cron/promote-internal-candidates',
  '/api/cron/mrt-revenue-sync',
  '/api/cron/mrt-hotel-ranking',
  '/api/cron/variant-winner-decide',
  '/api/cron/setup-new-destinations',
  '/api/cron/free-travel-retarget',
  '/api/cron/affiliate-settlement-draft',
  '/api/cron/affiliate-dormant',
  '/api/cron/affiliate-anomaly-detect',
  '/api/cron/affiliate-content-24h-report',
  '/api/cron/affiliate-tier-rewards',
  '/api/cron/affiliate-reactivation-campaign',
  '/api/cron/affiliate-attribution-recalc',
  '/api/cron/affiliate-live-celebration',
  '/api/cron/affiliate-lifetime-commission',
  '/api/cron/affiliate-sub-daily-rollup',
  '/api/cron/affiliate-model-compare-rollup',
  '/api/cron/trend-topic-miner',
  '/api/cron/serp-rank-snapshot',
  '/api/cron/rank-tracking',
  '/api/cron/gsc-index-rank',
  '/api/cron/seo-monitor',
  '/api/cron/programmatic-seo-generator',
  '/api/cron/blog-regenerate-zero-click',
  '/api/cron/blog-orchestrator',
  '/api/cron/topical-rebuild',
  '/api/cron/blog-daily-summary',
  '/api/cron/ledger-reconcile',
  '/api/cron/fill-attraction-photos',
  '/api/cron/agent-executor',
  '/api/cron/booking-attribution-audit',
  '/api/cron/marketing-rules',
  '/api/cron/marketing-asset-snapshot',
  '/api/cron/concierge-cart-retarget',
  '/api/cron/hard-block-alert',
  '/api/cron/dynamic-pricing',
  '/api/cron/hitl-reminder',
  '/api/cron/content-drift-detect',
  '/api/cron/churn-detect',
  '/api/cron/weather-upsell',
  // concierge 개별 엔드포인트
  '/api/concierge/search',
  '/api/concierge/cart',
  '/api/concierge/checkout',
  // 기타
  '/api/tenant/rfqs',
  '/api/tracking/recommendation',
  // 랜드사 파트너 포털 (Bearer 토큰 자체 인증)
  '/api/partner/packages',
  '/api/partner/bookings',
  '/partner',
  // Phase 2-F: 환율 스냅샷 크론
  '/api/cron/fx-rate-sync',
  // Phase 2-G: B2B 도매 API (자체 Bearer 인증)
  '/api/b2b/packages',
  // Phase 3-A: 동행자 온보딩
  '/join',
  // Phase 3-B: 귀국 후 릴스 크론
  '/api/cron/post-travel-reels',
  // Phase 3-B: 릴스 생성 API (booking_id 기반, 인증 불필요)
  '/api/reels/create',
  // Phase 3-E: 리뷰 감정 분석 크론
  '/api/cron/review-sentiment',
  // Phase 3-G: 여권 OCR (비로그인 고객용)
  '/api/passport/ocr',
  // Phase 3-H: 사기 탐지 크론
  '/api/cron/fraud-detect',
  // 멀티테넌트 OAuth 콜백 (인증 전 리다이렉트)
  '/api/auth/google-oauth-start',
  '/api/auth/google-callback',
  '/api/auth/meta-oauth-start',
  '/api/auth/meta-callback',
  // 마케팅 자동화 파이프라인 크론
  '/api/cron/daily-marketing',
  // Inngest webhook (서버-to-서버, 자체 서명 검증)
  '/api/inngest',
  // Naver OAuth (Sprint 2-A)
  '/api/auth/naver-oauth-start',
  '/api/auth/naver-callback',
  // TossPayments Webhook (Sprint 4-B) — 자체 서명 검증
  '/api/billing/toss-webhook',
]);

// 하위 경로까지 공개가 필요한 prefix — 짧은 배열, 정확 일치 실패 시에만 검사
const PUBLIC_PREFIXES = [
  '/reels/',           // Phase 3-B: 릴스 공유 페이지 (share_token 기반)
  '/api/reels/',       // Phase 3-B: 릴스 API
  '/api/b2b/packages/',  // Phase 2-G: B2B 단건 상세 동적 경로
  '/trip/',
  '/api/booking-portal/',
  '/api/booking-concierge/',
  '/packages/',
  '/lp/', // 광고·SNS 유입 마케팅 랜딩 (비로그인)
  '/blog/',
  '/api/blog/',
  '/products/',
  '/concierge/',
  '/tenant/',
  '/share/',
  '/api/share/',
  '/api/attractions/',
  '/things-to-do/',
  '/group/',
  '/rfq/',
  '/api/rfq/',
  '/api/tracking/',
  '/api/og/',
  '/influencer/',
  '/affiliate/',
  '/api/influencer/',
  '/api/affiliate/auth/',
  '/api/affiliate/dashboard',
  '/with/',
  '/r/',
  '/embed/',
  '/partner-apply/',
  '/api/partner-apply/',
  '/api/recommendations/',
  '/destinations/',
  '/review/',
  '/api/reviews/',
  '/free-travel/',
  '/api/free-travel/',
  '/blog/destination/',
  '/legal/',
  // Phase 3-A: 동행자 온보딩
  '/join/',
  '/api/join/',
  // Phase 3-E: package_reviews 공개 API
  '/api/package-reviews/',
  // Phase 3-G: 여권 OCR 고객 페이지
  '/passport-assist/',
  // S1 매직링크 통합 — POST-confirm 착지 + 확인 라우트 (게스트)
  '/m/link/',
  '/api/m/',
  '/about',
  '/api/about/',
  // 자비스 게스트 챗 진입 (magic-session 쿠키로 인증, middleware 통과만 허용)
  '/m/chat/',
  '/m/booking/',
  '/m/consent/',
  '/m/companion/',
  '/m/review/',
  '/m/passport/',
  '/m/pay/',
];

// 짧은 정확 일치 경로 (prefix 배열 없이 Set에 포함)
const PUBLIC_EXACT_SHORT = new Set([
  '/blog', '/api/blog', '/products', '/concierge', '/tenant', '/share',
  '/api/share', '/api/attractions', '/group', '/rfq', '/api/rfq',
  '/api/tracking', '/api/og',   '/influencer', '/api/influencer',
  '/with', '/r', '/embed', '/partner-apply', '/api/partner-apply',
  '/api/recommendations', '/destinations', '/review', '/api/reviews',
  '/free-travel', '/api/free-travel', '/blog/destination',
  '/api/package-reviews', '/passport-assist',
]);

// 미등록 공개 URL을 로그인 페이지(200)로 오인시키지 않기 위한 최상위 라우트 allow-list.
// 실제 앱 라우트가 아닌 첫 segment는 middleware 인증 리다이렉트 대신 Next 404로 흘린다.
const KNOWN_TOP_LEVEL_ROUTES = new Set([
  'about',
  'admin',
  'affiliate',
  'api',
  'auth',
  'blog',
  'concierge',
  'destinations',
  'embed',
  'free-travel',
  'group',
  'group-inquiry',
  'influencer',
  'itinerary',
  'join',
  'legal',
  'link',
  'llms.txt',
  'login',
  'lp',
  'm',
  'mypage',
  'packages',
  'partner',
  'partner-apply',
  'passport-assist',
  'privacy',
  'private-tour',
  'r',
  'reels',
  'review',
  'rfq',
  'share',
  'tenant',
  'terms',
  'things-to-do',
  'tour',
  'trip',
  'with',
]);

function hasKnownTopLevelRoute(pathname: string): boolean {
  const firstSegment = pathname.split('/').filter(Boolean)[0] || '';
  return firstSegment.length === 0 || KNOWN_TOP_LEVEL_ROUTES.has(firstSegment);
}

function plainNotFound(): NextResponse {
  return new NextResponse('Not Found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

function safeDecodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getSupabaseRestConfig(): { url: string; key: string } | null {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    getSecret('SUPABASE_URL');
  const key =
    getSecret('SUPABASE_SERVICE_ROLE_KEY') ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    getSecret('SUPABASE_ANON_KEY');

  if (!url || !/^https?:\/\//.test(url) || !key || url.includes('your_supabase_url')) {
    return null;
  }

  return { url: url.replace(/\/+$/, ''), key };
}

async function supabaseRowExists(table: string, filters: Record<string, string>): Promise<boolean | null> {
  const config = getSupabaseRestConfig();
  if (!config) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const endpoint = new URL(`${config.url}/rest/v1/${table}`);
    endpoint.searchParams.set('select', table === 'active_destinations' ? 'destination' : 'id');
    endpoint.searchParams.set('limit', '1');
    for (const [key, value] of Object.entries(filters)) {
      endpoint.searchParams.set(key, `eq.${value}`);
    }

    const res = await fetch(endpoint, {
      headers: {
        apikey: config.key,
        authorization: `Bearer ${config.key}`,
        accept: 'application/json',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const data = await res.json();
    return Array.isArray(data) && data.length > 0;
  } catch {
    return null;
  }
}

async function activeDestinationExists(destinationOrSlug: string): Promise<boolean | null> {
  const exact = await supabaseRowExists('active_destinations', { destination: destinationOrSlug });
  if (exact !== false) return exact;

  const config = getSupabaseRestConfig();
  if (!config) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const endpoint = new URL(`${config.url}/rest/v1/active_destinations`);
    endpoint.searchParams.set('select', 'destination');
    endpoint.searchParams.set('limit', '2000');

    const res = await fetch(endpoint, {
      headers: {
        apikey: config.key,
        authorization: `Bearer ${config.key}`,
        accept: 'application/json',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const targetSlug = destinationSlugFromRouteValue(destinationOrSlug);
    const data = await res.json();
    return Array.isArray(data) && data.some((row) => {
      const destination = typeof row?.destination === 'string' ? row.destination : '';
      return destinationSlugFromRouteValue(destination) === targetSlug;
    });
  } catch {
    return null;
  }
}

async function getPublicDynamicNotFoundResponse(pathname: string): Promise<NextResponse | null> {
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] === 'packages' && segments.length === 2) {
    const id = safeDecodePathSegment(segments[1]);
    if (!isUuid(id)) return plainNotFound();
  }

  if (segments[0] === 'blog' && segments.length === 2) {
    const slug = safeDecodePathSegment(segments[1]).trim();
    if (!slug) return plainNotFound();
    const exists = await supabaseRowExists('content_creatives', {
      slug,
      status: 'published',
      channel: 'naver_blog',
    });
    if (exists === false) return plainNotFound();
  }

  if (segments[0] === 'destinations' && segments.length === 2) {
    const destination = safeDecodePathSegment(segments[1]).trim();
    if (!destination) return plainNotFound();
    const exists = await activeDestinationExists(destination);
    if (exists === false) return plainNotFound();
  }

  return null;
}

function isPublicPath(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /api/packages는 GET 요청만 PUBLIC 허용
  if (pathname === '/api/packages' || pathname.startsWith('/api/packages/')) {
    return request.method === 'GET';
  }

  if (pathname === '/api/unmatched') {
    return request.method === 'POST';
  }

  // O(1) 정확 일치
  if (PUBLIC_EXACT.has(pathname) || PUBLIC_EXACT_SHORT.has(pathname)) return true;

  // prefix 매칭 (정확 일치 실패 시에만 실행, 배열 크기 ~27개)
  return PUBLIC_PREFIXES.some(p => pathname.startsWith(p));
}

async function accessTokenAllowsRequest(token: string): Promise<boolean> {
  const v = await verifySupabaseAccessToken(token);
  return v.ok;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isSecure = process.env.NODE_ENV === 'production';
  const isDev = process.env.NODE_ENV !== 'production';
  const isAdminPath = pathname.startsWith('/admin') || pathname.startsWith('/m/admin');

  const legacyDestinationRedirectPath = getLegacyDestinationRedirectPath(request);
  if (legacyDestinationRedirectPath) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = legacyDestinationRedirectPath;
    return NextResponse.redirect(redirectUrl, 308);
  }

  const legacyBlogRedirectPath = getLegacyBlogRedirectPath(request);
  if (legacyBlogRedirectPath) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = legacyBlogRedirectPath;
    return NextResponse.redirect(redirectUrl, 308);
  }

  // ── 1. 서버사이드 세션 쿠키 (Safari ITP 대응) ──────────────
  // sessionStorage 대신 서버에서 30일 쿠키로 세션 ID 발급
  let response: NextResponse | null = null;
  const existingSession = request.cookies.get('ys_session_id')?.value;

  function getResponse() {
    if (!response) response = NextResponse.next();
    return response;
  }

  if (!existingSession) {
    const res = getResponse();
    res.cookies.set('ys_session_id', crypto.randomUUID(), {
      httpOnly: false, // 클라이언트 tracker.ts에서 읽어야 함
      secure: isSecure,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30일
      path: '/',
    });
  }

  // ── 1-1. /admin/_dev/ui-kit 호환 경로 (Next private segment 우회) ─────────
  // app 디렉터리에서 "_" 세그먼트는 private folder라 직접 라우팅되지 않는다.
  // 기존 점검 URL 호환을 위해 공개 가능한 /admin/dev/ui-kit 으로 리라이트한다.
  if (pathname === '/admin/_dev/ui-kit') {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = '/admin/dev/ui-kit';
    return NextResponse.rewrite(rewriteUrl);
  }

  // ── 2. 인플루언서/제휴 링크 추적 (?ref=CODE) ────────────────
  // 기본: aff_ref 30일. PIPA 대비: AFFILIATE_REF_STRICT_MARKETING_CONSENT=true + ys_marketing_consent 쿠키일 때만 30일.
  const ref = request.nextUrl.searchParams.get('ref');
  if (ref) {
    const canon = normalizeAffiliateReferralCode(ref);
    if (looksLikeReferralCode(canon)) {
      const res = getResponse();
      setAffiliateRefCookie(res, request, canon, isSecure);
    }
  }

  // ── 2-1. 코브랜딩 랜딩 /with/[slug] → 추천 코드 쿠키 (?ref= 과 동일 정책) ──
  const withMatch = pathname.match(/^\/with\/([^/]+)\/?$/);
  if (withMatch) {
    const slug = normalizeAffiliateReferralCode(decodeURIComponent(withMatch[1]));
    if (looksLikeReferralCode(slug)) {
      const res = getResponse();
      setAffiliateRefCookie(res, request, slug, isSecure);
    }
  }

  // ── 2-2. 임베드 위젯: iframe 허용 (외부 사이트 게재용) ─────
  if (pathname.startsWith('/embed/')) {
    const res = getResponse();
    // X-Frame-Options 제거 (Next.js 기본값이 SAMEORIGIN 이라 외부 iframe 차단됨)
    res.headers.delete('X-Frame-Options');
    res.headers.set('Content-Security-Policy', "frame-ancestors *");
  }

  // ── 2-3. 개발 전용: 어드민 우회 토글 쿠키 발급/해제 (프로덕션 완전 차단) ──
  if (isDev && pathname === '/api/debug/dev-admin-login') {
    const mode = request.nextUrl.searchParams.get('mode') || 'on';
    const res = NextResponse.json({
      ok: true,
      dev_admin_bypass: mode !== 'off',
      message:
        mode === 'off'
          ? 'dev admin bypass disabled'
          : 'dev admin bypass enabled',
    });
    if (mode === 'off') {
      res.cookies.set('ys-dev-admin', '', { path: '/', maxAge: 0 });
      res.cookies.set('sb-refresh-token-present', '', { path: '/', maxAge: 0 });
    } else {
      res.cookies.set('ys-dev-admin', '1', {
        httpOnly: false,
        secure: isSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: 4 * 60 * 60, // 4h
      });
    }
    return res;
  }

  // ── 3. 공개 경로 → 쿠키 설정된 응답 반환 ──────────────────
  if (isPublicPath(request)) {
    return response || NextResponse.next();
  }

  if (!hasKnownTopLevelRoute(pathname)) {
    return response || NextResponse.next();
  }

  const dynamicNotFound = await getPublicDynamicNotFoundResponse(pathname);
  if (dynamicNotFound) return dynamicNotFound;

  // ── 3-0. 서버-to-서버 API 호출은 아래 x-admin-token 검증만 허용 ──

  // ── 3-1. /api/admin/* — x-admin-token 헤더 검증 (서버-to-서버 호출용) ──────
  // 크론 작업 등이 Supabase 세션 없이 ADMIN_API_TOKEN으로 인증할 수 있게 함.
  // 토큰이 있으면 검증 후 통과/거부. 토큰이 없으면 아래 Supabase JWT 인증으로 fall through.
  if (pathname.startsWith('/api/admin/') || pathname === '/api/agent/prompt-optimizer') {
    const adminTokenHeader = request.headers.get('x-admin-token');
    if (adminTokenHeader) {
      const { isValidAdminApiToken } = await import('@/lib/api-auth');
      if (isValidAdminApiToken(request)) {
        return response || NextResponse.next();
      }
      return NextResponse.json(
        { code: 'FORBIDDEN', error: '유효하지 않은 관리자 토큰입니다.' },
        { status: 403 },
      );
    }
  }

  // ── 3-2. 개발 전용: 어드민 페이지 + API 우회 쿠키 허용 (프로덕션 완전 차단) ──
  // Dev에서 ys-dev-admin 쿠키가 있으면 어드민 페이지뿐 아니라 그 페이지가 호출하는 API도 통과시킴
  // (admin 페이지 클라이언트 fetch가 /api/* 로 가기 때문)
  if (isDev && request.cookies.get('ys-dev-admin')?.value === '1') {
    return response || NextResponse.next();
  }

  // ── 3-1. 정산 PDF GET — 라우트에서 어드민 세션 또는 파트너 PIN 헤더로 검증 (비로그인 파트너용)
  if (request.method === 'GET' && /^\/api\/settlements\/[^/]+\/pdf$/.test(pathname)) {
    return response || NextResponse.next();
  }

  // 개발 전용: 세션 진단 API — 인증 전 통과 (응답에 비밀·전체 JWT 미포함)
  if (
    process.env.NODE_ENV !== 'production' &&
    (pathname === '/api/debug/auth-session' || pathname === '/api/debug/auth-session-edge')
  ) {
    return response || NextResponse.next();
  }

  // 디자인 미리보기: 프로덕션은 DESIGN_PREVIEW_SECRET 일치 시에만, 개발은 ?preview=1 만으로 허용
  const previewOn = request.nextUrl.searchParams.get('preview') === '1';
  if (previewOn) {
    const secret = getSecret('DESIGN_PREVIEW_SECRET');
    if (secret && request.nextUrl.searchParams.get('preview_secret') === secret) {
      return response || NextResponse.next();
    }
    if (process.env.NODE_ENV !== 'production') {
      return response || NextResponse.next();
    }
  }

  // ── 4. 인증 검사 (비공개 경로만) ───────────────────────────
  const token = request.cookies.get('sb-access-token')?.value;
  const refreshToken = request.cookies.get('sb-refresh-token')?.value;

  if (token && (await accessTokenAllowsRequest(token))) {
    return response || NextResponse.next();
  }

  // access 만료 시에도 refresh 가 있으면 페이지는 통과(클라이언트가 /api/auth/refresh 로 갱신)
  if (refreshToken) {
    const isApi = pathname.startsWith('/api/');
    if (!isApi) {
      return response || NextResponse.next();
    }
    return NextResponse.json({ error: 'token expired' }, { status: 401 });
  }

  // 모바일 /m/admin 은 전용 로그인 페이지로 유도
  const isMobile = pathname.startsWith('/m/admin');
  const loginPath = isMobile ? '/m/admin/login' : '/login';
  const loginUrl = new URL(loginPath, request.url);
  loginUrl.searchParams.set('redirect', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // 세션 쿠키 + 인증이 필요한 모든 페이지 (정적 파일 + SEO 파일 + Next.js 데이터 fetch 제외)
    // _next/data: 클라이언트 사이드 페이지 이동 시 Next.js가 자동 fetch — 미들웨어 통과 시 Edge Request 2배
    '/((?!_next/static|_next/data|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|mjs|woff2?|ttf|eot|map|txt|json)).*)',
  ],
};
