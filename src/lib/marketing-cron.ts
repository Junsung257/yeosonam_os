/**
 * 마케팅 크론 오케스트레이터
 *
 * 모든 정기 마케팅 작업을 순차적으로 실행한다.
 * Vercel Cron Jobs 또는 수동 API 호출로 트리거된다.
 *
 * 실행 순서 (의존성 고려):
 *   1. autoHealContentGaps         — 콘텐츠 갭 감지 및 큐 등록
 *   2. autoFinalizeExperiments     — 통계 유의 A/B 실험 자동 종료
 *   3. applyWinners                — A/B 테스트 승자 적용
 *   4. autoQueueFromInsights       — 고우선 예측 인사이트를 콘텐츠 큐에 등록
 *   5. refreshAllRFM               — RFM 점수 재계산
 *   6. refreshAttributionSummary   — MTA 요약 리프레시
 *   7. runAllSegmentCampaigns      — RFM 세그먼트별 이메일 캠페인 발송
 */

import { autoHealContentGaps } from '@/lib/content-gap-auto-heal';
import { autoFinalizeExperiments } from '@/lib/ab-test-engine';
import { autoQueueFromInsights } from '@/lib/predictive-marketing';
import { refreshAllRFM } from '@/lib/customer-segmentation';
import { refreshAttributionSummary } from '@/lib/attribution-engine';
import { runAllSegmentCampaigns } from '@/lib/rfm-email-campaign';
import { applyWinners } from './ab-test-auto-apply';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronStepResult {
  step: string;
  success: boolean;
  error?: string;
}

export interface CronResult {
  results: CronStepResult[];
  overallSuccess: boolean;
  startedAt: string;
  completedAt: string;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * 모든 정기 마케팅 작업을 순차적으로 실행한다.
 * 각 단계는 개별 try/catch로 감싸져 있어 한 단계의 실패가 전체를 중단시키지 않는다.
 */
export async function runMarketingCron(): Promise<CronResult> {
  const startedAt = new Date().toISOString();
  const results: CronStepResult[] = [];
  const log = (message: string) => console.log(`[MarketingCron] ${message}`);
  const errorLog = (message: string, err: unknown) =>
    console.error(`[MarketingCron] ${message}`, err instanceof Error ? err.message : err);

  // 1) 콘텐츠 갭 자동 치유
  log('Step 1/7: autoHealContentGaps 시작');
  try {
    const healResult = await autoHealContentGaps();
    results.push({
      step: 'autoHealContentGaps',
      success: true,
    });
    log(
      `Step 1/7 완료: 스캔=${healResult.scanned_packages}, 갭=${healResult.gaps_found}, 큐등록=${healResult.queued}`,
    );
  } catch (err) {
    errorLog('Step 1/7 실패: autoHealContentGaps', err);
    results.push({
      step: 'autoHealContentGaps',
      success: false,
      error: err instanceof Error ? err.message : '알 수 없는 오류',
    });
  }

  // 2) A/B 실험 자동 종료
  log('Step 2/7: autoFinalizeExperiments 시작');
  try {
    const finalizeResult = await autoFinalizeExperiments();
    results.push({
      step: 'autoFinalizeExperiments',
      success: true,
    });
    log(`Step 2/7 완료: 종료된 실험=${finalizeResult.finalized}`);
  } catch (err) {
    errorLog('Step 2/7 실패: autoFinalizeExperiments', err);
    results.push({
      step: 'autoFinalizeExperiments',
      success: false,
      error: err instanceof Error ? err.message : '알 수 없는 오류',
    });
  }

  // Step 2b: Apply A/B test winners to content
  log('Step 3/7: applyWinners 시작');
  try {
    const applyResults = await applyWinners();
    results.push({
      step: 'applyWinners',
      success: true,
    });
    log(`Step 3/7 완료: ${applyResults.length}개 적용`);
  } catch (err) {
    errorLog('Step 3/7 실패: applyWinners', err);
    results.push({
      step: 'applyWinners',
      success: false,
      error: err instanceof Error ? err.message : '알 수 없는 오류',
    });
  }

  // 4) 예측 인사이트 기반 콘텐츠 큐 등록
  log('Step 4/7: autoQueueFromInsights 시작');
  try {
    const queueResult = await autoQueueFromInsights();
    results.push({
      step: 'autoQueueFromInsights',
      success: true,
    });
    log(`Step 4/7 완료: 큐등록=${queueResult.queued}, 인사이트=${queueResult.insights.length}`);
  } catch (err) {
    errorLog('Step 4/7 실패: autoQueueFromInsights', err);
    results.push({
      step: 'autoQueueFromInsights',
      success: false,
      error: err instanceof Error ? err.message : '알 수 없는 오류',
    });
  }

  // 5) RFM 점수 재계산
  log('Step 5/7: refreshAllRFM 시작');
  try {
    const rfmResult = await refreshAllRFM();
    results.push({
      step: 'refreshAllRFM',
      success: true,
    });
    log(
      `Step 5/7 완료: 삭제=${rfmResult.deleted}, 계산=${rfmResult.computed}`,
    );
  } catch (err) {
    errorLog('Step 5/7 실패: refreshAllRFM', err);
    results.push({
      step: 'refreshAllRFM',
      success: false,
      error: err instanceof Error ? err.message : '알 수 없는 오류',
    });
  }

  // 6) MTA 요약 리프레시
  log('Step 6/7: refreshAttributionSummary 시작');
  try {
    const summaryResult = await refreshAttributionSummary();
    results.push({
      step: 'refreshAttributionSummary',
      success: true,
    });
    log(`Step 6/7 완료: 업데이트된 요약=${summaryResult.updated}`);
  } catch (err) {
    errorLog('Step 6/7 실패: refreshAttributionSummary', err);
    results.push({
      step: 'refreshAttributionSummary',
      success: false,
      error: err instanceof Error ? err.message : '알 수 없는 오류',
    });
  }

  // 7) RFM 세그먼트 캠페인 발송
  log('Step 7/7: runAllSegmentCampaigns 시작');
  try {
    const campaignResults = await runAllSegmentCampaigns();
    results.push({
      step: 'runAllSegmentCampaigns',
      success: true,
    });
    const totalSent = campaignResults.reduce((s, r) => s + r.sent, 0);
    const totalFailed = campaignResults.reduce((s, r) => s + r.failed, 0);
    log(`Step 7/7 완료: ${campaignResults.length}개 세그먼트, 발송=${totalSent}, 실패=${totalFailed}`);
  } catch (err) {
    errorLog('Step 7/7 실패: runAllSegmentCampaigns', err);
    results.push({
      step: 'runAllSegmentCampaigns',
      success: false,
      error: err instanceof Error ? err.message : '알 수 없는 오류',
    });
  }

  const completedAt = new Date().toISOString();
  const overallSuccess = results.every((r) => r.success);

  log(
    `크론 완료: 전체=${overallSuccess ? '성공' : '일부 실패'} ` +
      `(${results.filter((r) => r.success).length}/7 단계 성공)`,
  );

  return { results, overallSuccess, startedAt, completedAt };
}
