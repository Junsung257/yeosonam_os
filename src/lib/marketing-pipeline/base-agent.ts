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
}

export abstract class BaseMarketingAgent {
  abstract readonly name: string;

  /** 실제 에이전트 로직 — throw 가능, safeRun이 캐치 */
  abstract run(ctx: MarketingContext): Promise<Omit<AgentResult, 'elapsed_ms'>>;

  protected skip(reason: string): Omit<AgentResult, 'elapsed_ms'> {
    return { ok: true, skipped: true, skip_reason: reason };
  }

  /** 오케스트레이터에서 호출 — timeout + try/catch 에러 격리, elapsed_ms 측정 */
  async safeRun(ctx: MarketingContext): Promise<AgentResult> {
    const t0 = Date.now();
    try {
      const result = await withTimeout(() => this.run(ctx), AGENT_TIMEOUT_MS, this.name);
      return { ...result, elapsed_ms: Date.now() - t0 };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const isTimeout = error.startsWith('TIMEOUT:');
      console.error(`[${this.name}] ${isTimeout ? 'TIMEOUT' : '실패'}:`, err);
      if (isSupabaseConfigured) {
        void supabaseAdmin.from('agent_incidents').insert({
          tenant_id: ctx.tenantId,
          severity: isTimeout ? 'warn' : 'error',
          category: isTimeout ? 'timeout' : 'unknown',
          message: `[${this.name}] ${error}`,
          details: { agent: this.name, runDate: ctx.runDate },
          detected_by: 'marketing-pipeline',
        }).catch(() => null);
      }
      return { ok: false, error, elapsed_ms: Date.now() - t0 };
    }
  }
}
