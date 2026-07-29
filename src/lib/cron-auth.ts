import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { safeEqualString } from '@/lib/timing-safe';
import { apiResponse } from '@/lib/api-response';
import { maybeSkipCronForResourceSaver } from '@/lib/cron-resource-saver';
import {
  getRevenueRescueCronMode,
  isRevenueRescueCronExecutionAllowed,
} from '@/lib/revenue-rescue-capability-policy';

/**
 * Cron 인증은 `Authorization: Bearer ${CRON_SECRET}`만 허용한다.
 * URL query와 scheduling marker header는 로그·분석 도구에 노출될 수 있으므로 인증으로 쓰지 않는다.
 * CRON_SECRET이 없는 production은 fail closed한다.
 */
export function isCronBearerAuthenticated(request: NextRequest | Request): boolean {
  const secret = getSecret('CRON_SECRET');
  if (!secret) return process.env.NODE_ENV !== 'production';
  const authHeader = request.headers.get('authorization');
  return safeEqualString(authHeader, `Bearer ${secret}`);
}

export function isCronAuthorized(request: NextRequest | Request): boolean {
  if (!isCronBearerAuthenticated(request)) return false;
  const pathname = request instanceof NextRequest ? request.nextUrl.pathname : new URL(request.url).pathname;
  return isRevenueRescueCronExecutionAllowed(pathname);
}

/**
 * Legacy compatibility name. The scheduling marker header is not authentication:
 * Vercel Cron must present the configured CRON_SECRET bearer like every other caller.
 */
export function isCronOrVercelAuthorized(request: NextRequest | Request): boolean {
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

export function cronCapabilityDisabledResponse(): NextResponse {
  const res = apiResponse(
    {
      ok: false,
      error: {
        code: 'CRON_CAPABILITY_DISABLED',
        message: 'Cron capability unavailable',
      },
    },
    { status: 503 },
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
  if (!isCronBearerAuthenticated(request)) {
    return cronUnauthorizedResponse();
  }
  if (getRevenueRescueCronMode(request.nextUrl.pathname) === 'disabled') {
    return cronCapabilityDisabledResponse();
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
