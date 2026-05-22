/**
 * 옛 등록물 section backfill 일괄 (B5 cron + db/backfill_legacy_sections.mjs SSOT).
 *
 * 대상:
 *   A2 — excludes 콤마-split 시그니처 → force=true (우선)
 *   A1 — price_dates 비어 있음 → force=false
 *
 * 감사: docs/audits/2026-05-20-legacy-sections-broken.md §B5
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { looksLikeCommaSplitBroken } from '@/lib/parser/deterministic/comma-split-signature';
import { backfillSectionsByPackageId } from '@/lib/parser/llm/section-extractors';

export const LEGACY_SECTIONS_BATCH_LIMIT = 30;

export type LegacyBackfillCandidate = {
  id: string;
  title: string | null;
  force: boolean;
  reason: 'a2-excludes-broken' | 'a1-price-dates-empty';
};

export function classifyLegacyBackfillNeed(row: {
  price_dates?: unknown;
  excludes?: unknown;
}): LegacyBackfillCandidate['reason'] | null {
  if (looksLikeCommaSplitBroken(row.excludes as unknown[] | null | undefined)) {
    return 'a2-excludes-broken';
  }
  if (!Array.isArray(row.price_dates) || row.price_dates.length === 0) {
    return 'a1-price-dates-empty';
  }
  return null;
}

/** raw_text 있는 패키지 중 backfill 필요 건을 A2 우선으로 limit 건 선별 */
export async function listLegacyBackfillCandidates(limit = LEGACY_SECTIONS_BATCH_LIMIT): Promise<LegacyBackfillCandidate[]> {
  if (!isSupabaseConfigured) return [];

  const poolLimit = Math.max(limit * 4, 200);

  // A1: price_dates 비어 있음 — updated_at 갱신돼도 재선별되도록 DB 조건 사용
  const { data: a1Rows, error: a1Err } = await supabaseAdmin
    .from('travel_packages')
    .select('id, title, price_dates, excludes')
    .or('price_dates.is.null,price_dates.eq.[]')
    .order('updated_at', { ascending: true })
    .limit(poolLimit);

  // A2: excludes 콤마-split (price_dates 있어도 대상)
  const { data: a2Rows, error: a2Err } = await supabaseAdmin
    .from('travel_packages')
    .select('id, title, price_dates, excludes')
    .not('excludes', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(poolLimit);

  if (a1Err && a2Err) return [];

  const a2: LegacyBackfillCandidate[] = [];
  const a1: LegacyBackfillCandidate[] = [];
  const seen = new Set<string>();

  for (const row of a2Rows ?? []) {
    const reason = classifyLegacyBackfillNeed(row as { price_dates?: unknown; excludes?: unknown });
    if (reason !== 'a2-excludes-broken') continue;
    const id = row.id as string;
    if (seen.has(id)) continue;
    seen.add(id);
    a2.push({
      id,
      title: (row as { title?: string | null }).title ?? null,
      force: true,
      reason,
    });
  }

  for (const row of a1Rows ?? []) {
    const id = row.id as string;
    if (seen.has(id)) continue;
    const reason = classifyLegacyBackfillNeed(row as { price_dates?: unknown; excludes?: unknown });
    if (reason !== 'a1-price-dates-empty') continue;
    seen.add(id);
    a1.push({
      id,
      title: (row as { title?: string | null }).title ?? null,
      force: false,
      reason,
    });
  }

  return [...a2, ...a1].slice(0, limit);
}

export type LegacyBackfillBatchResult = {
  scanned: number;
  processed: number;
  ok: number;
  fail: number;
  results: Array<{
    id: string;
    title: string | null;
    force: boolean;
    reason: string;
    ok: boolean;
    detail?: string;
  }>;
};

export async function runLegacySectionsBackfillBatch(
  options: { limit?: number; dryRun?: boolean } = {},
): Promise<LegacyBackfillBatchResult> {
  const limit = options.limit ?? LEGACY_SECTIONS_BATCH_LIMIT;
  const candidates = await listLegacyBackfillCandidates(limit);

  const result: LegacyBackfillBatchResult = {
    scanned: candidates.length,
    processed: 0,
    ok: 0,
    fail: 0,
    results: [],
  };

  if (options.dryRun) {
    result.results = candidates.map(c => ({
      id: c.id,
      title: c.title,
      force: c.force,
      reason: c.reason,
      ok: true,
      detail: 'dry-run',
    }));
    return result;
  }

  for (const c of candidates) {
    result.processed++;
    try {
      const r = await backfillSectionsByPackageId(c.id, { force: c.force });
      const ok = r.ok === true;
      if (ok) result.ok++;
      else result.fail++;
      result.results.push({
        id: c.id,
        title: c.title,
        force: c.force,
        reason: c.reason,
        ok,
        detail: ok ? undefined : (r.reason ?? 'backfill failed'),
      });
    } catch (e) {
      result.fail++;
      result.results.push({
        id: c.id,
        title: c.title,
        force: c.force,
        reason: c.reason,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
