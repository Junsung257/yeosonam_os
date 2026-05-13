/**
 * @file prompt-regression-runner.ts — P13-6 prompt regression test runner
 *
 * 박제 사유 (2026-05-13):
 * 프롬프트 변경 시 회귀 사고 자동 차단. 골든 fixture 누적 → 매주 cron 회귀 검증.
 *
 * 흐름:
 *   1. prompt_regression_fixtures 활성 fixture 조회
 *   2. 각 fixture 의 raw_text_snippet → parser.parseTextWithAI 호출
 *   3. 결과를 expected_fields 와 diff
 *   4. prompt_regression_runs 에 결과 적재 (passed/diff_fields/cost/elapsed_ms)
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export interface RegressionFixture {
  id: number;
  fixture_name: string;
  prompt_version: string;
  raw_text_snippet: string;
  expected_fields: Record<string, unknown>;
  category: string;
}

export interface RegressionRunResult {
  fixture_id: number;
  passed: boolean;
  diff_fields: Array<{ field: string; expected: unknown; actual: unknown }>;
  elapsed_ms: number;
  notes?: string;
}

/** fixture 활성 목록 조회 */
export async function loadActiveFixtures(): Promise<RegressionFixture[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const { data } = await supabaseAdmin
      .from('prompt_regression_fixtures')
      .select('*')
      .eq('is_active', true)
      .order('id');
    return (data ?? []) as RegressionFixture[];
  } catch {
    return [];
  }
}

/** 결과를 prompt_regression_runs 에 적재 */
export async function recordRunResult(
  fixtureId: number,
  promptVersion: string,
  result: RegressionRunResult,
  llmCostUsd: number = 0,
): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    await supabaseAdmin
      .from('prompt_regression_runs')
      .insert({
        fixture_id:     fixtureId,
        prompt_version: promptVersion,
        passed:         result.passed,
        diff_fields:    result.diff_fields,
        llm_cost_usd:   llmCostUsd,
        elapsed_ms:     result.elapsed_ms,
        notes:          result.notes ?? null,
      });
  } catch (e) {
    console.warn('[regression-runner] record 실패:', (e as Error).message);
  }
}

/** 핵심 필드 비교 (간단한 deep equal) */
export function compareFields(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): { passed: boolean; diff_fields: Array<{ field: string; expected: unknown; actual: unknown }> } {
  const diff: Array<{ field: string; expected: unknown; actual: unknown }> = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
      diff.push({ field: key, expected: expectedValue, actual: actualValue });
    }
  }
  return { passed: diff.length === 0, diff_fields: diff };
}

/** 통계 — 최근 N일 회귀 통과율 */
export async function getRegressionStats(days = 7): Promise<{ total: number; passed: number; pass_rate: number; recent_failures: Array<{ fixture_id: number; ran_at: string; diff_count: number }> }> {
  if (!isSupabaseConfigured) return { total: 0, passed: 0, pass_rate: 0, recent_failures: [] };
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabaseAdmin
      .from('prompt_regression_runs')
      .select('fixture_id, passed, diff_fields, ran_at')
      .gte('ran_at', since)
      .order('ran_at', { ascending: false });

    const rows = (data ?? []) as Array<{ fixture_id: number; passed: boolean; diff_fields: unknown[]; ran_at: string }>;
    const total = rows.length;
    const passed = rows.filter(r => r.passed).length;
    const failures = rows
      .filter(r => !r.passed)
      .slice(0, 10)
      .map(r => ({
        fixture_id: r.fixture_id,
        ran_at:     r.ran_at,
        diff_count: Array.isArray(r.diff_fields) ? r.diff_fields.length : 0,
      }));
    return {
      total,
      passed,
      pass_rate: total > 0 ? Math.round((passed / total) * 1000) / 10 : 0,
      recent_failures: failures,
    };
  } catch {
    return { total: 0, passed: 0, pass_rate: 0, recent_failures: [] };
  }
}
