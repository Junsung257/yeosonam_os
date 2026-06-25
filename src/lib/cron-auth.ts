import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { safeEqualString } from '@/lib/timing-safe';
import { apiResponse } from '@/lib/api-response';
import { maybeSkipCronForResourceSaver } from '@/lib/cron-resource-saver';

/**
 * Vercel Cron은 `Authorization: Bearer ${CRON_SECRET}` 를 붙이고,
 * 수동 호출은 `?secret=` 로도 맞출 수 있게 허용한다.
 * CRON_SECRET 미설정 시에는 통과(로컬 개발 편의) — 프로덕션에서는 반드시 설정할 것.
 */
export function isCronAuthorized(request: NextRequest | Request): boolean {
  const secret = getSecret('CRON_SECRET');
  if (!secret) return process.env.NODE_ENV !== 'production';
  const authHeader = request.headers.get('authorization');
  const url = request instanceof NextRequest ? request.nextUrl : new URL(request.url);
  const querySecret = url.searchParams.get('secret');
  return safeEqualString(authHeader, `Bearer ${secret}`) || safeEqualString(querySecret, secret);
}

/**
 * Vercel 스케줄(`x-vercel-cron: 1`) 또는 CRON_SECRET(Bearer·?secret=) 일치 시 허용.
 * CRON_SECRET 미설정 시 Vercel 헤더 없으면 거부 — 일부 엔드포인트는 수동 호출을 막기 위함.
 */
export function isCronOrVercelAuthorized(request: NextRequest | Request): boolean {
  if (request.headers.get('x-vercel-cron') === '1') return true;
  if (!getSecret('CRON_SECRET')) return false;
  return isCronAuthorized(request);
}

export function cronUnauthorizedResponse(): NextResponse {
  const res = apiResponse(
    { ok: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
    { status: 401 },
  );
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/**
 * 공개 미들웨어에 노출된 크론 엔드포인트용.
 * CRON_SECRET 이 있으면 항상 Bearer 일치 필요(force 쿼리 포함).
 */
export function requireCronBearer(request: NextRequest): NextResponse | null {
  const secret = getSecret('CRON_SECRET');
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      const res = apiResponse(
        { ok: false, error: { code: 'CRON_UNAVAILABLE', message: 'Cron endpoint unavailable' } },
        { status: 503 },
      );
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }
    return null;
  }
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  return null;
}

type NextHandler = (req: NextRequest, ctx?: any) => Promise<NextResponse>;

function inferCronName(request: NextRequest): string {
  const parts = request.nextUrl.pathname.split('/').filter(Boolean);
  const cronIndex = parts.lastIndexOf('cron');
  return cronIndex >= 0 ? parts[cronIndex + 1] ?? 'unknown-cron' : parts.at(-1) ?? 'unknown-cron';
}

/**
 * Cron 엔드포인트 래퍼. requireCronBearer() 검증 후 핸들러 실행.
 * 동적 라우트([id] 등)의 ctx 파라미터도 지원.
 *
 * 사용:
 *   export const GET = withCronGuard(async (req) => {
 *     return NextResponse.json({ ok: true });
 *   });
 */
export function withCronGuard(handler: NextHandler): NextHandler {
  return async (req: NextRequest, ctx?: any): Promise<NextResponse> => {
    const authError = requireCronBearer(req);
    if (authError) return authError;
    const resourceSaver = maybeSkipCronForResourceSaver(req, inferCronName(req));
    if (resourceSaver) return resourceSaver as NextResponse;
    return ctx ? handler(req, ctx) : handler(req);
  };
}
