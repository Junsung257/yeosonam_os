/**
 * 마케팅 크론 API
 * GET /api/marketing/cron
 *
 * 정기 마케팅 작업(runMarketingCron)을 호출하고 결과를 JSON으로 반환한다.
 *
 * Vercel Cron: Add to vercel.json:
 * {
 *   "crons": [
 *     {
 *       "path": "/api/marketing/cron",
 *       "schedule": "0 6 * * *"
 *     }
 *   ]
 * }
 *
 * 매일 오전 6시(KST)에 실행된다.
 * Authorization: Bearer ${CRON_SECRET} 헤더 또는 ?secret= 쿼리 파라미터로 인증한다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { runMarketingCron } from '@/lib/marketing-cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * 마케팅 크론 트리거
 *
 * 5단계 마케팅 작업을 순차 실행하고 단계별 결과를 반환한다.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();

  try {
    const result = await runMarketingCron();
    const status = result.overallSuccess ? 200 : 207;
    return NextResponse.json(result, { status });
  } catch (err) {
    const message = err instanceof Error ? err.message : '마케팅 크론 처리 실패';
    console.error('[MarketingCron-API] 예상치 못한 오류:', message);
    return NextResponse.json(
      {
        ok: false,
        error: message,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
