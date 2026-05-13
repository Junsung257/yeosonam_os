/**
 * @file rejection-pattern-analyzer.ts — 사장님 거절 사유 자동 패턴 추출 (P11-3, LLM 0)
 *
 * 박제 사유 (2026-05-13):
 * 거절 메모 텍스트에서 정규식 기반 패턴 자동 추출 → 반복 오류 통계 + Reflexion 학습.
 * `rejection_pattern_master` 테이블의 패턴을 cache 후 메모리에서 매칭 (DB 호출 1회).
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export interface RejectionPattern {
  pattern_id:   string;
  regex:        string;
  category:     string;
  severity:     'critical' | 'high' | 'medium' | 'low';
  description:  string | null;
}

export interface PatternMatchResult {
  pattern_id:  string;
  category:    string;
  severity:    'critical' | 'high' | 'medium' | 'low';
  matched:     string;
  description: string | null;
}

let patternCache: RejectionPattern[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadPatterns(): Promise<RejectionPattern[]> {
  if (patternCache && Date.now() < cacheExpiry) return patternCache;
  if (!isSupabaseConfigured) return [];
  try {
    const { data } = await supabaseAdmin
      .from('rejection_pattern_master')
      .select('pattern_id, regex, category, severity, description');
    patternCache = (data ?? []) as RejectionPattern[];
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    return patternCache;
  } catch {
    return [];
  }
}

/** 거절 메모 텍스트에서 모든 매치 패턴 추출 */
export async function analyzeRejection(reason: string | null | undefined): Promise<PatternMatchResult[]> {
  if (!reason || reason.trim().length === 0) return [];
  const patterns = await loadPatterns();
  const matches: PatternMatchResult[] = [];

  for (const p of patterns) {
    try {
      const re = new RegExp(p.regex, 'i');
      const m = reason.match(re);
      if (m) {
        matches.push({
          pattern_id:  p.pattern_id,
          category:    p.category,
          severity:    p.severity,
          matched:     m[0],
          description: p.description,
        });
      }
    } catch (e) {
      console.warn(`[rejection-analyzer] regex error for ${p.pattern_id}:`, (e as Error).message);
    }
  }
  return matches;
}

/** 최근 30일 거절 메모 통계 — 패턴별 빈도 + Slack 알림용 */
export async function getRecentRejectionStats(days = 30): Promise<Array<{ pattern_id: string; category: string; severity: string; count: number; description: string | null }>> {
  if (!isSupabaseConfigured) return [];
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data: rejected } = await supabaseAdmin
      .from('products')
      .select('internal_memo, updated_at')
      .eq('status', 'INACTIVE')
      .gte('updated_at', since);

    const patterns = await loadPatterns();
    const counts = new Map<string, { pattern: RejectionPattern; count: number }>();

    for (const row of (rejected ?? []) as Array<{ internal_memo: string | null }>) {
      const reason = row.internal_memo ?? '';
      for (const p of patterns) {
        try {
          if (new RegExp(p.regex, 'i').test(reason)) {
            const existing = counts.get(p.pattern_id);
            if (existing) existing.count++;
            else counts.set(p.pattern_id, { pattern: p, count: 1 });
          }
        } catch { /* ignore regex errors */ }
      }
    }

    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .map(({ pattern, count }) => ({
        pattern_id:  pattern.pattern_id,
        category:    pattern.category,
        severity:    pattern.severity,
        count,
        description: pattern.description,
      }));
  } catch (e) {
    console.warn('[rejection-analyzer] stats 실패:', (e as Error).message);
    return [];
  }
}

export function invalidatePatternCache() {
  patternCache = null;
  cacheExpiry = 0;
}
