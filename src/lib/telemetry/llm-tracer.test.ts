/**
 * @file llm-tracer.test.ts
 * @description LLM tracer 헬퍼 동작 회귀 방지.
 *
 * 핵심 보장:
 *  - traceLlmCall 이 fn 의 반환값을 그대로 전달
 *  - fn 이 throw 하면 동일 에러 재전파 (span은 정리)
 *  - OTel 미설정 환경에서도 안전하게 no-op (오류 없음)
 */

import { describe, it, expect } from 'vitest';
import { traceLlmCall, recordLlmUsage } from './llm-tracer';
import { trace } from '@opentelemetry/api';

describe('llm-tracer', () => {
  it('traceLlmCall: fn 결과를 그대로 반환', async () => {
    const result = await traceLlmCall(
      { task: 'summary', provider: 'deepseek', model: 'deepseek-v4-flash' },
      async () => ({ ok: true, value: 42 }),
    );
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('traceLlmCall: fn 이 throw 하면 동일 에러 재전파', async () => {
    await expect(
      traceLlmCall(
        { task: 'summary', provider: 'gemini', model: 'gemini-2.5-flash' },
        async () => {
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');
  });

  it('traceLlmCall: phase 옵션 — fallback', async () => {
    const r = await traceLlmCall(
      { task: 'card-news', provider: 'gemini', model: 'gemini-2.5-flash', phase: 'fallback' },
      async () => 'ok',
    );
    expect(r).toBe('ok');
  });

  it('recordLlmUsage: span 에 attribute 안전 호출 (no-op span 도 OK)', () => {
    const span = trace.getTracer('test').startSpan('noop-test');
    expect(() =>
      recordLlmUsage(span, { input: 100, output: 50, cache_hit: 0, latency_ms: 230 }),
    ).not.toThrow();
    span.end();
  });
});
