import { NextRequest, NextResponse } from 'next/server';

// 인증 없이 접근 가능한 경로
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/packages',
  '/auth/callback',
  '/auth/reset-password',
  '/api/auth/session',
  '/api/qa/chat',
  '/api/sms/receive',
  '/api/notify/alimtalk',
  '/api/slack-webhook',
  '/api/exchange-rate',
  '/api/cron/meta-optimize',
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
  // 단체여행 RFQ (고객 인터뷰 → 공고 → 채팅 → 계약)
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
  // 인플루언서 포털 (자체 PIN 인증)
  '/influencer',
  '/api/influencer',
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

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // 디자인 미리보기 바이패스 (?preview=1)
  if (request.nextUrl.searchParams.get('preview') === '1') {
    return NextResponse.next();
  }

  const token = request.cookies.get('sb-access-token')?.value;

  if (!token || !isTokenValid(token)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/api/:path*',
    '/auth/:path*',
    '/tenant/:path*',
    '/share/:path*',
    '/rfq/:path*',
    '/group-inquiry/:path*',
  ],
};
