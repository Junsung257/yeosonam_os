import { NextRequest, NextResponse } from 'next/server';

/**
 * 공개 미들웨어에 노출된 크론 엔드포인트용.
 * CRON_SECRET 이 있으면 항상 Bearer 일치 필요(force 쿼리 포함).
 */
export function requireCronBearer(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'CRON_SECRET 미설정 — 프로덕션 크론 비활성' },
        { status: 500 }
      );
    }
    return null;
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
