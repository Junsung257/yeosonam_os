/**
 * POST /api/m/[token]/confirm
 *
 * 매직링크 POST-confirm 게이트.
 *   1. 토큰 verify + confirmed_at 기록 (멱등)
 *   2. magic-session 쿠키 발급 (httpOnly, HMAC 서명, 컨텍스트·스코프 박힘)
 *   3. action_type 별 액션 페이지로 302 리다이렉트
 *
 * 보안:
 *   - rate-limit (IP 기준 1분 10회 — 폼 제출 abuse 방지)
 *   - 인증 불필요 (매직링크 자체가 인증 수단)
 *   - 같은 토큰 multi-click 은 멱등 (confirmed_at 이미 있으면 그대로 통과)
 *   - confirm 만으로는 single_use 토큰 소진 X — 실제 액션 페이지가 consumeMagicToken 호출.
 */

import { NextRequest, NextResponse } from 'next/server';
import { confirmMagicToken } from '@/lib/magic-link';
import { actionPageUrlFor } from '@/lib/magic-link-routing';
import {
  issueMagicSessionToken,
  magicSessionCookieOptions,
  defaultScopesForAction,
  MAGIC_SESSION_COOKIE,
} from '@/lib/magic-session';
import { rateLimit, extractClientIp } from '@/lib/rate-limiter';
import { recordMagicLinkAudit } from '@/lib/magic-link-audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(req, {
    limit: 10,
    window: 60,
    prefix: 'rl-magic-confirm',
    keyFn: (r) => `${extractClientIp(r)}`,
  });
  if (limited) {
    await recordMagicLinkAudit({
      event: 'rate_limited',
      ip: extractClientIp(req),
      ua: req.headers.get('user-agent') ?? undefined,
      metadata: { route: '/api/m/[token]/confirm' },
    });
    return limited;
  }

  const { token } = await ctx.params;
  const ip = extractClientIp(req);
  const ua = req.headers.get('user-agent') ?? undefined;

  const result = await confirmMagicToken(token, { ip, ua });

  if (!result.ok) {
    // 에러 시에도 fragile UX 가 되지 않게 착지 페이지로 다시 보냄 (에러 표시)
    const target = new URL(`/m/link/${encodeURIComponent(token)}`, req.url);
    return NextResponse.redirect(target, { status: 303 });
  }

  const t = result.token;
  const targetPath = actionPageUrlFor(t);

  // magic-session 쿠키 발급 (자비스 통합 + 액션 페이지 인증)
  const ttlSec = sessionTtlSecFor(t.actionType);
  const { token: sessionToken, maxAgeSec } = issueMagicSessionToken({
    aid: t.id,
    act: t.actionType,
    tid: t.tenantId,
    bid: t.bookingId,
    cid: t.customerId,
    scope: defaultScopesForAction(t.actionType),
    ttlSec,
  });

  const response = NextResponse.redirect(new URL(targetPath, req.url), { status: 303 });
  response.cookies.set(MAGIC_SESSION_COOKIE, sessionToken, magicSessionCookieOptions(maxAgeSec));

  return response;
}

/**
 * action_type 별 magic-session TTL (분 단위 변환은 호출자가 처리).
 * 결정·법적 책임 액션은 짧게, 정보 조회는 길게.
 */
function sessionTtlSecFor(actionType: import('@/lib/magic-link').MagicActionType): number {
  switch (actionType) {
    case 'payment_balance':
      return 30 * 60; // 30분 — 결제 진행 시간
    case 'itinerary_consent':
      return 30 * 60; // 30분 — 동의 확정
    case 'passport_upload':
      return 60 * 60; // 60분 — 사진 촬영·OCR 여유
    case 'review_request':
      return 24 * 60 * 60; // 24h — 리뷰는 천천히
    case 'companion_input':
      return 60 * 60; // 60분 — 동반자 입력
    case 'jarvis_session':
    case 'booking_portal':
    case 'guidebook':
      return 60 * 60; // 60분 — 일반 조회·대화
  }
}
