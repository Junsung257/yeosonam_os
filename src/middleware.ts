import { NextRequest, NextResponse } from 'next/server';

// 인증 없이 접근 가능한 경로
const PUBLIC_PATHS = [
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
  '/api/cron/meta-optimize',
  '/api/cron/visual-baseline-monitor',
  '/api/cron/journey-scheduler',
  '/api/cron/rfq-timeout',
  '/api/concierge/search',
  '/api/concierge/cart',
  '/api/concierge/checkout',
  '/concierge',
  '/tenant',
  '/share',
  '/api/share',
  '/api/packages',
  '/api/attractions',
  // Programmatic SEO (Booking.com 패턴 — 공개)
  '/things-to-do',
  // Phase 1.5 IR 파이프 (Canary) — 내부 admin CLI/Agent 호출용
  '/api/register-via-ir',
  '/api/audit-pkg-to-ir',
  '/api/register-via-assembler',
  // 단체여행 RFQ (고객 인터뷰 → 공고 → 채팅 → 계약)
  '/group',
  '/group-inquiry',
  '/rfq',
  '/api/rfq',
  '/api/tenant/rfqs',
  // 광고 트래킹 (비회원 이벤트 수집 필요)
  '/api/tracking',
  // 크론 (서버-to-서버 호출)
  '/api/cron/post-travel',
  '/api/cron/ad-optimizer',
  '/api/cron/settlement-auto',
  '/api/cron/sync-creative-performance',
  '/api/cron/auto-archive',
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
  // Meta webhook (GET verify + POST event). 서명 검증 내부에서 수행.
  '/api/webhooks/instagram',
  '/api/webhooks/threads',
  // 인플루언서 포털 (자체 PIN 인증)
  '/influencer',
  '/api/influencer',
  // 어필리에이터 단축링크 + 임베드 위젯 + 동적 OG 이미지
  '/r',
  '/embed',
  '/api/og',
  // 파트너 신청 (공개)
  '/partner-apply',
  '/api/partner-apply',
  // 고객용 상품 페이지 (공개)
  '/products',
  // 추천 API (비회원도 사용)
  '/api/recommendations',
  // 카카오 웹훅 (외부 수신)
  '/api/webhooks/kakao',
  // 블로그 (공개 콘텐츠)
  '/blog',
  '/blog/destination',
  '/api/blog',
  '/api/rss',
  '/api/blog-engagement',
  // 여행지 허브 (공개 Pillar)
  '/destinations',
  // 리뷰 수집 + 조회 (고객용, booking_id 기반 인증)
  '/review',
  '/api/reviews',
  // ISR 캐시 무효화 (시크릿 기반 인증)
  '/api/revalidate',
];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
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
  if (isPublicPath(pathname)) {
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
