import { NextRequest } from 'next/server';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import {
  isSupabaseConfigured,
  getAdAccounts,
  updateAdAccountBalance,
  getKeywordPerformances,
  updateKeywordStatus,
  updateKeywordBid,
} from '@/lib/supabase';
import {
  syncAdAccountBalance,
  checkAndAlertLowBalance,
  analyzeKeywords,
  summarizeOptimization,
  discoverLongtailKeywords,
  type KeywordPerf,
  type OptimizationAction,
} from '@/lib/ad-controller';
import { pauseGoogleKeyword, pauseNaverKeyword, updateGoogleBid, updateNaverBid } from '@/lib/search-ads-api';

/**
 * GET /api/cron/ad-optimizer
 *
 * AI 마케팅 자율 주행 스케줄러 — 1시간 단위 실행
 */
export const dynamic = 'force-dynamic';

const handleAdOptimizer = async (request: NextRequest) => {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  const startAt = Date.now();
  const log: string[] = [];
  const applyDbChanges =
    process.env.AD_OPTIMIZER_APPLY_CHANGES === '1' ||
    process.env.AD_OPTIMIZER_APPLY_CHANGES === 'true';
  const applyOffpeakAdjustment =
    process.env.AD_OPTIMIZER_APPLY_OFFPEAK_RULE === '1' ||
    process.env.AD_OPTIMIZER_APPLY_OFFPEAK_RULE === 'true';
  const applyExternalAds =
    process.env.AD_OPTIMIZER_APPLY_EXTERNAL_ADS === '1' ||
    process.env.AD_OPTIMIZER_APPLY_EXTERNAL_ADS === 'true';

  const push = (msg: string) => {
    console.log('[ad-optimizer]', msg);
    log.push(msg);
  };

  push('=== AI 마케팅 관제소 최적화 시작 ===');
  push(`[mode] ${applyDbChanges ? 'apply' : 'dry-run'} / offpeak=${applyOffpeakAdjustment ? 'on' : 'off'} / external=${applyExternalAds ? 'on' : 'off'}`);

  if (!isSupabaseConfigured) {
    push('Supabase 미설정 — Mock 실행');
    const platforms = ['naver', 'google', 'meta'] as const;
    for (const p of platforms) {
      const snapshot = await syncAdAccountBalance(p, `여소남_${p}`);
      const alert = await checkAndAlertLowBalance(snapshot, 50000);
      push(`[${p}] 잔액: ₩${snapshot.current_balance.toLocaleString('ko-KR')} ${alert.alerted ? '⚠ 긴급!' : '✓'}`);
    }
    push('키워드 최적화: Mock 환경');
    return {
      ok: true, mock: true,
      elapsed_ms: Date.now() - startAt,
      log,
    };
  }

  const adAccounts = await getAdAccounts();
  push(`광고 계정 ${adAccounts.length}개 동기화 시작`);

  const lowBalanceAlerts: string[] = [];

  for (const account of adAccounts) {
    try {
      const snapshot = await syncAdAccountBalance(account.platform, account.account_name);
      await updateAdAccountBalance(account.id, snapshot.current_balance);
      const alert = await checkAndAlertLowBalance(snapshot, account.low_balance_threshold);
      if (alert.alerted) lowBalanceAlerts.push(alert.message);
      push(`[${account.platform}] ${account.account_name}: ₩${snapshot.current_balance.toLocaleString('ko-KR')} ${alert.alerted ? '⚠ LOW' : '✓'}`);
    } catch (err) {
      push(`[${account.platform}] 동기화 실패: ${err instanceof Error ? err.message : '오류'}`);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const keywords = await getKeywordPerformances({ periodStart: today, periodEnd: today });
  push(`키워드 ${keywords.length}개 분석 시작`);

  const kwPerfs: KeywordPerf[] = keywords.map((k) => ({
    id: k.id, platform: k.platform, keyword: k.keyword,
    total_spend: k.total_spend, total_revenue: k.total_revenue,
    total_cost: k.total_cost, net_profit: k.net_profit,
    roas_pct: k.roas_pct, status: k.status,
    current_bid: k.current_bid, clicks: k.clicks, conversions: k.conversions,
    external_keyword_id: k.external_keyword_id,
  }));

  const actions: OptimizationAction[] = analyzeKeywords(kwPerfs);
  const summary = summarizeOptimization(actions);

  push(`최적화 결과 — PAUSED: ${summary.paused}, FLAGGED_UP: ${summary.flaggedUp}, 유지: ${summary.noChange}`);

  for (const action of actions) {
    const kw = kwPerfs.find((k) => k.keyword === action.keyword);
    if (!kw) continue;

    if (action.type === 'PAUSE' && kw.status !== 'PAUSED') {
      if (applyDbChanges) {
        await updateKeywordStatus(kw.id, 'PAUSED');
        if (applyExternalAds) await pauseExternalKeyword(kw);
      }
      push(`PAUSED: "${action.keyword}" — ${action.reason} (${applyDbChanges && applyExternalAds ? 'DB+외부 반영' : 'DB만 반영'})`);

    } else if (action.type === 'FLAG_UP' && kw.status !== 'FLAGGED_UP') {
      if (applyDbChanges) {
        await updateKeywordStatus(kw.id, 'FLAGGED_UP');
        const upBid = Math.round((kw.current_bid || 0) * Number(process.env.AD_FLAG_UP_BID_FACTOR || 1.1));
        if (upBid > 0) {
          await updateKeywordBid(kw.id, upBid);
          if (applyExternalAds) await updateExternalBid(kw, upBid);
        }
      }
      push(`FLAGGED_UP: "${action.keyword}" — ${action.reason} (${applyDbChanges && applyExternalAds ? 'DB+외부 반영' : 'DB만 반영'})`);
    }
  }

  if (new Date().getHours() === 0) {
    push('롱테일 키워드 발굴 시작 (자정 실행)');
    try {
      const seedKeywords = [
        '단체여행',
        '기업 워크샵',
        '인센티브투어',
        '기업연수',
        '해외연수',
        '부산 출발 단체여행',
        '김해공항 단체여행',
        '협회 연수',
        '법인 맞춤여행',
        '패키지여행',
        '허니문',
        '효도여행',
      ];
      const longtails = await discoverLongtailKeywords({ platform: 'naver', seedKeywords });
      push(`롱테일 발굴 ${longtails.length}개 후보 — ${longtails.map((l) => l.keyword).join(', ')}`);
    } catch (err) {
      push(`롱테일 발굴 실패: ${err instanceof Error ? err.message : '오류'}`);
    }
  }

  const kstHour = (new Date().getUTCHours() + 9) % 24;
  if (kstHour >= 1 && kstHour < 7) {
    const factor = Number(process.env.AD_OFFPEAK_BID_FACTOR || '0.85');
    const minBid = Number(process.env.AD_MIN_BID_KRW || 70);
    let adjusted = 0;
    if (applyDbChanges && applyOffpeakAdjustment) {
      for (const kw of kwPerfs.filter((k) => k.status === 'ACTIVE')) {
        const nextBid = Math.max(minBid, Math.round((kw.current_bid || 0) * factor));
        if (nextBid > 0 && nextBid < (kw.current_bid || 0)) {
          await updateKeywordBid(kw.id, nextBid);
          if (applyExternalAds) await updateExternalBid(kw, nextBid);
          adjusted += 1;
        }
      }
    }
    push(`[marketing-rules] KST ${kstHour}시 off-peak — 입찰 ${factor}배 감액 ${applyDbChanges && applyOffpeakAdjustment ? `${adjusted}건 적용` : 'dry-run/off'}`);
  }

  push(`=== 완료 (${Date.now() - startAt}ms) ===`);

  return {
    ok: true,
    apply_db_changes: applyDbChanges,
    apply_offpeak_adjustment: applyOffpeakAdjustment,
    elapsed_ms: Date.now() - startAt,
    optimization_summary: summary,
    low_balance_alerts: lowBalanceAlerts.length,
    log,
  };
};

export const GET = withCronLogging('ad-optimizer', handleAdOptimizer);

async function updateExternalBid(
  kw: KeywordPerf & { external_keyword_id?: string | null },
  nextBid: number,
): Promise<boolean> {
  const externalId = kw.external_keyword_id;
  if (!externalId) return false;
  if (kw.platform === 'naver') return updateNaverBid(externalId, nextBid);
  if (kw.platform === 'google') return updateGoogleBid(externalId, nextBid);
  return false;
}

async function pauseExternalKeyword(
  kw: KeywordPerf & { external_keyword_id?: string | null },
): Promise<boolean> {
  const externalId = kw.external_keyword_id;
  if (!externalId) return false;
  if (kw.platform === 'naver') return pauseNaverKeyword(externalId);
  if (kw.platform === 'google') return pauseGoogleKeyword(externalId);
  return false;
}
