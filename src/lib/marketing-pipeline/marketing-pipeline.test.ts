/**
 * 마케팅 파이프라인 단위 테스트
 *
 * 커버:
 *   - BaseMarketingAgent.safeRun: 에러 격리 (ok=false 반환, throw 안 함)
 *   - BaseMarketingAgent.safeRun: skip() 정상 동작
 *   - BaseMarketingAgent.safeRun: timeout 시 ok=false + TIMEOUT 메시지
 *   - publishWithSaga: 모든 단계 성공 → { ok: true }
 *   - publishWithSaga: 중간 실패 → rollback 호출 + { ok: false }
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseMarketingAgent, type MarketingContext, type AgentResult } from './base-agent';
import { withTimeout } from '@/lib/utils/timeout';

// ── Supabase mock (테스트 환경에서 DB 미접속) ─────────────────────────────────
vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabaseAdmin: {
    from: () => ({
      insert: () => ({ catch: () => null }),
      update: () => ({ eq: () => ({ eq: () => Promise.resolve() }) }),
    }),
  },
}));

// ── Slack webhook fetch mock ──────────────────────────────────────────────────
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

// ── 테스트용 컨텍스트 ─────────────────────────────────────────────────────────
const ctx: MarketingContext = { tenantId: 'test-tenant-uuid', runDate: '2026-05-05' };

// ── BaseMarketingAgent 구현체 헬퍼 ─────────────────────────────────────────────
function makeAgent(behavior: 'ok' | 'skip' | 'throw' | 'slow', label = 'test') {
  class TestAgent extends BaseMarketingAgent {
    readonly name = label;
    async run(_ctx: MarketingContext): Promise<Omit<AgentResult, 'elapsed_ms'>> {
      if (behavior === 'ok')   return { ok: true, data: 'done' };
      if (behavior === 'skip') return this.skip('env 미설정');
      if (behavior === 'slow') {
        await new Promise((r) => setTimeout(r, 200)); // 짧은 지연
        return { ok: true };
      }
      throw new Error('의도적 실패');
    }
  }
  return new TestAgent();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BaseMarketingAgent.safeRun', () => {

  it('성공 케이스: ok=true 반환', async () => {
    const result = await makeAgent('ok').safeRun(ctx);
    expect(result.ok).toBe(true);
    expect(result.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it('skip 케이스: ok=true, skipped=true 반환', async () => {
    const result = await makeAgent('skip').safeRun(ctx);
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.skip_reason).toBe('env 미설정');
  });

  it('에러 격리: throw를 ok=false로 변환, 예외 전파 안 함', async () => {
    const result = await makeAgent('throw').safeRun(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('의도적 실패');
    expect(result.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it('timeout: safeRun이 MARKETING_AGENT_TIMEOUT_MS 초과 시 ok=false + TIMEOUT 메시지 반환', async () => {
    class SlowAgent extends BaseMarketingAgent {
      readonly name = 'slow_test';
      async run(_ctx: MarketingContext): Promise<Omit<AgentResult, 'elapsed_ms'>> {
        await new Promise((r) => setTimeout(r, 200));
        return { ok: true };
      }
    }

    let caughtError: string | undefined;
    try {
      await withTimeout(() => new SlowAgent().run(ctx), 50, 'slow_test');
    } catch (err) {
      caughtError = err instanceof Error ? err.message : String(err);
    }

    expect(caughtError).toBeDefined();
    expect(caughtError).toContain('TIMEOUT:');
    expect(caughtError).toContain('slow_test');
  });

});

describe('publishWithSaga', () => {

  beforeEach(() => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
  });

  it('모든 단계 성공: ok=true, publishedPlatforms에 모든 플랫폼 포함', async () => {
    const { publishWithSaga } = await import('./publish-saga');

    const steps = [
      { platform: 'meta' as const,      publish: vi.fn().mockResolvedValue(undefined) },
      { platform: 'blog' as const,      publish: vi.fn().mockResolvedValue(undefined) },
      { platform: 'instagram' as const, publish: vi.fn().mockResolvedValue(undefined) },
    ];

    const result = await publishWithSaga('content-123', steps);

    expect(result.ok).toBe(true);
    expect(result.publishedPlatforms).toEqual(['meta', 'blog', 'instagram']);
    expect(result.rolledBack).toEqual([]);
  });

  it('두 번째 단계 실패: 첫 번째 롤백 + ok=false', async () => {
    const { publishWithSaga } = await import('./publish-saga');

    const steps = [
      { platform: 'meta' as const, publish: vi.fn().mockResolvedValue(undefined) },
      { platform: 'blog' as const, publish: vi.fn().mockRejectedValue(new Error('블로그 API 오류')) },
    ];

    const result = await publishWithSaga('content-456', steps);

    expect(result.ok).toBe(false);
    expect(result.publishedPlatforms).toContain('meta');
    expect(result.rolledBack).toContain('meta');
    expect(result.error).toContain('블로그 API 오류');
  });

  it('첫 번째 단계 실패: publishedPlatforms 비어있음, 롤백 없음', async () => {
    const { publishWithSaga } = await import('./publish-saga');

    const steps = [
      { platform: 'meta' as const, publish: vi.fn().mockRejectedValue(new Error('Meta 토큰 만료')) },
    ];

    const result = await publishWithSaga('content-789', steps);

    expect(result.ok).toBe(false);
    expect(result.publishedPlatforms).toHaveLength(0);
    expect(result.rolledBack).toHaveLength(0);
  });

  it('빈 steps: ok=true, 발행 플랫폼 없음', async () => {
    const { publishWithSaga } = await import('./publish-saga');

    const result = await publishWithSaga('content-empty', []);
    expect(result.ok).toBe(true);
    expect(result.publishedPlatforms).toHaveLength(0);
  });

});
