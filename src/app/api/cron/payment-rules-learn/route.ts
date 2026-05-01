import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { notifySlack } from '@/lib/slack-notifier';

/**
 * GET /api/cron/payment-rules-learn
 *
 * 일별 cron — payment_command_log 누적 → payment_command_rules 동기화.
 * 입금 + user_corrected=false + 분기 A + 3회+ 패턴이 자동 학습 룰로 등록.
 *
 * 향후 resolver 가 후보 점수 계산 시 룰 매치 가산 신호로 활용 (Phase 5).
 */
export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 500 });
  }

  const minCount = Number(req.nextUrl.searchParams.get('min_count')) || 3;
  const lookbackDays = Number(req.nextUrl.searchParams.get('lookback_days')) || 90;

  try {
    const { data, error } = await supabaseAdmin.rpc('learn_payment_rules', {
      p_min_count: minCount,
      p_lookback_days: lookbackDays,
    });
    if (error) throw error;
    const result = data as { inserted?: number; updated?: number };
    if ((result?.inserted ?? 0) > 0) {
      notifySlack(
        'rules-learned',
        `새 매칭 학습 룰 ${result.inserted}건 등록 (업데이트 ${result.updated ?? 0}건)`,
        { lookback_days: lookbackDays, min_count: minCount },
      ).catch(() => {});
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : '학습 실패' },
      { status: 500 },
    );
  }
}
