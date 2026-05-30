/**
 * @file semantic-extraction-cache.ts — P14-1 등록 추출 결과 cache (LLM 토큰 ~20% 절약)
 *
 * 박제 사유 (2026-05-13):
 * 같은 raw_text 재업로드 또는 유사 패키지 등록 시 LLM 다시 호출하지 않고 cache hit.
 * raw_text SHA-256 hash + destination 기반 단순 lookup. TTL 30일.
 *
 * 정책:
 * - 정확 hash 매치 → 즉시 hit (LLM 호출 0)
 * - 사장님 정정 (rejected) → 해당 cache 무효화
 */

import { createHash } from 'crypto';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import type { ExtractedData } from '@/lib/parser';
import { safeRawTextExcerpt } from '@/lib/raw-text-privacy';

export function hashRawText(rawText: string): string {
  return createHash('sha256').update(rawText.trim()).digest('hex');
}

export async function lookupExtractionCache(rawText: string): Promise<ExtractedData | null> {
  if (!isSupabaseConfigured || !rawText || rawText.length < 200) return null;
  const hash = hashRawText(rawText);

  try {
    const { data } = await supabaseAdmin
      .from('semantic_extraction_cache')
      .select('cached_extracted_data, hit_count, ttl_expires_at')
      .eq('raw_text_hash', hash)
      .maybeSingle();

    if (!data) return null;
    const row = data as { cached_extracted_data: ExtractedData; hit_count: number; ttl_expires_at: string };

    // TTL 검증
    if (new Date(row.ttl_expires_at) < new Date()) {
      void supabaseAdmin.from('semantic_extraction_cache').delete().eq('raw_text_hash', hash);
      return null;
    }

    // hit_count 증가
    void supabaseAdmin
      .from('semantic_extraction_cache')
      .update({ hit_count: row.hit_count + 1, last_hit_at: new Date().toISOString() })
      .eq('raw_text_hash', hash);

    console.log(`[semantic-cache] HIT (hash=${hash.slice(0, 12)} count=${row.hit_count + 1})`);
    return row.cached_extracted_data;
  } catch (e) {
    console.warn('[semantic-cache] lookup 실패:', (e as Error).message);
    return null;
  }
}

export async function storeExtractionCache(args: {
  rawText: string;
  extractedData: ExtractedData;
  confidence: number;
  destination?: string | null;
  landOperatorId?: string | null;
}): Promise<void> {
  if (!isSupabaseConfigured || !args.rawText || args.rawText.length < 200) return;
  const hash = hashRawText(args.rawText);

  try {
    // UPSERT
    await supabaseAdmin
      .from('semantic_extraction_cache')
      .upsert({
        raw_text_hash:         hash,
        raw_text_snippet:      safeRawTextExcerpt(args.rawText) ?? '',
        destination:           args.destination ?? null,
        land_operator_id:      args.landOperatorId ?? null,
        cached_extracted_data: args.extractedData,
        confidence:            args.confidence,
        ttl_expires_at:        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'raw_text_hash' });
  } catch (e) {
    console.warn('[semantic-cache] store 실패:', (e as Error).message);
  }
}

export async function invalidateCacheByPackageId(packageId: string): Promise<void> {
  // 사장님 정정/거절 시 호출 — 해당 등록의 cache 무효화
  if (!isSupabaseConfigured) return;
  try {
    const { data: pkg } = await supabaseAdmin
      .from('travel_packages')
      .select('raw_text')
      .eq('id', packageId)
      .maybeSingle();
    if (pkg && (pkg as { raw_text: string }).raw_text) {
      const hash = hashRawText((pkg as { raw_text: string }).raw_text);
      await supabaseAdmin
        .from('semantic_extraction_cache')
        .delete()
        .eq('raw_text_hash', hash);
    }
  } catch (e) {
    console.warn('[semantic-cache] invalidate 실패:', (e as Error).message);
  }
}

export async function getCacheStats(): Promise<{ total: number; total_hits: number; avg_hits: number; ttl_expired: number }> {
  if (!isSupabaseConfigured) return { total: 0, total_hits: 0, avg_hits: 0, ttl_expired: 0 };
  try {
    const { data } = await supabaseAdmin
      .from('semantic_extraction_cache')
      .select('hit_count, ttl_expires_at');
    const rows = (data ?? []) as Array<{ hit_count: number; ttl_expires_at: string }>;
    const total = rows.length;
    const totalHits = rows.reduce((s, r) => s + (r.hit_count ?? 0), 0);
    const now = Date.now();
    const ttlExpired = rows.filter(r => new Date(r.ttl_expires_at).getTime() < now).length;
    return {
      total,
      total_hits: totalHits,
      avg_hits: total > 0 ? Math.round((totalHits / total) * 100) / 100 : 0,
      ttl_expired: ttlExpired,
    };
  } catch {
    return { total: 0, total_hits: 0, avg_hits: 0, ttl_expired: 0 };
  }
}
