/**
 * ══════════════════════════════════════════════════════════
 * Optimization Loop — 키워드 입찰 자동 최적화 루프
 * ══════════════════════════════════════════════════════════
 *
 * Phase 1: 규칙 기반 Daily 최적화 (2026)
 * Phase 3+: AI/ML 기반으로 업그레이드
 *
 * 실행: 서버 cron 또는 Vercel Cron Jobs에서 호출
 *
 * 전체 흐름:
 *   1. Search Terms 수집 (Google Ads / Naver)
 *   2. Search Terms 분석 → 키워드 추가/제외 추천 생성
 *   3. 저성과 검색어 → 자동 negative 키워드 추가
 *   4. 고전환 검색어 → 신규 키워드 제안
 *   5. 성과 데이터 기반 입찰가 최적화
 *   6. 입찰가 변경 실행
 *   7. 모든 액션 로그 저장
 */

import type { SearchAdKeyword } from './keyword-brain';
import {
  logOptimization,
  saveSearchTerm,
  savePerformanceToDB,
} from './keyword-brain';
import {
  fetchAllPerformance,
  fetchGoogleSearchTerms,
  analyzeSearchTerms,
  updateBid,
  pauseKeyword,
  type SearchTerm,
} from './search-ads-api';
import { optimizeBids, optimizeLowBidKeywords } from './keyword-brain';

// ── 설정 ──────────────────────────────────────────────────

const DAILY_SPEND_LIMIT = 100000; // 일일 최대 지출 (원)
const KEYWORD_MIN_BID = 100;       // 최소 입찰가 (원)
const KEYWORD_MAX_BID = 5000;      // 최대 입찰가 (원)

export interface OptimizationLoopResult {
  startedAt: string;
  completedAt: string;
  searchTermsCollected: number;
  recommendationsGenerated: number;
  negativeKeywordsAdded: number;
  keywordsAdded: number;
  bidsUpdated: number;
  keywordsPaused: number;
  totalSpend: number;
  errors: string[];
}

// ── 메인 최적화 루프 ──────────────────────────────────────

export async function runDailyOptimization(
  keywords: SearchAdKeyword[],
): Promise<OptimizationLoopResult> {
  const startedAt = new Date().toISOString();
  const result: OptimizationLoopResult = {
    startedAt,
    completedAt: '',
    searchTermsCollected: 0,
    recommendationsGenerated: 0,
    negativeKeywordsAdded: 0,
    keywordsAdded: 0,
    bidsUpdated: 0,
    keywordsPaused: 0,
    totalSpend: 0,
    errors: [],
  };

  try {
    // ── Step 1: 성과 데이터 수집 ────────────────────────────
    console.log('[optimization-loop] 성과 데이터 수집 시작');
    const performanceData = await fetchAllPerformance(keywords);
    const livePerformanceData = performanceData.filter(
      (perf) => !perf.isMock && perf.sourceQuality !== 'mock' && !perf.excludedFromLearning,
    );
    if (livePerformanceData.length < performanceData.length) {
      result.errors.push(`mock performance excluded from learning: ${performanceData.length - livePerformanceData.length}`);
    }

    // DB에 성과 저장
    const savePromises = livePerformanceData.map(async (perf) => {
      const kw = keywords.find((k) => k.id === perf.keywordId);
      if (!kw) return;

      await savePerformanceToDB(kw.keyword, perf.keyword, perf.platform, {
        impressions: perf.impressions,
        clicks: perf.clicks,
        ctr: perf.ctr,
        cpc: perf.cpc,
        conversions: perf.conversions,
        spend: perf.spend,
        roas: perf.spend > 0 ? (perf.conversions * 500000 / perf.spend) * 100 : 0,
      });
    });
    await Promise.allSettled(savePromises);

    result.totalSpend = livePerformanceData.reduce((sum, p) => sum + p.spend, 0);

    // ── Step 2: Search Terms 수집 ──────────────────────────
    console.log('[optimization-loop] Search Terms 수집 시작');
    const googleKeywords = keywords.filter((k) => k.platform === 'google');
    const searchTerms: SearchTerm[] = [];

    if (googleKeywords.length > 0) {
      const terms = await fetchGoogleSearchTerms(
        googleKeywords.map((k) => k.id),
      );
      searchTerms.push(...terms);
    }

    result.searchTermsCollected = searchTerms.length;

    // Search Terms DB 저장
    const stSavePromises = searchTerms.map((st) =>
      saveSearchTerm({
        searchTerm: st.searchTerm,
        keywordText: st.keywordText,
        matchType: st.matchType,
        impressions: st.impressions,
        clicks: st.clicks,
        costKrw: st.costKrw,
        conversions: st.conversions,
        platform: st.platform,
      }),
    );
    await Promise.allSettled(stSavePromises);

    // ── Step 3: Search Terms 분석 ─────────────────────────
    console.log('[optimization-loop] Search Terms 분석');
    const recommendations = analyzeSearchTerms(searchTerms);
    result.recommendationsGenerated = recommendations.length;

    // ── Step 4: 고전환 검색어 → 자동 negative 키워드 추가 ────
    const negativeRecs = recommendations.filter(
      (r) => r.action === 'add_as_negative',
    );
    for (const rec of negativeRecs) {
      // keywords 배열에 negative 키워드 추가 (추후 실제 API로 전송)
      try {
        await logOptimization({
          action: 'add_negative',
          platform: 'google',
          keywordText: rec.searchTerm,
          reason: rec.reason,
          triggeredBy: 'rule',
        });
        result.negativeKeywordsAdded++;
      } catch (err) {
        result.errors.push(
          `Negative 키워드 추가 실패 (${rec.searchTerm}): ${err}`,
        );
      }
    }

    // ── Step 5: 입찰 최적화 ──────────────────────────────────
    console.log('[optimization-loop] 입찰 최적화');
    const allRecommendations = optimizeBids(keywords);
    const lowBidRecs = optimizeLowBidKeywords(keywords);

    const bidChanges = [...allRecommendations, ...lowBidRecs]
      .filter((r) => r.action !== 'maintain')
      .filter(
        (r, i, arr) =>
          arr.findIndex(
            (x) => x.keywordId === r.keywordId && x.action === r.action,
          ) === i,
      );

    // 입찰가 변경 실행
    for (const rec of bidChanges) {
      try {
        const kw = keywords.find((k) => k.id === rec.keywordId);
        if (!kw) continue;

        const newBid = Math.max(
          KEYWORD_MIN_BID,
          Math.min(rec.recommendedBid, KEYWORD_MAX_BID),
        );

        if (rec.action === 'pause') {
          const success = await pauseKeyword(kw);
          result.keywordsPaused++;
          await logOptimization({
            action: 'pause',
            platform: kw.platform,
            keywordText: kw.keyword,
            keywordId: kw.id,
            reason: rec.reason,
            triggeredBy: 'rule',
            success,
          });
        } else {
          const success = await updateBid(kw, newBid);
          result.bidsUpdated++;
          await logOptimization({
            action:
              newBid > kw.bid ? 'bid_increase' : 'bid_decrease',
            platform: kw.platform,
            keywordText: kw.keyword,
            keywordId: kw.id,
            oldValue: kw.bid.toString(),
            newValue: newBid.toString(),
            reason: rec.reason,
            triggeredBy: 'rule',
            success,
          });
        }
      } catch (err) {
        result.errors.push(
          `입찰 변경 실패 (${rec.keywordId}): ${err}`,
        );
      }
    }
  } catch (err) {
    result.errors.push(`최적화 루프 전체 오류: ${err}`);
    console.error('[optimization-loop] 치명적 오류:', err);
  }

  result.completedAt = new Date().toISOString();
  console.log('[optimization-loop] 완료:', {
    searchedTerms: result.searchTermsCollected,
    bidsUpdated: result.bidsUpdated,
    paused: result.keywordsPaused,
    negativeAdded: result.negativeKeywordsAdded,
    errors: result.errors.length,
  });

  return result;
}

/**
 * 예산 한도 확인 — 일일 지출이 설정 한도를 초과하는지
 */
export function isOverDailyLimit(
  currentSpend: number,
  dailyLimit: number = DAILY_SPEND_LIMIT,
): boolean {
  return currentSpend >= dailyLimit;
}

/**
 * 예산 한도 초과 시 긴급 조치
 */
export async function emergencyBudgetPause(
  keywords: SearchAdKeyword[],
): Promise<void> {
  const activeKws = keywords.filter(
    (k) =>
      k.status === 'active' &&
      k.tier !== 'negative' &&
      k.roas < 100,
  );

  for (const kw of activeKws) {
    try {
      await pauseKeyword(kw);
      await logOptimization({
        action: 'pause',
        platform: kw.platform,
        keywordText: kw.keyword,
        keywordId: kw.id,
        reason: '일일 예산 초과 — 긴급 일시정지',
        triggeredBy: 'rule',
      });
    } catch {
      // 무시
    }
  }
}
