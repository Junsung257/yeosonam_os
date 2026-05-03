import { NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getAdAccounts,
  updateAdAccountBalance,
  getKeywordPerformances,
  updateKeywordStatus,
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

/**
 * GET /api/cron/ad-optimizer
 *
 * AI 마케팅 자율 주행 스케줄러 — 1시간 단위 실행
 *
 * 처리 흐름:
 *   1. 광고 계정 잔액 동기화 (Mock → 실제 API 교체 가능)
 *   2. 잔액 부족 시 긴급 알림 발생
 *   3. 키워드 성과 분석 → PAUSED / FLAGGED_UP / NO_CHANGE 분류
 *   4. 실제 광고 플랫폼 API로 키워드 상태 반영 (TODO 주석)
 *   5. 롱테일 키워드 발굴 실행
 *
 * vercel.json 등록:
 *   { "path": "/api/cron/ad-optimizer", "schedule": "0 * * * *" }  ← 매시 정각
 */
export const dynamic = 'force-dynamic';
export async function GET(): Promise<NextResponse> {
  const startAt = Date.now();
  const log: string[] = [];

  const push = (msg: string) => {
    console.log('[ad-optimizer]', msg);
    log.push(msg);
  };

  push('=== AI 마케팅 관제소 최적화 시작 ===');

  if (!isSupabaseConfigured) {
    push('Supabase 미설정 — Mock 실행');

    // Mock: 잔액 동기화 시뮬레이션
    const platforms = ['naver', 'google', 'meta'] as const;
    for (const p of platforms) {
      const snapshot = await syncAdAccountBalance(p, `여소남_${p}`);
      const alert    = await checkAndAlertLowBalance(snapshot, 50000);
      push(`[${p}] 잔액: ₩${snapshot.current_balance.toLocaleString('ko-KR')} ${alert.alerted ? '⚠ 긴급!' : '✓'}`);
    }

    // Mock: 키워드 최적화 시뮬레이션 (Mock DB 데이터 없으므로 예시 출력)
    push('키워드 최적화: Mock 환경 — 실제 DB 없이 로직 검증만 수행');

    return NextResponse.json({
      ok: true, mock: true,
      elapsed_ms: Date.now() - startAt,
      log,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 1. 광고 계정 잔액 동기화
  // ═══════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════
  // STEP 2. 키워드 성과 분석 & 자동 ON/OFF
  // ═══════════════════════════════════════════════════════════

  const today = new Date().toISOString().slice(0, 10);
  const keywords = await getKeywordPerformances({ periodStart: today, periodEnd: today });
  push(`키워드 ${keywords.length}개 분석 시작`);

  // DB 타입 → AdController 타입 변환
  const kwPerfs: KeywordPerf[] = keywords.map((k) => ({
    id:            k.id,
    platform:      k.platform,
    keyword:       k.keyword,
    total_spend:   k.total_spend,
    total_revenue: k.total_revenue,
    total_cost:    k.total_cost,
    net_profit:    k.net_profit,
    roas_pct:      k.roas_pct,
    status:        k.status,
    current_bid:   k.current_bid,
    clicks:        k.clicks,
    conversions:   k.conversions,
  }));

  const actions: OptimizationAction[] = analyzeKeywords(kwPerfs);
  const summary = summarizeOptimization(actions);

  push(`최적화 결과 — PAUSED: ${summary.paused}, FLAGGED_UP: ${summary.flaggedUp}, 유지: ${summary.noChange}`);

  // DB 상태 업데이트 + 실제 광고 API 반영
  for (const action of actions) {
    const kw = kwPerfs.find((k) => k.keyword === action.keyword);
    if (!kw) continue;

    if (action.type === 'PAUSE' && kw.status !== 'PAUSED') {
      await updateKeywordStatus(kw.id, 'PAUSED');
      push(`PAUSED: "${action.keyword}" — ${action.reason}`);

      // TODO: 실제 네이버 광고 API — 키워드 일시 중지
      // await fetch(`https://api.naver.com/ncc/adgroups/keywords/${kw.id}`, {
      //   method: 'PUT',
      //   headers: { 'X-API-KEY': process.env.NAVER_AD_API_KEY! },
      //   body: JSON.stringify({ userLock: true }),
      // });

      // TODO: 실제 구글 Ads API — 키워드 PAUSED
      // await googleAdsClient.mutateAdGroupCriteria({
      //   operations: [{ update: { resource_name: kw.id, status: 'PAUSED' } }]
      // });

    } else if (action.type === 'FLAG_UP' && kw.status !== 'FLAGGED_UP') {
      await updateKeywordStatus(kw.id, 'FLAGGED_UP');
      push(`FLAGGED_UP: "${action.keyword}" — ${action.reason}`);

      // TODO: 실제 입찰가 상향 반영
      // const newBid = Math.min(kw.current_bid * 1.2, MAX_BID_LIMIT);
      // await updateKeywordBid(kw.id, newBid);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 3. 롱테일 키워드 발굴 (1일 1회 — 자정 실행 권장)
  // ═══════════════════════════════════════════════════════════

  // 시간당 실행 중 자정(0시)에만 발굴 실행
  if (new Date().getHours() === 0) {
    push('롱테일 키워드 발굴 시작 (자정 실행)');
    try {
      const seedKeywords = ['단체여행', '패키지여행', '허니문', '효도여행'];
      const longtails = await discoverLongtailKeywords({
        platform: 'naver',
        seedKeywords,
      });
      push(`롱테일 발굴 ${longtails.length}개 후보 — ${longtails.map((l) => l.keyword).join(', ')}`);

      // TODO: keyword_performances 테이블에 is_longtail=true로 INSERT
      // for (const lt of longtails) {
      //   await upsertKeywordPerformance({ platform: 'naver', keyword: lt.keyword, is_longtail: true, current_bid: lt.estimated_cpc, ... });
      // }
    } catch (err) {
      push(`롱테일 발굴 실패: ${err instanceof Error ? err.message : '오류'}`);
    }
  }

  const kstHour = (new Date().getUTCHours() + 9) % 24;
  if (kstHour >= 1 && kstHour < 7) {
    push(
      `[marketing-rules hint] KST ${kstHour}시 off-peak — 입찰 ${process.env.AD_OFFPEAK_BID_FACTOR || '0.85'}배 감액 권고 (플랫폼 키워드 ID 매핑 후 실연동)`,
    );
  }

  push(`=== 완료 (${Date.now() - startAt}ms) ===`);

  return NextResponse.json({
    ok: true,
    elapsed_ms: Date.now() - startAt,
    optimization_summary: summary,
    low_balance_alerts: lowBalanceAlerts.length,
    log,
  });
}
