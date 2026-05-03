import { NextRequest, NextResponse } from 'next/server';
import { looksLikeReferralCode, normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { getAffiliateRefCookieMaxAgeSec } from '@/lib/affiliate-ref-cookie-policy';
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';

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
  '/packages',
  '/auth/callback',
  '/auth/reset-password',
  '/api/auth/session',
  '/api/auth/refresh',
  '/m/admin/login',
  '/api/qa/chat',
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
  '/api/cron/resweep-unmatched',
  '/api/cron/embed-products',
  '/api/cron/blog-lifecycle',
  '/api/cron/blog-scheduler',
  '/api/cron/blog-publisher',
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
  '/api/cron/mrt-revenue-sync',
  '/api/cron/mrt-hotel-ranking',
  '/api/cron/variant-winner-decide',
  '/api/cron/setup-new-destinations',
  '/api/cron/free-travel-retarget',
  '/api/cron/affiliate-settlement-draft',
  '/api/cron/affiliate-anomaly-detect',
  '/api/cron/affiliate-content-24h-report',
  '/api/cron/trend-topic-miner',
  '/api/cron/rank-tracking',
  '/api/cron/topical-rebuild',
  '/api/cron/blog-daily-summary',
  '/api/cron/ledger-reconcile',
  '/api/cron/fill-attraction-photos',
  '/api/cron/agent-executor',
  '/api/cron/booking-attribution-audit',
  '/api/cron/marketing-rules',
  '/api/cron/concierge-cart-retarget',
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
  '/api/influencer/',
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

function isPublicPath(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /api/packages는 GET 요청만 PUBLIC 허용
  if (pathname === '/api/packages' || pathname.startsWith('/api/packages/')) {
    return request.method === 'GET';
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

  // ── 3. 공개 경로 → 쿠키 설정된 응답 반환 ──────────────────
  if (isPublicPath(request)) {
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
    const secret = process.env.DESIGN_PREVIEW_SECRET;
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
    '/((?!_next/static|_next/data|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf|eot|map)).*)',
  ],
};
