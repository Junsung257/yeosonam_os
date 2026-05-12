/**
 * @file reflection-memory.ts — Reflexion episodic memory retrieval
 *
 * Shinn et al. NeurIPS 2023 (arXiv 2303.11366) — 사장님 정정 누적 → 동일 랜드사·지역
 * 다음 등록 prompt 에 reflection 자동 주입.
 *
 * EPR (few-shot retriever) 와 보완 관계:
 *   - EPR  = 성공 사례 (raw_text + 메타 demo)
 *   - Reflexion = 실패→정정 교훈 (don't do X, prefer Y)
 *
 * 둘을 결합하면 LLM 이 "이렇게 정상화하라" + "이런 함정 피하라" 양면 학습.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CorrectionRecord {
  id: string;
  field_path: string;
  reflection: string | null;
  before_value: unknown;
  after_value: unknown;
  raw_text_excerpt: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string | null;
  created_at: string;
  applied_count: number;
  land_operator_id: string | null;
  destination: string | null;
}

export interface ReflectionRetrieveOptions {
  landOperatorId?: string | null;
  destination?: string | null;
  limit?: number;
  minSeverity?: 'critical' | 'high' | 'medium' | 'low';
}

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 } as const;

/**
 * 활성 reflection 조회.
 * 우선순위: 동일 랜드사+지역 > 동일 지역 > 동일 랜드사 > 글로벌(category=hallucination 등)
 */
export async function getRelevantReflections(
  sb: SupabaseClient,
  options: ReflectionRetrieveOptions = {},
): Promise<CorrectionRecord[]> {
  const { landOperatorId = null, destination = null, limit = 6, minSeverity = 'medium' } = options;
  const minRank = SEVERITY_RANK[minSeverity];

  // 동일 랜드사+지역
  const buckets: CorrectionRecord[][] = [];
  if (landOperatorId && destination) {
    const { data } = await sb
      .from('extractions_corrections')
      .select('id, field_path, reflection, before_value, after_value, raw_text_excerpt, severity, category, created_at, applied_count, land_operator_id, destination')
      .eq('is_active', true)
      .eq('land_operator_id', landOperatorId)
      .eq('destination', destination)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (data) buckets.push(data as CorrectionRecord[]);
  }

  // 동일 지역 (다른 랜드사)
  if (destination && buckets.flat().length < limit) {
    const exclude = buckets.flat().map(r => r.id);
    let query = sb
      .from('extractions_corrections')
      .select('id, field_path, reflection, before_value, after_value, raw_text_excerpt, severity, category, created_at, applied_count, land_operator_id, destination')
      .eq('is_active', true)
      .eq('destination', destination)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (exclude.length > 0) query = query.not('id', 'in', `(${exclude.join(',')})`);
    if (landOperatorId) query = query.neq('land_operator_id', landOperatorId);
    const { data } = await query;
    if (data) buckets.push(data as CorrectionRecord[]);
  }

  // 동일 랜드사 (다른 지역)
  if (landOperatorId && buckets.flat().length < limit) {
    const exclude = buckets.flat().map(r => r.id);
    let query = sb
      .from('extractions_corrections')
      .select('id, field_path, reflection, before_value, after_value, raw_text_excerpt, severity, category, created_at, applied_count, land_operator_id, destination')
      .eq('is_active', true)
      .eq('land_operator_id', landOperatorId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (exclude.length > 0) query = query.not('id', 'in', `(${exclude.join(',')})`);
    if (destination) query = query.neq('destination', destination);
    const { data } = await query;
    if (data) buckets.push(data as CorrectionRecord[]);
  }

  // 글로벌 critical/high (모든 등록에 적용)
  if (buckets.flat().length < limit) {
    const exclude = buckets.flat().map(r => r.id);
    let query = sb
      .from('extractions_corrections')
      .select('id, field_path, reflection, before_value, after_value, raw_text_excerpt, severity, category, created_at, applied_count, land_operator_id, destination')
      .eq('is_active', true)
      .in('severity', ['critical', 'high'])
      .order('created_at', { ascending: false })
      .limit(limit);
    if (exclude.length > 0) query = query.not('id', 'in', `(${exclude.join(',')})`);
    const { data } = await query;
    if (data) buckets.push(data as CorrectionRecord[]);
  }

  // 합치고 severity + recency 점수 정렬
  const merged = buckets.flat();
  const seen = new Set<string>();
  const dedup: CorrectionRecord[] = [];
  for (const r of merged) {
    if (seen.has(r.id)) continue;
    if (SEVERITY_RANK[r.severity] < minRank) continue;
    seen.add(r.id);
    dedup.push(r);
  }

  // recency 점수: 최근일수록 ↑ (30일 이내 가중)
  const now = Date.now();
  dedup.sort((a, b) => {
    const aRank = SEVERITY_RANK[a.severity];
    const bRank = SEVERITY_RANK[b.severity];
    if (aRank !== bRank) return bRank - aRank;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return dedup.slice(0, limit);
}

/**
 * 정정 적용 횟수 증가 (효과 측정)
 */
export async function trackReflectionApplied(
  sb: SupabaseClient,
  correctionIds: string[],
): Promise<void> {
  if (correctionIds.length === 0) return;
  try {
    await sb.rpc('increment_correction_applied', { p_correction_ids: correctionIds });
  } catch (e) {
    console.warn('[reflection-memory] applied_count 증가 실패:', e instanceof Error ? e.message : e);
  }
}

/**
 * Prompt fragment 빌더 — normalize-with-llm 의 user message 에 주입.
 *
 * 결과 예:
 * ## 과거 정정 사례 (반드시 회피해야 할 패턴)
 *
 * ### [1] [CRITICAL · hallucination] field=inclusions[2]
 * 이전 등록 (2026-04-19) 에서 다음과 같은 정정이 있었습니다:
 * - ❌ AI 출력: "2억 여행자보험"
 * - ✅ 정답:  "여행자보험"
 * - 교훈: 원문에 금액 표기 없으면 inclusions 에 금액 삽입 금지
 *
 * ### [2] ...
 *
 * → 이번 추출에서는 같은 실수를 절대 반복하지 마세요.
 */
export function buildReflectionPromptFragment(reflections: CorrectionRecord[]): string {
  if (reflections.length === 0) return '';

  const blocks = reflections.map((r, i) => {
    const severityIcon = r.severity === 'critical' ? '🚨' : r.severity === 'high' ? '⚠️' : '·';
    const lines = [
      `### [${i + 1}] [${r.severity.toUpperCase()}${r.category ? ' · ' + r.category : ''}] field=${r.field_path}`,
    ];
    if (r.before_value !== null && r.before_value !== undefined) {
      lines.push(`- ❌ AI 이전 출력: ${JSON.stringify(r.before_value).slice(0, 200)}`);
    }
    if (r.after_value !== null && r.after_value !== undefined) {
      lines.push(`- ✅ 정답: ${JSON.stringify(r.after_value).slice(0, 200)}`);
    }
    if (r.reflection) {
      lines.push(`- 💡 교훈: ${r.reflection}`);
    }
    if (r.raw_text_excerpt) {
      lines.push(`- 📝 원문 위치: "${r.raw_text_excerpt.slice(0, 150)}"`);
    }
    return `${severityIcon} ${lines.join('\n')}`;
  });

  return [
    '## 과거 정정 사례 (반드시 회피해야 할 패턴 — Reflexion episodic memory)',
    '',
    '아래는 이전 등록에서 사장님이 직접 정정한 case 들입니다.',
    '동일한 실수를 절대 반복하지 마세요. 특히 CRITICAL 항목은 법적·고객 신뢰 리스크 직결.',
    '',
    ...blocks,
    '',
    '---',
    '',
  ].join('\n');
}
