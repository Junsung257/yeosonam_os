import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withCronGuard } from '@/lib/cron-auth';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { reportAffiliateCronFailure, reportAffiliateCronSuccess } from '@/lib/affiliate/cron-monitor';

export const dynamic = 'force-dynamic';

const TIER_BY_BOOKINGS = [
  { min: 100, tier: 5, reward: 300000 },
  { min: 50, tier: 4, reward: 150000 },
  { min: 30, tier: 3, reward: 70000 },
  { min: 10, tier: 2, reward: 30000 },
];

const getHandler = async (_request: NextRequest) => {
  if (!isSupabaseConfigured) return apiResponse({ ok: true, skipped: 'DB 미설정' });
  try {

    const { data: affiliates, error } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, grade, booking_count, is_active')
      .eq('is_active', true);
    if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });

    let promoted = 0;
    const rewardEvents: Array<{ affiliate_id: string; to_tier: number; reward: number }> = [];
    const affList = (affiliates || []) as Array<{ id: string; name: string; grade: number; booking_count: number }>;

    // 어필리에이트별 처리 — 각 작업이 독립이고 외부 API 호출 없음. chunk=10 동시성.
    const CHUNK = 10;
    async function processAffiliate(a: typeof affList[number]) {
      const target = TIER_BY_BOOKINGS.find((t) => (a.booking_count || 0) >= t.min);
      if (!target) return;
      if ((a.grade || 1) >= target.tier) return;

      const { error: upErr } = await supabaseAdmin
        .from('affiliates')
        .update({ grade: target.tier, updated_at: new Date().toISOString() })
        .eq('id', a.id);
      if (upErr) return;

      // 보상 이벤트 + 알림톡 큐는 서로 독립 → 병렬
      await Promise.all([
        supabaseAdmin.from('affiliate_reward_events').insert({
          affiliate_id: a.id,
          event_type: 'tier_up',
          points: target.tier * 100,
          reward_amount: target.reward,
          payload: {
            from_tier: a.grade || 1,
            to_tier: target.tier,
            booking_count: a.booking_count || 0,
          },
        } as never),
        supabaseAdmin.from('agent_actions').insert({
          action_type: 'send_alimtalk',
          status: 'pending',
          priority: 'normal',
          summary: `[티어 승급] ${a.name}님 T${a.grade || 1}→T${target.tier}, 리워드 ${target.reward.toLocaleString()}원`,
          payload: {
            template: 'affiliate_tier_up',
            affiliate_id: a.id,
            data: { from_tier: a.grade || 1, to_tier: target.tier, reward_amount: target.reward },
          },
        } as never),
      ]);

      promoted += 1;
      rewardEvents.push({ affiliate_id: a.id, to_tier: target.tier, reward: target.reward });
    }

    for (let i = 0; i < affList.length; i += CHUNK) {
      const batch = affList.slice(i, i + CHUNK);
      await Promise.allSettled(batch.map(processAffiliate));
    }

    await reportAffiliateCronSuccess('affiliate-tier-rewards', { promoted });
    return apiResponse({ ok: true, promoted, reward_events: rewardEvents });
  } catch (err) {
    await reportAffiliateCronFailure('affiliate-tier-rewards', err);
    return apiResponse(
      { error: sanitizeDbError(err, 'affiliate tier rewards failed') },
      { status: 500 },
    );
  }
};

export const GET = withCronGuard(getHandler);

