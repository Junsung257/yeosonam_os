import { NextRequest, NextResponse } from 'next/server';

/**
 * Vercel Cron 엔트리포인트
 * 스케줄: 0 0 * * * (UTC 00:00 = KST 09:00)
 * vercel.json에서 설정
 *
 * Vercel은 CRON_SECRET 환경변수가 설정된 경우
 * Authorization: Bearer <CRON_SECRET> 헤더를 자동으로 첨부합니다.
 */
export async function GET(request: NextRequest) {
  // CRON_SECRET 검증
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: '인증 실패' }, { status: 401 });
    }
  }

  try {
    // 내부적으로 optimize API 로직을 직접 호출
    const optimizeResponse = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/meta/optimize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    );

    const result = await optimizeResponse.json();

    console.log(
      `[META CRON] ${new Date().toISOString()} — ` +
      `처리: ${result.processed ?? 0}개, ` +
      `일시정지: ${result.paused?.length ?? 0}개, ` +
      `예산증액: ${result.scaled?.length ?? 0}개, ` +
      `오류: ${result.errors?.length ?? 0}개`
    );

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error('[META CRON] 자동 최적화 실패:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '크론 실행 실패' },
      { status: 500 }
    );
  }
}
