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
 * Vercel OTel collector로 trace를 전송한다. exporter가 없으면 no-op이다.
 */

import {
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';

const tracer = trace.getTracer('yeosonam-os.llm', '1.0.0');

export interface LlmSpanAttrs {
  task: string;
  provider: 'deepseek' | 'gemini' | 'claude' | string;
  model: string;
  /** OpenTelemetry GenAI operation. 대부분의 대화형 모델 호출은 chat. */
  operation?: 'chat' | 'generate_content' | 'text_completion';
  /** 호출 단계 — executor / advisor / fallback */
  phase?: 'executor' | 'advisor' | 'fallback';
}

function normalizeProvider(provider: string): string {
  if (provider === 'gemini') return 'gcp.gemini';
  if (provider === 'claude') return 'anthropic';
  return provider;
}

export function buildLlmSpanAttributes(attrs: LlmSpanAttrs): Attributes {
  return {
    'gen_ai.operation.name': attrs.operation ?? 'chat',
    'gen_ai.provider.name': normalizeProvider(attrs.provider),
    'gen_ai.request.model': attrs.model,
    'ysn.llm.task': attrs.task,
    'ysn.llm.phase': attrs.phase ?? 'executor',
  };
}

/**
 * LLM 호출을 OpenTelemetry span 으로 감싼다.
 *
 * span attributes 표준 키 (OpenTelemetry GenAI semantic conventions):
 *   - gen_ai.operation.name → chat/generate_content/text_completion
 *   - gen_ai.provider.name → provider
 *   - gen_ai.request.model → model
 *   - ysn.llm.task         → 도메인 task (LlmTask)
 *   - ysn.llm.phase        → executor/advisor/fallback
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
  const operation = attrs.operation ?? 'chat';
  const spanName = `${operation} ${attrs.model}`;
  return tracer.startActiveSpan(spanName, {
    kind: SpanKind.CLIENT,
    // Put low-cardinality routing attributes on the span at creation time so
    // head samplers can make a decision from them.
    attributes: buildLlmSpanAttributes(attrs),
  }, async (span) => {
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
  if (typeof usage.cache_hit === 'number') {
    span.setAttribute('gen_ai.usage.cache_read.input_tokens', usage.cache_hit);
  }
  if (typeof usage.latency_ms === 'number') span.setAttribute('ysn.llm.latency_ms', usage.latency_ms);
}
