/**
 * unmatched_activities 자동 재매칭 헬퍼
 *
 * ERR-unmatched-stale-after-alias@2026-04-29 해결:
 *   alias 적립/신규 attraction 등록 후 기존 unmatched 큐 자동 갱신.
 *
 * 사용처:
 *   - PATCH /api/attractions (alias·name 변경 후 hook)
 *   - POST  /api/attractions (신규 attraction 추가 후 hook)
 *   - GET   /api/cron/resweep-unmatched (일일 안전망 cron)
 *   - CLI   db/resweep_unmatched_activities.js (사장님 수동 실행)
 *
 * 동작:
 *   1) attractionIds 가 명시되면 그 attraction(s) 만 매칭 대상으로 좁힘 (좁은 sweep, 빠름)
 *      attractionIds 가 없으면 모든 attractions 와 매칭 (전체 sweep, 일일 cron 용)
 *   2) resolved_at IS NULL 인 unmatched_activities 만 처리
 *   3) 매칭 성공 → resolved_at/resolved_kind/resolved_attraction_id set
 *
 * 안전성:
 *   - status 컬럼은 변경하지 않음 (check constraint 호환)
 *   - 신규 attraction 시드 안 함 (ERR-20260418-33 정책 준수)
 *   - fire-and-forget 가능 (await 없이 호출 시 background 실행)
 */

import { supabaseAdmin, isSupabaseConfigured } from './supabase';

interface AttractionLike {
  id: string;
  name: string;
  aliases?: string[] | null;
  region?: string | null;
  country?: string | null;
}

interface UnmatchedRow {
  id: string;
  activity: string;
  region: string | null;
  country: string | null;
}

const cleanText = (t: string | null | undefined): string =>
  String(t || '')
    .replace(/^[▶☆※♣*]+\s*/, '')
    .replace(/[(\[].*?[)\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

function matchAttr(activity: string, candidates: AttractionLike[]): { attr: AttractionLike; via: string } | null {
  const clean = cleanText(activity);
  if (!clean) return null;
  for (const a of candidates) {
    const terms = [a.name, ...(a.aliases || [])].filter(Boolean);
    for (const t of terms) {
      const tc = String(t).toLowerCase().trim();
      if (tc.length < 2) continue;
      if (clean.includes(tc) || tc.includes(clean)) return { attr: a, via: t };
    }
  }
  return null;
}

async function fetchAttractionsAll(): Promise<AttractionLike[]> {
  const result: AttractionLike[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('attractions')
      .select('id, name, aliases, region, country')
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    result.push(...(data as AttractionLike[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return result;
}

export interface SweepResult {
  scanned: number;
  matched: number;
  unmatched: number;
  errors: number;
  durationMs: number;
}

/**
 * unmatched 큐 재매칭.
 * @param attractionIds — 좁은 sweep (이 attraction(s) 만 매칭). 없으면 전체.
 */
export async function resweepUnmatchedActivities(attractionIds?: string[]): Promise<SweepResult> {
  const start = Date.now();
  if (!isSupabaseConfigured) {
    return { scanned: 0, matched: 0, unmatched: 0, errors: 0, durationMs: 0 };
  }

  // 1) candidates 결정
  let candidates: AttractionLike[];
  if (attractionIds && attractionIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('attractions')
      .select('id, name, aliases, region, country')
      .in('id', attractionIds);
    if (error) throw error;
    candidates = (data as AttractionLike[]) || [];
  } else {
    candidates = await fetchAttractionsAll();
  }
  if (candidates.length === 0) {
    return { scanned: 0, matched: 0, unmatched: 0, errors: 0, durationMs: Date.now() - start };
  }

  // 2) 미해결 unmatched fetch (page)
  const unmatched: UnmatchedRow[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('unmatched_activities')
      .select('id, activity, region, country')
      .is('resolved_at', null)
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    unmatched.push(...(data as UnmatchedRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  // 3) 매칭 시도
  const now = new Date().toISOString();
  let matched = 0;
  let errors = 0;
  for (const u of unmatched) {
    const m = matchAttr(u.activity, candidates);
    if (!m) continue;
    const { error } = await supabaseAdmin
      .from('unmatched_activities')
      .update({
        resolved_at: now,
        resolved_kind: 'auto_resweep',
        resolved_attraction_id: m.attr.id,
        resolved_by: attractionIds ? 'attraction_hook' : 'cron_resweep',
      })
      .eq('id', u.id);
    if (error) errors++;
    else matched++;
  }

  return {
    scanned: unmatched.length,
    matched,
    unmatched: unmatched.length - matched,
    errors,
    durationMs: Date.now() - start,
  };
}
