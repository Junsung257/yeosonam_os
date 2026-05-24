/**
 * 마케팅 파이프라인 메인 오케스트레이터
 *
 * 실행 순서 (순차): ContentAgent → AdAgent → SocialPublishAgent → AdPublishAgent → OptimizationAgent → ReportingAgent
 * - 각 에이전트는 safeRun()으로 독립 격리 (하나 실패해도 계속)
 * - SocialPublishAgent: 승인된 콘텐츠를 Instagram/Facebook/Threads에 발행
 * - AdPublishAgent: 승인된 광고 캠페인을 Meta/Google에 게재
 * - ReportingAgent: 마지막에 실행 (다른 결과를 보고서에 포함)
 * - pipeline_logs 테이블에 실행 기록
 */
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import type { AgentResult } from './base-agent';
import { ContentAgent } from './agents/content-agent';
import { AdAgent } from './agents/ad-agent';
import { EngagementAgent } from './agents/engagement-agent';
import { OptimizationAgent } from './agents/optimization-agent';
import { ReportingAgent } from './agents/reporting-agent';
import { SocialPublishAgent } from './agents/social-publish-agent';
import { AdPublishAgent } from './agents/ad-publish-agent';
import { getSecret } from '@/lib/secret-registry';

export interface PipelineResult {
  tenantId: string;
  runDate: string;
  status: 'completed' | 'partial' | 'failed';
  agentsRun: Record<string, AgentResult>;
  elapsed_ms: number;
}

/** 테넌트 ID가 필요한지 여부 (싱글 테넌트면 default 사용) */
function resolveTenantId(tenantId: string): string {
  return tenantId || getSecret('NEXT_PUBLIC_DEFAULT_TENANT_ID') || 'default';
}

export async function runMarketingPipeline(tenantId: string): Promise<PipelineResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const runDate = new Date().toISOString().slice(0, 10);
  const ctx = { tenantId: resolvedTenantId, runDate };
  const t0 = Date.now();

  // 실행 시작 로그
  let logId: string | undefined;
  if (isSupabaseConfigured) {
    try {
      const { data } = await supabaseAdmin
        .from('pipeline_logs')
        .insert({ tenant_id: resolvedTenantId, run_date: runDate, status: 'running' })
        .select('id')
        .single();
      logId = data?.id;
    } catch (e) {
      console.warn('[orchestrator] pipeline_logs INSERT 실패 (감사 기록 생략):', e);
    }
  }

  const agentsRun: Record<string, AgentResult> = {};

  // ── 순차 실행 ─────────────────────────────────────────────────────────────
  // Phase 1: 콘텐츠 생성
  const contentAgent = new ContentAgent();
  agentsRun[contentAgent.name] = await contentAgent.safeRun(ctx);

  // Phase 2: 광고 DRAFT 생성
  const adAgent = new AdAgent();
  agentsRun[adAgent.name] = await adAgent.safeRun(ctx);

  // Phase 3: 소셜 미디어 발행 (승인된 콘텐츠)
  const socialAgent = new SocialPublishAgent({ dryRun: false });
  agentsRun[socialAgent.name] = await socialAgent.safeRun(ctx);

  // Phase 4: 광고 게재 (승인된 DRAFT 캠페인을 실제 플랫폼에)
  const adPublishAgent = new AdPublishAgent({
    dryRun: getSecret('META_ADS_DRY_RUN') === '1',
  });
  agentsRun[adPublishAgent.name] = await adPublishAgent.safeRun(ctx);

  // Phase 5: 고객 참여 (댓글 등)
  const engagementAgent = new EngagementAgent();
  agentsRun[engagementAgent.name] = await engagementAgent.safeRun(ctx);

  // Phase 6: 성과 최적화 (키워드 입찰 조정 등)
  const optimizationAgent = new OptimizationAgent();
  agentsRun[optimizationAgent.name] = await optimizationAgent.safeRun(ctx);

  // Phase 7: 리포트 (다른 에이전트 결과 포함)
  const reporter = new ReportingAgent({ agentsRun });
  agentsRun[reporter.name] = await reporter.safeRun(ctx);

  // ── 파이프라인 전체 status 계산 ───────────────────────────────────────────
  const results = Object.values(agentsRun);
  const failCount = results.filter(r => !r.ok && !r.skipped).length;
  const totalRealAgents = results.filter(r => !r.skipped).length;

  let status: PipelineResult['status'];
  if (failCount === 0) {
    status = 'completed';
  } else if (totalRealAgents > 0 && failCount < totalRealAgents) {
    status = 'partial';
  } else {
    status = 'failed';
  }

  const elapsed_ms = Date.now() - t0;

  // DB 업데이트
  if (isSupabaseConfigured && logId) {
    const errorMessage = failCount > 0
      ? Object.entries(agentsRun)
          .filter(([, r]) => !r.ok && !r.skipped && r.error)
          .map(([name, r]) => `${name}: ${r.error}`)
          .join('; ') || null
      : null;
    await supabaseAdmin
      .from('pipeline_logs')
      .update({
        status,
        agents_run: agentsRun,
        finished_at: new Date().toISOString(),
        error_message: errorMessage,
      })
      .eq('id', logId);
  }

  return { tenantId: resolvedTenantId, runDate, status, agentsRun, elapsed_ms };
}
