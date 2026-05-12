import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getAdCampaigns, upsertCampaign, getMetaCpcThreshold } from '@/lib/supabase';
import { pauseAd, updateAdsetBudget, isMetaConfigured, krwToMetaCents } from '@/lib/meta-api';
import { getRolling7DayRoas } from '@/lib/roas-calculator';
import { getRateInfo } from '@/lib/exchange-rate';
import type { OptimizeResult } from '@/types/meta-ads';
import { getSecret } from '@/lib/secret-registry';

export async function POST(_request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const result: OptimizeResult = {
    processed: 0,
    paused: [],
    scaled: [],
    errors: [],
    run_at: new Date().toISOString(),
  };

  try {
    // ACTIVE 상태 캠페인 전체 조회
    const campaigns = await getAdCampaigns({ status: 'ACTIVE' });
    const cpcThreshold = await getMetaCpcThreshold();
    const { rate: exchangeRate } = await getRateInfo();

    result.processed = campaigns.length;

    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(
      getSecret('NEXT_PUBLIC_SUPABASE_URL')!,
      getSecret('NEXT_PUBLIC_SUPABASE_ANON_KEY')!
    );

    await Promise.allSettled(
      campaigns.map(async (campaign) => {
        try {
          const rolling = await getRolling7DayRoas(campaign.id);

          // ─ Rule A: 자동 일시정지 ─────────────────────────────
          const shouldPause =
            (rolling.rolling_spend > 0 && rolling.rolling_roas_pct < 100) ||
            (rolling.avg_cpc_krw > 0 && rolling.avg_cpc_krw > cpcThreshold);

          if (shouldPause) {
            const reason =
              rolling.rolling_roas_pct < 100
                ? `7일 롤링 ROAS ${rolling.rolling_roas_pct.toFixed(1)}% < 100%`
                : `평균 CPC ${rolling.avg_cpc_krw.toLocaleString()}원 > 임계값 ${cpcThreshold.toLocaleString()}원`;

            // Meta API 일시정지 (설정된 경우)
            if (isMetaConfigured() && campaign.meta_ad_id) {
              await pauseAd(campaign.meta_ad_id);
            }

            // DB 업데이트
            await upsertCampaign({
              id: campaign.id,
              status: 'PAUSED',
              auto_pause_reason: reason,
            });

            // audit_logs 기록
            await sb.from('audit_logs').insert({
              action: 'META_AUTO_PAUSE',
              target_type: 'campaign',
              target_id: campaign.id,
              description: reason,
              before_value: { status: 'ACTIVE', roas: rolling.rolling_roas_pct },
              after_value: { status: 'PAUSED', reason },
            });

            result.paused.push({ campaign_id: campaign.id, name: campaign.name, reason });
            return;
          }

          // ─ Rule B: 예산 자동 증액 ─────────────────────────────
          const shouldScale =
            rolling.rolling_spend > 0 && rolling.rolling_roas_pct >= 200;

          if (shouldScale) {
            const oldBudget = campaign.daily_budget_krw;
            const newBudget = Math.round(oldBudget * 1.2);

            // Meta API 예산 업데이트
            if (isMetaConfigured() && campaign.meta_adset_id) {
              const newCents = krwToMetaCents(newBudget, exchangeRate);
              await updateAdsetBudget(campaign.meta_adset_id, newCents);
            }

            // DB 업데이트
            await upsertCampaign({
              id: campaign.id,
              daily_budget_krw: newBudget,
            });

            // audit_logs 기록
            await sb.from('audit_logs').insert({
              action: 'META_AUTO_SCALE',
              target_type: 'campaign',
              target_id: campaign.id,
              description: `Net ROAS ${rolling.rolling_roas_pct.toFixed(1)}% ≥ 200% — 예산 20% 증액`,
              before_value: { daily_budget_krw: oldBudget, roas: rolling.rolling_roas_pct },
              after_value: { daily_budget_krw: newBudget },
            });

            result.scaled.push({
              campaign_id: campaign.id,
              name: campaign.name,
              old_budget: oldBudget,
              new_budget: newBudget,
            });
          }
        } catch (err) {
          result.errors.push({
            campaign_id: campaign.id,
            error: err instanceof Error ? err.message : '알 수 없는 오류',
          });
        }
      })
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('자동 최적화 실패:', error);
    return NextResponse.json(
      { ...result, error: error instanceof Error ? error.message : '최적화 실패' },
      { status: 500 }
    );
  }
}
