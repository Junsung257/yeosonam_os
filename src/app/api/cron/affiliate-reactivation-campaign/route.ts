import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { requireCronBearer } from '@/lib/cron-auth';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { reportAffiliateCronFailure, reportAffiliateCronSuccess } from '@/lib/affiliate/cron-monitor';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = requireCronBearer(request);
  if (authError) return authError;
  if (!isSupabaseConfigured) return apiResponse({ ok: true, skipped: 'DB 미설정' });

  const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data: affiliates, error } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, referral_code, is_active')
      .eq('is_active', true);
    if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
    if (!affiliates?.length) {
      await reportAffiliateCronSuccess('affiliate-reactivation-campaign', { drafted: 0, reason: 'no_active_affiliates' });
      return apiResponse({ ok: true, drafted: 0 });
    }

    let drafted = 0;
    const affList = affiliates as Array<{ id: string; name: string; referral_code: string }>;

    // chunk=10 병렬 — 각 어필리에이트 독립, 외부 API 없음.
    // count + exists 체크를 Promise.all 로 묶어 round-trip 추가 절감.
    const CHUNK = 10;
    async function processAffiliate(a: typeof affList[number]) {
      const [clicksRes, existsRes] = await Promise.all([
        supabaseAdmin
          .from('affiliate_touchpoints')
          .select('id', { count: 'exact', head: true })
          .eq('referral_code', a.referral_code)
          .eq('is_bot', false)
          .eq('is_duplicate', false)
          .gte('clicked_at', since14),
        supabaseAdmin
          .from('agent_actions')
          .select('id')
          .eq('action_type', 'send_alimtalk')
          .contains('payload', { template: 'affiliate_reactivation', affiliate_id: a.id })
          .gte('created_at', since14)
          .maybeSingle(),
      ]);
      if ((clicksRes.count || 0) > 0) return;
      if (existsRes.data) return;

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

    for (let i = 0; i < affList.length; i += CHUNK) {
      const batch = affList.slice(i, i + CHUNK);
      await Promise.allSettled(batch.map(processAffiliate));
    }

    await reportAffiliateCronSuccess('affiliate-reactivation-campaign', { drafted });
    return apiResponse({ ok: true, drafted });
  } catch (err) {
    await reportAffiliateCronFailure('affiliate-reactivation-campaign', err, { since14 });
    return apiResponse({ error: sanitizeDbError(err, 'affiliate reactivation campaign failed') }, { status: 500 });
  }
}

