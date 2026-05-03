import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { refillWeeklyQueue, assignPublishSlots, DEFAULT_POSTS_PER_DAY } from '@/lib/blog-scheduler';
import { ensureAllDestinationsHavePillar } from '@/lib/blog-pillar-generator';

/**
 * 블로그 스케줄러 크론 — 매주 월요일 0시 실행
 *
 * 수행:
 *   1) 시즌 토픽 재생성 (분기별 AI 시즌 캘린더 업데이트)
 *   2) 이번 주 큐 충전 (정보성 70% + 상품 30%)
 *   3) 각 항목에 target_publish_at 슬롯 할당 (하루 6개, 2시간 간격)
 */
export const dynamic = 'force-dynamic';
export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ skipped: true, reason: 'Supabase 미설정' });
  }

  try {
    // Pillar Page 자동 체크 (활성 destination 중 pillar 없는 곳 큐잉)
    const pillarResult = await ensureAllDestinationsHavePillar();

    const result = await refillWeeklyQueue({ postsPerDay: DEFAULT_POSTS_PER_DAY });
    const slotAssignment = await assignPublishSlots(DEFAULT_POSTS_PER_DAY);

    return NextResponse.json({
      ok: true,
      pillars: pillarResult,
      refill: result,
      slot_assignment: slotAssignment,
      ranAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[blog-scheduler] 오류:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '스케줄러 실패' },
      { status: 500 },
    );
  }
}
