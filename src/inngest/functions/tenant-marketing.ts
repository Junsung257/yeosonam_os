import { inngest, marketingTenantRunEvent } from '../client';
import { runMarketingPipeline } from '@/lib/marketing-pipeline/orchestrator';
import { autoPublishWinners } from '@/lib/creative-engine/winner-auto-publish';
import { isInngestScheduleExecutionEnabled } from '@/inngest/runtime-policy';

/**
 * 테넌트별 마케팅 파이프라인 — Inngest fan-out으로 실행
 * 각 테넌트가 독립 함수 인스턴스에서 실행되어:
 *   - 한 테넌트 타임아웃이 다른 테넌트에 영향 없음
 *   - 실패 시 자동 재시도 (최대 2회)
 *   - Inngest 대시보드에서 테넌트별 실행 추적
 */
export const tenantMarketingFn = inngest.createFunction(
  {
    id: 'tenant-marketing-pipeline',
    name: '테넌트 마케팅 파이프라인',
    retries: 2,
    timeouts: { finish: '10m' },
    idempotency: 'event.id',
    concurrency: { limit: 1, key: 'event.data.tenantId' },
    triggers: [marketingTenantRunEvent],
  },
  async ({ event, step }) => {
    if (!isInngestScheduleExecutionEnabled()) {
      return { skipped: true, reason: 'inngest_schedule_cutover_not_enabled' };
    }
    const { tenantId, tenantName, runDate } = event.data;

    const result = await step.run(`pipeline-${tenantId}`, async () => {
      return runMarketingPipeline(tenantId);
    });

    const publishReport = await step.run(`winner-publish-${tenantId}`, async () => {
      return autoPublishWinners(tenantId);
    });

    return {
      tenantId,
      tenantName,
      runDate,
      status: result.status,
      elapsed_ms: result.elapsed_ms,
      winners_published: publishReport.published,
      winner_errors: publishReport.errors.length,
    };
  },
);
