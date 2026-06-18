/**
 * GET /api/cron/sync-creative-performance
 * 매일 자정(UTC 00:00 = KST 09:00) 실행
 * 1. Meta/네이버/구글 소재별 성과 수집
 * 2. winning_patterns 업데이트 (학습 엔진)
 */

import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { logAndSanitize } from '@/lib/error-sanitizer';
import { dailySync } from '@/lib/creative-engine/sync-performance';
import { maybeSkipNonCriticalCron } from '@/lib/cron-resource-saver';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  const resourceSaver = maybeSkipNonCriticalCron(request, 'sync-creative-performance');
  if (resourceSaver) return resourceSaver;

  try {
    console.log('[CRON] sync-creative-performance start');
    const result = await dailySync();

    console.log(
      `[CRON] sync-creative-performance complete: meta=${result.meta}, naver=${result.naver}, google=${result.google}, patterns=${result.patterns.updated}`,
    );

    return apiResponse({
      ok: true,
      timestamp: new Date().toISOString(),
      synced: {
        meta: result.meta,
        naver: result.naver,
        google: result.google,
      },
      patterns: result.patterns,
    });
  } catch (error) {
    return apiResponse(
      { ok: false, error: logAndSanitize('cron sync-creative-performance', error, 'Performance sync failed') },
      { status: 500 }
    );
  }
}
