import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { notifySlack } from '@/lib/slack-notifier';
import { withCronGuard } from '@/lib/cron-auth';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

/**
 * GET /api/cron/payment-rules-learn
 *
 * 일별 cron — payment_command_log 누적 → payment_command_rules 동기화.
 * 입금 + user_corrected=false + 분기 A + 3회+ 패턴이 자동 학습 룰로 등록.
 *
 * 향후 resolver 가 후보 점수 계산 시 룰 매치 가산 신호로 활용 (Phase 5).
 */
export const dynamic = 'force-dynamic';
const getHandler = async (req: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ ok: false, error: 'Supabase not configured' }, { status: 500 });
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
    return apiResponse(data);
  } catch (err) {
    return apiResponse(
      { ok: false, error: sanitizeDbError(err, 'Learning failed') },
      { status: 500 },
    );
  }
}

export const GET = withCronGuard(getHandler);
