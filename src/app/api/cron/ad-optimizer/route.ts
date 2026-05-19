import { NextRequest, NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import {
  isSupabaseConfigured,
  getAdAccounts,
  updateAdAccountBalance,
  getKeywordPerformances,
  updateKeywordStatus,
  updateKeywordBid,
  upsertKeywordPerformance,
  markKeywordAutoPaused,
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
import {
  pauseNaverKeyword,
  updateNaverBid,
  pauseGoogleKeyword,
  updateGoogleBid,
  isNaverAdsConfigured,
  isGoogleAdsConfigured,
} from '@/lib/search-ads-api';
import {
  isMetaConfigured,
  listActiveCampaigns,
  fetchCampaignROAS,
  pauseMetaCampaign,
} from '@/lib/meta-api';
import { autoSeedAdAccounts } from '@/lib/ad-account-seeder';

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
export async function GET(request: NextRequest): Promise<NextResponse> {
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

  const push = (msg: string) => {
    console.log('[ad-optimizer]', msg);
    log.push(msg);
  };

  push('=== AI 마케팅 관제소 최적화 시작 ===');
  push(`[mode] ${applyDbChanges ? 'apply' : 'dry-run'} / offpeak=${applyOffpeakAdjustment ? 'on' : 'off'}`);

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
  // STEP 0. AdAccount 자동 시드 (신규 키 등록 감지 시 INSERT)
  // ═══════════════════════════════════════════════════════════
  const seedResult = await autoSeedAdAccounts();
  if (seedResult.seeded > 0) {
    push(`자동 시드: ${seedResult.seeded}건 신규 ad_accounts INSERT`);
  }
  seedResult.details.forEach((d) => push(`  ${d}`));

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
      // Self-healing 추적: pause_count 증가 + last_paused_at 기록 + 3회 누적 시 permanently_paused
      if (applyDbChanges) await markKeywordAutoPaused(kw.id);
      push(`PAUSED: "${action.keyword}" — ${action.reason}`);

      // 실제 광고 플랫폼 API 호출 — applyDbChanges 켜진 상태에서만 외부 변경
      if (applyDbChanges) {
        if (kw.platform === 'naver' && isNaverAdsConfigured()) {
          const ok = await pauseNaverKeyword(kw.id);
          push(`  └ [naver] PAUSE ${ok ? '✓' : '✗ (실패, 로그 확인)'}`);
        } else if (kw.platform === 'google' && isGoogleAdsConfigured()) {
          const ok = await pauseGoogleKeyword(kw.id);
          push(`  └ [google] PAUSE ${ok ? '✓' : '✗ (실패, 로그 확인)'}`);
        } else if (kw.platform === 'meta') {
          // Meta 는 키워드 단위가 아니라 캠페인/광고세트 단위 — 별도 흐름에서 처리
        } else {
          push(`  └ [${kw.platform}] API 키 미설정 — DB 만 반영`);
        }
      }

    } else if (action.type === 'FLAG_UP' && kw.status !== 'FLAGGED_UP') {
      const upBid = Math.round((kw.current_bid || 0) * Number(process.env.AD_FLAG_UP_BID_FACTOR || 1.1));
      if (applyDbChanges) {
        await updateKeywordStatus(kw.id, 'FLAGGED_UP');
        if (upBid > 0) {
          await updateKeywordBid(kw.id, upBid);
        }
      }
      push(`FLAGGED_UP: "${action.keyword}" — ${action.reason} (${kw.current_bid} → ${upBid})`);

      // 실제 광고 플랫폼 입찰가 상향
      if (applyDbChanges && upBid > 0) {
        if (kw.platform === 'naver' && isNaverAdsConfigured()) {
          const ok = await updateNaverBid(kw.id, upBid);
          push(`  └ [naver] BID ${ok ? '✓' : '✗'}`);
        } else if (kw.platform === 'google' && isGoogleAdsConfigured()) {
          const ok = await updateGoogleBid(kw.id, upBid);
          push(`  └ [google] BID ${ok ? '✓' : '✗'}`);
        } else {
          push(`  └ [${kw.platform}] API 키 미설정 — DB 만 반영`);
        }
      }
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

      // 네이버 + 구글 양쪽 모두 발굴 (각 플랫폼이 다른 키워드 풀 가짐)
      const [naverLongtails, googleLongtails] = await Promise.all([
        discoverLongtailKeywords({ platform: 'naver', seedKeywords }),
        discoverLongtailKeywords({ platform: 'google', seedKeywords }),
      ]);

      const allLongtails = [
        ...naverLongtails.map((lt) => ({ ...lt, platform: 'naver' as const })),
        ...googleLongtails.map((lt) => ({ ...lt, platform: 'google' as const })),
      ];

      push(`롱테일 발굴 총 ${allLongtails.length}개 (네이버 ${naverLongtails.length} + 구글 ${googleLongtails.length})`);

      // keyword_performances 테이블에 is_longtail=true 로 upsert
      // onConflict: 'platform,keyword' — 같은 키워드 발굴 시 매번 갱신
      const today = new Date().toISOString().slice(0, 10);
      let inserted = 0;
      for (const lt of allLongtails) {
        try {
          await upsertKeywordPerformance({
            platform: lt.platform,
            keyword: lt.keyword,
            total_spend: 0,
            total_revenue: 0,
            total_cost: 0,
            status: 'ACTIVE',
            current_bid: lt.estimated_cpc,
            clicks: 0,
            impressions: 0,
            conversions: 0,
            is_longtail: true,
            discovered_at: new Date().toISOString(),
            period_start: today,
            period_end: today,
          });
          inserted++;
        } catch (upsertErr) {
          console.warn(`[ad-optimizer] keyword upsert 실패 ${lt.platform}/${lt.keyword}:`, upsertErr instanceof Error ? upsertErr.message : upsertErr);
        }
      }
      push(`롱테일 DB INSERT: ${inserted}/${allLongtails.length}건 성공`);

      // 원본 TODO 코드 (참고용)
      // for (const lt of longtails) {
      //   await upsertKeywordPerformance({ platform: 'naver', keyword: lt.keyword, is_longtail: true, current_bid: lt.estimated_cpc, ... });
      // }
    } catch (err) {
      push(`롱테일 발굴 실패: ${err instanceof Error ? err.message : '오류'}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 4. Meta 캠페인 ROAS 자동 PAUSE (Insights API 7일 윈도우)
  // ═══════════════════════════════════════════════════════════
  // 근거: Meta 표준 7-day-click 측정 윈도우 (searchengineland.com)
  // 안전: applyDbChanges + isMetaConfigured 시에만 실제 PAUSE
  if (isMetaConfigured()) {
    try {
      const metaRoasTarget = Number(process.env.AD_META_ROAS_TARGET_PCT ?? process.env.AD_ROAS_TARGET_PCT ?? 150);
      const metaMinSpend = Number(process.env.AD_META_MIN_SPEND_KRW ?? 30000); // 최소 지출 (데이터 부족 보호)
      const metaWindowDays = Number(process.env.AD_META_ROAS_WINDOW_DAYS ?? 7);

      const campaigns = await listActiveCampaigns();
      push(`Meta 활성 캠페인 ${campaigns.length}개 ROAS 분석 (${metaWindowDays}d 윈도우, 목표 ${metaRoasTarget}%)`);

      let metaPaused = 0;
      let metaSkipped = 0;
      for (const camp of campaigns) {
        try {
          const roas = await fetchCampaignROAS(camp.id, metaWindowDays);
          if (roas.spend < metaMinSpend) {
            // 데이터 부족 — 성급한 PAUSE 회피 (Optmyzr 표준 패턴)
            metaSkipped++;
            push(`  [meta:${camp.id}] "${camp.name}" SKIP (지출 ₩${roas.spend.toLocaleString('ko-KR')} < ₩${metaMinSpend.toLocaleString('ko-KR')})`);
            continue;
          }
          if (roas.roasPct < metaRoasTarget) {
            push(`  [meta:${camp.id}] "${camp.name}" PAUSE 후보 — ROAS ${roas.roasPct}% < ${metaRoasTarget}% (지출 ₩${roas.spend.toLocaleString('ko-KR')} / 매출 ₩${roas.revenue.toLocaleString('ko-KR')})`);
            if (applyDbChanges) {
              await pauseMetaCampaign(camp.id);
              metaPaused++;
              push(`    └ ✓ Meta PAUSE 적용`);
            } else {
              push(`    └ dry-run (APPLY_CHANGES=false)`);
            }
          }
        } catch (e) {
          push(`  [meta:${camp.id}] ROAS 조회 실패: ${e instanceof Error ? e.message : e}`);
        }
      }
      push(`Meta 캠페인: ${metaPaused}건 PAUSE 적용, ${metaSkipped}건 데이터부족 skip`);
    } catch (e) {
      push(`Meta 캠페인 자동 PAUSE 실패: ${e instanceof Error ? e.message : e}`);
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
          adjusted += 1;
        }
      }
    }
    push(
      `[marketing-rules] KST ${kstHour}시 off-peak — 입찰 ${factor}배 감액 ${
        applyDbChanges && applyOffpeakAdjustment ? `${adjusted}건 적용` : 'dry-run/off'
      }`,
    );
  }

  push(`=== 완료 (${Date.now() - startAt}ms) ===`);

  return NextResponse.json({
    ok: true,
    apply_db_changes: applyDbChanges,
    apply_offpeak_adjustment: applyOffpeakAdjustment,
    elapsed_ms: Date.now() - startAt,
    optimization_summary: summary,
    low_balance_alerts: lowBalanceAlerts.length,
    log,
  });
}
