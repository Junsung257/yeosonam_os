/**
 * @file llm-tracer.ts
 * @description LLM 호출 OpenTelemetry span 헬퍼.
 *
 * 사용:
 * ```ts
 * const result = await traceLlmCall(
 *   { task, provider, model },
 *   async (span) => {
 *     const r = await callModel(...);
 *     span.setAttribute('llm.tokens.input', r._usage?.input ?? 0);
 *     return r;
 *   },
 * );
 * ```
 *
 * Vercel OTel collector + Sentry Performance 양쪽으로 trace 전송됨.
 * OTEL_EXPORTER_OTLP_ENDPOINT 미설정 시 no-op (영향 0).
 */

import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';

const tracer = trace.getTracer('yeosonam-os.llm', '1.0.0');

export interface LlmSpanAttrs {
  task: string;
  provider: 'deepseek' | 'gemini' | 'claude' | string;
  model: string;
  /** 호출 단계 — executor / advisor / fallback */
  phase?: 'executor' | 'advisor' | 'fallback';
}

/**
 * LLM 호출을 OpenTelemetry span 으로 감싼다.
 *
 * span attributes 표준 키 (semantic-conventions / GenAI 초안 호환):
 *   - gen_ai.system        → provider
 *   - gen_ai.request.model → model
 *   - llm.task             → 도메인 task (LlmTask)
 *   - llm.phase            → executor/advisor/fallback
 *   - gen_ai.usage.input_tokens
 *   - gen_ai.usage.output_tokens
 *   - llm.cache_hit_tokens (DeepSeek prefix cache)
 *
 * 에러 시 span.recordException + status=ERROR 자동 처리.
 */
export async function traceLlmCall<T>(
  attrs: LlmSpanAttrs,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const phase = attrs.phase ?? 'executor';
  const spanName = `llm.${attrs.provider}.${phase}`;
  return tracer.startActiveSpan(spanName, async (span) => {
    span.setAttribute('gen_ai.system', attrs.provider);
    span.setAttribute('gen_ai.request.model', attrs.model);
    span.setAttribute('llm.task', attrs.task);
    span.setAttribute('llm.phase', phase);
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * span 에 LLM usage 정보 기록 (성공 후 호출).
 */
export function recordLlmUsage(span: Span, usage: {
  input?: number;
  output?: number;
  cache_hit?: number;
  latency_ms?: number;
}): void {
  if (typeof usage.input === 'number') span.setAttribute('gen_ai.usage.input_tokens', usage.input);
  if (typeof usage.output === 'number') span.setAttribute('gen_ai.usage.output_tokens', usage.output);
  if (typeof usage.cache_hit === 'number') span.setAttribute('llm.cache_hit_tokens', usage.cache_hit);
  if (typeof usage.latency_ms === 'number') span.setAttribute('llm.latency_ms', usage.latency_ms);
}
