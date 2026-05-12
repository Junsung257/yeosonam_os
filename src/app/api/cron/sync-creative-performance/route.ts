/**
 * GET /api/cron/sync-creative-performance
 * 매일 자정(UTC 00:00 = KST 09:00) 실행
 * 1. Meta/네이버/구글 소재별 성과 수집
 * 2. winning_patterns 업데이트 (학습 엔진)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { dailySync } from '@/lib/creative-engine/sync-performance';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  try {
    console.log('[CRON] sync-creative-performance 시작');
    const result = await dailySync();

    console.log(`[CRON] 완료: Meta ${result.meta}건, Naver ${result.naver}건, Google ${result.google}건, 패턴 ${result.patterns.updated}건 업데이트`);

    return NextResponse.json({
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
    console.error('[CRON] sync-creative-performance 실패:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '성과 수집 실패' },
      { status: 500 }
    );
  }
}
