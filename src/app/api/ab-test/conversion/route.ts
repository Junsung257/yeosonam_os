import { NextRequest, NextResponse } from 'next/server';
import { recordConversion } from '@/lib/ab-test-engine';

/**
 * A/B 테스트 전환 기록 API
 *
 * POST /api/ab-test/conversion
 * Body: { experimentId: string; visitorId: string; variantId: string; eventType: string }
 *
 * 클라이언트(AbTestTracker)에서 스크롤 깊이/CTA 클릭 시 호출.
 * recordConversion은 서버 전용 함수이므로 API 라우트를 통해 우회.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { experimentId, visitorId } = body;

    if (!experimentId || !visitorId) {
      return NextResponse.json({ error: 'experimentId와 visitorId는 필수입니다.' }, { status: 400 });
    }

    // 기록 실패는 무시 (비파괴)
    await recordConversion(experimentId, visitorId).catch(() => {});

    return NextResponse.json({ recorded: true });
  } catch {
    return NextResponse.json({ error: '변환 기록 실패' }, { status: 500 });
  }
}
