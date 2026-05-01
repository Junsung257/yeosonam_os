import { NextRequest, NextResponse } from 'next/server';

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
  // concierge 개별 엔드포인트
  '/api/concierge/search',
  '/api/concierge/cart',
  '/api/concierge/checkout',
  // 기타
  '/api/tenant/rfqs',
  '/api/tracking/recommendation',
]);

// 하위 경로까지 공개가 필요한 prefix — 짧은 배열, 정확 일치 실패 시에만 검사
const PUBLIC_PREFIXES = [
  '/packages/',
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
];

// 짧은 정확 일치 경로 (prefix 배열 없이 Set에 포함)
const PUBLIC_EXACT_SHORT = new Set([
  '/blog', '/api/blog', '/products', '/concierge', '/tenant', '/share',
  '/api/share', '/api/attractions', '/group', '/rfq', '/api/rfq',
  '/api/tracking', '/api/og', '/influencer', '/api/influencer',
  '/r', '/embed', '/partner-apply', '/api/partner-apply',
  '/api/recommendations', '/destinations', '/review', '/api/reviews',
  '/free-travel', '/api/free-travel', '/blog/destination',
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

// JWT 페이로드를 로컬에서 디코딩해 만료 여부 확인 (네트워크 콜 없음)
function isTokenValid(token: string): boolean {
  try {
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) return false;
    const payload = JSON.parse(atob(payloadBase64));
    return typeof payload.exp === 'number' && payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
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
  // 사장님 결정(2026-04-26): 동의 배너 미노출 → 추적 쿠키는 암묵 동의로 30일 발급.
  // PIPA 2026-09 시행 시 동의 검사 재도입 검토. (consent.ts 의 hasMarketingConsent 함수는 보존)
  const ref = request.nextUrl.searchParams.get('ref');
  if (ref) {
    const res = getResponse();
    res.cookies.set('aff_ref', ref, {
      httpOnly: false,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30일
      path: '/',
    });
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

  // 디자인 미리보기 바이패스 (?preview=1)
  if (request.nextUrl.searchParams.get('preview') === '1') {
    return response || NextResponse.next();
  }

  // ── 4. 인증 검사 (비공개 경로만) ───────────────────────────
  const token = request.cookies.get('sb-access-token')?.value;
  const refreshToken = request.cookies.get('sb-refresh-token')?.value;

  // access token 이 유효하면 통과
  if (token && isTokenValid(token)) {
    return response || NextResponse.next();
  }

  // access token 이 만료되었더라도 refresh token 이 있으면 통과.
  // 클라이언트 훅(useAutoRefreshSession) 이 백그라운드로 /api/auth/refresh 를 호출해 갱신한다.
  // API 라우트 요청이라면 client-side 훅이 동작하지 않으므로 401 을 반환해 재시도 유도.
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
    // 세션 쿠키 + 인증이 필요한 모든 페이지 (정적 파일 + SEO 파일 제외)
    '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf|eot|map)).*)',
  ],
};
