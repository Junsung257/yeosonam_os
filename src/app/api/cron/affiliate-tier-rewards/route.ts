import { NextRequest, NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { reportAffiliateCronFailure, reportAffiliateCronSuccess } from '@/lib/affiliate/cron-monitor';

export const dynamic = 'force-dynamic';

const TIER_BY_BOOKINGS = [
  { min: 100, tier: 5, reward: 300000 },
  { min: 50, tier: 4, reward: 150000 },
  { min: 30, tier: 3, reward: 70000 },
  { min: 10, tier: 2, reward: 30000 },
];

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: true, skipped: 'DB 미설정' });
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  try {

    const { data: affiliates, error } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, grade, booking_count, is_active')
      .eq('is_active', true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let promoted = 0;
    const rewardEvents: Array<{ affiliate_id: string; to_tier: number; reward: number }> = [];
    for (const a of (affiliates || []) as Array<{ id: string; name: string; grade: number; booking_count: number }>) {
      const target = TIER_BY_BOOKINGS.find((t) => (a.booking_count || 0) >= t.min);
      if (!target) continue;
      if ((a.grade || 1) >= target.tier) continue;

      const { error: upErr } = await supabaseAdmin
        .from('affiliates')
        .update({ grade: target.tier, updated_at: new Date().toISOString() })
        .eq('id', a.id);
      if (upErr) continue;

      await supabaseAdmin.from('affiliate_reward_events').insert({
        affiliate_id: a.id,
        event_type: 'tier_up',
        points: target.tier * 100,
        reward_amount: target.reward,
        payload: {
          from_tier: a.grade || 1,
          to_tier: target.tier,
          booking_count: a.booking_count || 0,
        },
      } as never);

      await supabaseAdmin.from('agent_actions').insert({
        action_type: 'send_alimtalk',
        status: 'pending',
        priority: 'normal',
        summary: `[티어 승급] ${a.name}님 T${a.grade || 1}→T${target.tier}, 리워드 ${target.reward.toLocaleString()}원`,
        payload: {
          template: 'affiliate_tier_up',
          affiliate_id: a.id,
          data: { from_tier: a.grade || 1, to_tier: target.tier, reward_amount: target.reward },
        },
      } as never);

      promoted += 1;
      rewardEvents.push({ affiliate_id: a.id, to_tier: target.tier, reward: target.reward });
    }

    await reportAffiliateCronSuccess('affiliate-tier-rewards', { promoted });
    return NextResponse.json({ ok: true, promoted, reward_events: rewardEvents });
  } catch (err) {
    await reportAffiliateCronFailure('affiliate-tier-rewards', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'affiliate tier rewards failed' },
      { status: 500 },
    );
  }
}

