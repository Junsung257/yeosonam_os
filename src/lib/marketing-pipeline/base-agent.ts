/**
 * 마케팅 자동화 에이전트 공통 베이스
 *
 * - 모든 에이전트는 BaseMarketingAgent를 상속
 * - safeRun()이 에러를 격리 → 하나 실패해도 파이프라인 계속 진행
 * - skip()으로 graceful skip (토큰 미설정 등)
 */
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withTimeout } from '@/lib/utils/timeout';

const AGENT_TIMEOUT_MS = Number.parseInt(process.env.MARKETING_AGENT_TIMEOUT_MS ?? '60000', 10);

export interface MarketingContext {
  tenantId: string;
  runDate: string; // YYYY-MM-DD
}

export interface AgentResult {
  ok: boolean;
  skipped?: boolean;
  skip_reason?: string;
  data?: unknown;
  error?: string;
  elapsed_ms: number;
  agent_contract?: MarketingAgentContract;
  role?: MarketingAgentRole;
  input_summary?: string;
  evidence?: string[];
  decision?: string;
  next_action?: string;
  needs_human_approval?: boolean;
}

export type MarketingAgentRole =
  | 'campaign_planner'
  | 'copywriter'
  | 'performance_analyst'
  | 'reporter'
  | 'publisher'
  | 'engagement_operator'
  | 'operator';

export interface MarketingAgentContract {
  role: MarketingAgentRole;
  input_summary: string;
  evidence: string[];
  decision: string;
  next_action: string;
  needs_human_approval: boolean;
}

export abstract class BaseMarketingAgent {
  abstract readonly name: string;
  protected readonly agentRole: MarketingAgentRole = 'operator';

  /** 실제 에이전트 로직 — throw 가능, safeRun이 캐치 */
  abstract run(ctx: MarketingContext): Promise<Omit<AgentResult, 'elapsed_ms'>>;

  protected skip(reason: string): Omit<AgentResult, 'elapsed_ms'> {
    return { ok: true, skipped: true, skip_reason: reason };
  }

  protected withContract(
    result: Omit<AgentResult, 'elapsed_ms'>,
    contract: Partial<MarketingAgentContract> = {},
  ): Omit<AgentResult, 'elapsed_ms'> {
    const fullContract = this.buildContract(result, contract);
    const data = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? { ...(result.data as Record<string, unknown>), agent_contract: fullContract }
      : result.data;

    return {
      ...result,
      data,
      agent_contract: fullContract,
      ...fullContract,
    };
  }

  protected skipWithContract(
    reason: string,
    contract: Partial<MarketingAgentContract> = {},
  ): Omit<AgentResult, 'elapsed_ms'> {
    return this.withContract(this.skip(reason), {
      evidence: [reason],
      decision: 'skipped',
      next_action: 'Resolve the missing prerequisite and rerun this agent.',
      needs_human_approval: false,
      ...contract,
    });
  }

  private buildContract(
    result: Omit<AgentResult, 'elapsed_ms'>,
    contract: Partial<MarketingAgentContract>,
  ): MarketingAgentContract {
    const existing = result.agent_contract;
    const evidence = contract.evidence?.length
      ? contract.evidence
      : existing?.evidence?.length
        ? existing.evidence
      : result.error
        ? [result.error]
        : result.skipped && result.skip_reason
          ? [result.skip_reason]
          : ['Agent completed without additional evidence.'];

    return {
      role: contract.role ?? existing?.role ?? this.agentRole,
      input_summary: contract.input_summary ?? existing?.input_summary ?? `${this.name} agent run`,
      evidence,
      decision: contract.decision ?? existing?.decision ?? (result.ok ? 'completed' : 'failed'),
      next_action: contract.next_action ?? existing?.next_action ?? (result.ok ? 'Review generated evidence in Ad OS.' : 'Inspect the agent error before rerun.'),
      needs_human_approval: contract.needs_human_approval ?? existing?.needs_human_approval ?? false,
    };
  }

  /** 오케스트레이터에서 호출 — timeout + try/catch 에러 격리, elapsed_ms 측정 */
  async safeRun(ctx: MarketingContext): Promise<AgentResult> {
    const t0 = Date.now();
    try {
      const result = await withTimeout(() => this.run(ctx), AGENT_TIMEOUT_MS, this.name);
      const decorated = this.withContract(result);
      return { ...decorated, elapsed_ms: Date.now() - t0 };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const isTimeout = error.startsWith('TIMEOUT:');
      console.error(`[${this.name}] ${isTimeout ? 'TIMEOUT' : '실패'}:`, err);
      if (isSupabaseConfigured) {
        void Promise.resolve(supabaseAdmin.from('agent_incidents').insert({
          tenant_id: ctx.tenantId,
          severity: isTimeout ? 'warn' : 'error',
          category: isTimeout ? 'timeout' : 'unknown',
          message: `[${this.name}] ${error}`,
          details: { agent: this.name, runDate: ctx.runDate },
          detected_by: 'marketing-pipeline',
        })).catch(() => null);
      }
      const decorated = this.withContract({
        ok: false,
        error,
      }, {
        evidence: [error],
        decision: isTimeout ? 'timeout' : 'failed',
        next_action: isTimeout ? 'Reduce workload or raise MARKETING_AGENT_TIMEOUT_MS before rerun.' : 'Inspect the incident and rerun this agent after repair.',
        needs_human_approval: true,
      });
      return { ...decorated, elapsed_ms: Date.now() - t0 };
    }
  }
}
