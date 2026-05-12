/**
 * 마케팅 파이프라인 메인 오케스트레이터
 *
 * 실행 순서 (순차): ContentAgent → AdAgent → EngagementAgent → OptimizationAgent → ReportingAgent
 * - 각 에이전트는 safeRun()으로 독립 격리 (하나 실패해도 계속)
 * - ReportingAgent는 마지막에 실행 (다른 결과를 보고서에 포함)
 * - pipeline_logs 테이블에 실행 기록
 */
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import type { AgentResult } from './base-agent';
import { ContentAgent } from './agents/content-agent';
import { AdAgent } from './agents/ad-agent';
import { EngagementAgent } from './agents/engagement-agent';
import { OptimizationAgent } from './agents/optimization-agent';
import { ReportingAgent } from './agents/reporting-agent';

export interface PipelineResult {
  tenantId: string;
  runDate: string;
  status: 'completed' | 'partial' | 'failed';
  agentsRun: Record<string, AgentResult>;
  elapsed_ms: number;
}

export async function runMarketingPipeline(tenantId: string): Promise<PipelineResult> {
  const runDate = new Date().toISOString().slice(0, 10);
  const ctx = { tenantId, runDate };
  const t0 = Date.now();

  // 실행 시작 로그 (실패해도 파이프라인 계속 진행)
  let logId: string | undefined;
  if (isSupabaseConfigured) {
    try {
      const { data } = await supabaseAdmin
        .from('pipeline_logs')
        .insert({ tenant_id: tenantId, run_date: runDate, status: 'running' })
        .select('id')
        .single();
      logId = data?.id;
    } catch (e) {
      console.warn('[orchestrator] pipeline_logs INSERT 실패 (감사 기록 생략):', e);
    }
  }

  const agentsRun: Record<string, AgentResult> = {};

  // ── 순차 실행 (ContentAgent → AdAgent → Engagement → Optimization) ──────
  const mainAgents = [
    new ContentAgent(),
    new AdAgent(),
    new EngagementAgent(),
    new OptimizationAgent(),
  ];

  for (const agent of mainAgents) {
    agentsRun[agent.name] = await agent.safeRun(ctx);
  }

  // ── ReportingAgent: 다른 에이전트 결과 포함해서 마지막에 실행 ─────────────
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

  return { tenantId, runDate, status, agentsRun, elapsed_ms };
}
