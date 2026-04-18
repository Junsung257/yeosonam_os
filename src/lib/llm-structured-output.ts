/**
 * @file llm-structured-output.ts
 * @description Zod 스키마를 LLM (Gemini/Claude) 호출 시 Structured Output 규격으로 주입.
 *
 * 원칙:
 * - AI 파싱 시 "자유 텍스트 → JSON" 대신 "자유 텍스트 → Zod 스키마 준수 JSON" 강제
 * - 환각(필드 누락/추가 창조) 확률을 10배 이상 감소
 *
 * 참고:
 * - Gemini: `responseMimeType: "application/json"` + `responseSchema` (Gemini 네이티브)
 * - Claude: tool use + input_schema JSON Schema
 * - OpenAI: response_format: { type: 'json_schema', json_schema: {...} }
 *
 * 사용 예:
 * ```typescript
 * import { zodToGeminiSchema } from '@/lib/llm-structured-output';
 * import { PackageCoreSchema } from '@/lib/package-schema';
 *
 * const model = genAI.getGenerativeModel({
 *   model: 'gemini-2.5-flash',
 *   generationConfig: {
 *     responseMimeType: 'application/json',
 *     responseSchema: zodToGeminiSchema(PackageCoreSchema),
 *   },
 * });
 * ```
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Zod 스키마 → Gemini responseSchema 호환 JSON Schema
 *
 * Gemini의 제약 (2025-04 기준):
 * - `$ref` 지원 제한적 → `definitions` 인라인 필요 (`$refStrategy: 'none'`)
 * - `enum` 은 지원
 * - `additionalProperties: false` 없어도 됨
 * - `nullable: true` 대신 union with null은 허용 안 됨 → nullable 필드는 옵셔널로 변환 권장
 */
export function zodToGeminiSchema<T extends z.ZodTypeAny>(schema: T): Record<string, unknown> {
  const raw = zodToJsonSchema(schema, {
    $refStrategy: 'none',         // Gemini는 $ref 제한적 → 인라인 전개
    target: 'openApi3',           // OpenAPI 3 flavor (Gemini와 호환 높음)
  });

  // zod-to-json-schema가 붙이는 $schema 등 Gemini가 거부하는 필드 제거
  const cleaned = pruneForGemini(raw as Record<string, unknown>);
  return cleaned;
}

/**
 * Zod 스키마 → Claude tool input_schema
 * Claude의 tool use는 표준 JSON Schema 완전 지원 ($ref 포함)
 */
export function zodToClaudeSchema<T extends z.ZodTypeAny>(schema: T): Record<string, unknown> {
  const raw = zodToJsonSchema(schema, {
    target: 'jsonSchema7',
  });
  return raw as Record<string, unknown>;
}

/**
 * Zod → OpenAI response_format: { type: 'json_schema', json_schema: {...} }
 */
export function zodToOpenAISchema<T extends z.ZodTypeAny>(
  schema: T,
  name = 'output',
): { type: 'json_schema'; json_schema: { name: string; schema: Record<string, unknown>; strict: true } } {
  const raw = zodToJsonSchema(schema, { target: 'openApi3' });
  return {
    type: 'json_schema',
    json_schema: { name, schema: raw as Record<string, unknown>, strict: true },
  };
}

// ── Gemini 호환 스키마 정리 ─────────────────────────────────────────────

function pruneForGemini(obj: Record<string, unknown>): Record<string, unknown> {
  // Gemini가 거부하는 키워드 제거
  const DISALLOWED_KEYS = new Set([
    '$schema', '$id', 'default', 'examples', 'const',
    'patternProperties', 'dependencies', 'additionalProperties',
  ]);
  return walk(obj);

  function walk(node: unknown): any {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (DISALLOWED_KEYS.has(k)) continue;
        // Gemini는 nullable 지원 → 그대로 유지
        // Gemini는 "string | null" union 지원 안 함 → type이 배열이면 첫 element만
        if (k === 'type' && Array.isArray(v)) {
          const nonNull = (v as string[]).filter(t => t !== 'null');
          out[k] = nonNull[0] || v[0];
          // null 가능하면 nullable:true 추가
          if (v.includes('null') as unknown as boolean) out['nullable'] = true;
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    return node;
  }
}
