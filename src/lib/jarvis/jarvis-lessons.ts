/**
 * 자비스 누적 학습 메모리 (Phase 2 — Lessons)
 *
 * V2 루프가 매번 zero-shot 인 문제 해결.
 *   - jarvis_lessons: 실패 교훈 / 정답 패턴 (운영자가 박제)
 *   - jarvis_admin_preferences: 어드민 반복 결정 자동 학습
 *
 * 사용:
 *   const prompt = await buildLessonsPromptFragment({ tenantId, agentType, message });
 *   const messages = [{ role: 'system', content: systemPrompt + prompt }, ...]
 *
 * SELECT 결과는 5분 메모리 캐시.
 */

import { supabaseAdmin, isSupabaseConfigured } from '../supabase';

interface JarvisLessonRow {
  id: string;
  tenant_id: string | null;
  agent_type: string | null;
  task_pattern: string | null;
  lesson_type: 'avoid' | 'prefer' | 'clarify';
  pattern: string;
  bad_action: string | null;
  good_action: string | null;
  severity: 'info' | 'warn' | 'block';
  applied_count: number;
}

const LESSON_CACHE = new Map<string, { rows: JarvisLessonRow[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 활성 lesson 들을 가져온 뒤 우선순위 정렬 + message 와 키워드 매칭하는 것만 필터.
 */
export async function getActiveLessons(params: {
  tenantId?: string | null;
  agentType?: string | null;
  message?: string;
  limit?: number;
}): Promise<JarvisLessonRow[]> {
  if (!isSupabaseConfigured) return [];

  const cacheKey = `${params.tenantId ?? '-'}:${params.agentType ?? '-'}`;
  const cached = LESSON_CACHE.get(cacheKey);
  let allRows: JarvisLessonRow[];

  if (cached && cached.expiresAt > Date.now()) {
    allRows = cached.rows;
  } else {
    try {
      let query = supabaseAdmin
        .from('jarvis_lessons')
        .select('id, tenant_id, agent_type, task_pattern, lesson_type, pattern, bad_action, good_action, severity, applied_count')
        .eq('is_active', true)
        .order('severity', { ascending: false })
        .order('applied_count', { ascending: false })
        .limit(50);
      if (params.agentType) {
        query = query.or(`agent_type.eq.${params.agentType},agent_type.is.null`);
      }
      const { data } = await query;
      allRows = (data ?? []) as JarvisLessonRow[];
      LESSON_CACHE.set(cacheKey, { rows: allRows, expiresAt: Date.now() + CACHE_TTL_MS });
    } catch (e) {
      console.warn('[jarvis-lessons] fetch 실패:', e);
      return [];
    }
  }

  // 우선순위 점수
  const msg = (params.message ?? '').toLowerCase();
  const score = (r: JarvisLessonRow): number => {
    let s = 0;
    if (params.tenantId && r.tenant_id === params.tenantId) s += 10;
    else if (!r.tenant_id) s += 1;
    if (params.agentType && r.agent_type === params.agentType) s += 5;
    else if (!r.agent_type) s += 1;
    if (r.severity === 'block') s += 5;
    else if (r.severity === 'warn') s += 2;
    // task_pattern keyword 매칭
    if (msg && r.task_pattern) {
      const keywords = r.task_pattern.toLowerCase().split(/[\s,|]+/).filter(Boolean);
      if (keywords.some((k) => msg.includes(k))) s += 8;
    }
    return s;
  };

  return allRows
    .map((r) => ({ r, s: score(r) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s)
    .slice(0, params.limit ?? 5)
    .map((x) => x.r);
}

export function buildLessonsPromptFragment(rows: JarvisLessonRow[]): string {
  if (!rows.length) return '';
  const lines = rows.map((r, idx) => {
    const typeMark =
      r.lesson_type === 'avoid' ? '🛑 회피' :
      r.lesson_type === 'prefer' ? '✅ 선호' : '❓ 확인';
    const severityMark = r.severity === 'block' ? ' (강제)' : r.severity === 'warn' ? ' (경고)' : '';
    let body = `[${idx + 1}] ${typeMark}${severityMark}: ${r.pattern}`;
    if (r.bad_action) body += `\n  하지 말 것: ${r.bad_action.slice(0, 150)}`;
    if (r.good_action) body += `\n  대신: ${r.good_action.slice(0, 150)}`;
    return body;
  });
  return `\n## 자비스 운영 교훈 (반드시 준수)\n${lines.join('\n')}\n`;
}

/** 새 lesson 박제 (어드민 UI 또는 incident 자동변환) */
export async function recordJarvisLesson(input: {
  tenantId?: string | null;
  agentType?: string | null;
  taskPattern?: string | null;
  lessonType: 'avoid' | 'prefer' | 'clarify';
  pattern: string;
  badAction?: string | null;
  goodAction?: string | null;
  severity?: 'info' | 'warn' | 'block';
  sourceIncidentId?: string | null;
  createdBy?: string | null;
}): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    await supabaseAdmin.from('jarvis_lessons').insert({
      tenant_id: input.tenantId ?? null,
      agent_type: input.agentType ?? null,
      task_pattern: input.taskPattern ?? null,
      lesson_type: input.lessonType,
      pattern: input.pattern,
      bad_action: input.badAction ?? null,
      good_action: input.goodAction ?? null,
      severity: input.severity ?? 'warn',
      source_incident_id: input.sourceIncidentId ?? null,
      created_by: input.createdBy ?? null,
    } as never);
    // 캐시 무효화
    LESSON_CACHE.clear();
  } catch (e) {
    console.warn('[jarvis-lessons] insert 실패:', e);
  }
}

// ─── jarvis_admin_preferences ───────────────────────────────────

export async function observeAdminPreference(input: {
  adminId: string;
  preferenceKey: string;
  preferenceValue: unknown;
}): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    // upsert: 같은 (admin_id, key)면 observed_count++, value 갱신
    const { data: existing } = await supabaseAdmin
      .from('jarvis_admin_preferences')
      .select('id, observed_count')
      .eq('admin_id', input.adminId)
      .eq('preference_key', input.preferenceKey)
      .limit(1);
    const existingRow = (existing && existing.length > 0)
      ? (existing[0] as { id: string; observed_count: number })
      : null;
    if (existingRow) {
      await supabaseAdmin
        .from('jarvis_admin_preferences')
        .update({
          preference_value: input.preferenceValue,
          observed_count: existingRow.observed_count + 1,
          last_observed_at: new Date().toISOString(),
        } as never)
        .eq('id', existingRow.id);
    } else {
      await supabaseAdmin.from('jarvis_admin_preferences').insert({
        admin_id: input.adminId,
        preference_key: input.preferenceKey,
        preference_value: input.preferenceValue,
      } as never);
    }
  } catch (e) {
    console.warn('[admin-preferences] 실패:', e);
  }
}

export async function loadAdminPreferences(adminId: string): Promise<Record<string, unknown>> {
  if (!isSupabaseConfigured || !adminId) return {};
  try {
    const { data } = await supabaseAdmin
      .from('jarvis_admin_preferences')
      .select('preference_key, preference_value, observed_count')
      .eq('admin_id', adminId)
      .gte('observed_count', 2);  // 2회 이상 반복된 결정만 학습으로 간주
    const out: Record<string, unknown> = {};
    for (const row of (data ?? []) as { preference_key: string; preference_value: unknown }[]) {
      out[row.preference_key] = row.preference_value;
    }
    return out;
  } catch (e) {
    console.warn('[admin-preferences] load 실패:', e);
    return {};
  }
}
