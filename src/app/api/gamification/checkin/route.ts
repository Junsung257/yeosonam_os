/**
 * 출석 체크 API
 *
 * POST /api/gamification/checkin  — 출석 체크 + 보상 지급
 * GET  /api/gamification/checkin  — 오늘 출석 여부 확인
 */
import { NextRequest, NextResponse } from 'next/server';
import { doCheckin, getStreakInfo } from '@/lib/gamification-service';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const { supabase } = await import('@/lib/supabase');
    const sb = await supabase();
    const { data: { user } } = await sb.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await doCheckin(user.id);

    if (result.reward === 0 && !result.bonusAwarded && result.newBadges.length === 0) {
      // 이미 출석한 경우
      return NextResponse.json({
        alreadyCheckedIn: true,
        streak: result.streak,
        message: '오늘 이미 출석 체크하셨습니다',
      });
    }

    return NextResponse.json({
      alreadyCheckedIn: false,
      reward: result.reward,
      bonusAwarded: result.bonusAwarded,
      newBadges: result.newBadges,
      streak: result.streak,
      message: result.bonusAwarded
        ? `🎉 출석 체크 완료! +${result.reward}P (연속 보너스 포함)`
        : `✅ 출석 체크 완료! +${result.reward}P`,
    });
  } catch (error) {
    console.error('[Checkin] 오류:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const { supabase } = await import('@/lib/supabase');
    const sb = await supabase();
    const { data: { user } } = await sb.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const streak = await getStreakInfo(user.id);

    return NextResponse.json({ streak });
  } catch (error) {
    console.error('[Streak] 오류:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
