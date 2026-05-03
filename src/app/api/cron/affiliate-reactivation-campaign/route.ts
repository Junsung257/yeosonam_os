import { NextRequest, NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { reportAffiliateCronFailure, reportAffiliateCronSuccess } from '@/lib/affiliate/cron-monitor';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: true, skipped: 'DB 미설정' });
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data: affiliates, error } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, referral_code, is_active')
      .eq('is_active', true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!affiliates?.length) {
      await reportAffiliateCronSuccess('affiliate-reactivation-campaign', { drafted: 0, reason: 'no_active_affiliates' });
      return NextResponse.json({ ok: true, drafted: 0 });
    }

    let drafted = 0;
    for (const a of affiliates as Array<{ id: string; name: string; referral_code: string }>) {
      const { count: clicks14 } = await supabaseAdmin
        .from('affiliate_touchpoints')
        .select('id', { count: 'exact', head: true })
        .eq('referral_code', a.referral_code)
        .eq('is_bot', false)
        .eq('is_duplicate', false)
        .gte('clicked_at', since14);

      if ((clicks14 || 0) > 0) continue;

      const { data: exists } = await supabaseAdmin
        .from('agent_actions')
        .select('id')
        .eq('action_type', 'send_alimtalk')
        .contains('payload', { template: 'affiliate_reactivation', affiliate_id: a.id })
        .gte('created_at', since14)
        .maybeSingle();
      if (exists) continue;

      await supabaseAdmin.from('agent_actions').insert({
        action_type: 'send_alimtalk',
        status: 'pending',
        priority: 'normal',
        summary: `[휴면복귀] ${a.name}님 14일 무클릭 — 복귀 보너스 안내`,
        payload: {
          template: 'affiliate_reactivation',
          affiliate_id: a.id,
          data: {
            bonus_krw: 50000,
            message: '지금 복귀하시면 첫 건 수수료에 5만원 보너스를 드립니다.',
          },
        },
      } as never);
      drafted += 1;
    }

    await reportAffiliateCronSuccess('affiliate-reactivation-campaign', { drafted });
    return NextResponse.json({ ok: true, drafted });
  } catch (err) {
    await reportAffiliateCronFailure('affiliate-reactivation-campaign', err, { since14 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'affiliate reactivation campaign failed' },
      { status: 500 },
    );
  }
}

