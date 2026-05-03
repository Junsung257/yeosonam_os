import { NextRequest, NextResponse } from 'next/server';
import { withCronLogging } from '@/lib/cron-observability';
import { getKeywordPerformances, isSupabaseConfigured, updateKeywordBid } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * 시간대·정책 기반 마케팅 힌트 (v0: 로그만).
 * 실제 입찰 API는 keyword_performances 에 플랫폼 키워드 ID가 연결된 뒤 ad-optimizer 에서 수행.
 */
async function runMarketingRules(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const kstHour = (new Date().getUTCHours() + 9) % 24;
  const offpeak = kstHour >= 1 && kstHour < 7;
  const factor = process.env.AD_OFFPEAK_BID_FACTOR || '0.85';
  const minBid = Number(process.env.AD_MIN_BID_KRW || 70);
  const applyBidUpdates =
    process.env.MARKETING_RULES_APPLY_BID_UPDATES === '1' ||
    process.env.MARKETING_RULES_APPLY_BID_UPDATES === 'true';

  const log: string[] = [];
  if (offpeak && process.env.MARKETING_RULES_VERBOSE === '1') {
    log.push(
      `[marketing-rules] KST ${kstHour}시 off-peak — 입찰 ${factor}배 감액 ${
        applyBidUpdates ? '실반영' : 'dry-run'
      }`,
    );
  }

  let adjusted = 0;
  if (offpeak && isSupabaseConfigured && applyBidUpdates) {
    const activeKeywords = await getKeywordPerformances({ status: 'ACTIVE' });
    const bidFactor = Number(factor) || 0.85;
    for (const kw of activeKeywords) {
      const current = Number(kw.current_bid || 0);
      if (!Number.isFinite(current) || current <= 0) continue;
      const nextBid = Math.max(minBid, Math.round(current * bidFactor));
      if (nextBid >= current) continue;
      await updateKeywordBid(kw.id, nextBid);
      adjusted += 1;
    }
    if (process.env.MARKETING_RULES_VERBOSE === '1') {
      log.push(`[marketing-rules] off-peak 입찰 감액 적용: ${adjusted}건`);
    }
  }

  return {
    ok: true,
    kstHour,
    offpeak,
    apply_bid_updates: applyBidUpdates,
    bid_factor_hint: offpeak ? Number(factor) || 0.85 : null,
    adjusted_keywords: adjusted,
    log,
  };
}

export const GET = withCronLogging('marketing-rules', runMarketingRules);
