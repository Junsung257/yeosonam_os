/**
 * @file auto-attraction-seeder.ts — 처음 본 키워드 자동 attraction 등록 (2026-05-14 박제)
 *
 * 사장님 정책 갱신 (ERR-20260418-33 갱신):
 *   외부 source 기반 + Paraphrase Enforcer + source URL 추적 시 자동 시드 허용.
 *
 * Pipeline:
 *   1. 키워드 → attractions exact/alias 매칭 시도 (이미 있으면 skip)
 *   2. wikidata-poi 검색 (Tier 2, 무료, ToS clean)
 *   3. MRT MCP 검색은 별도 모듈에서 (Tier 1, 우리 권한)
 *   4. raw_descriptions 에 외부 원문 저장 (internal, 고객 노출 X)
 *   5. paraphrase-enforcer → short/long_desc 생성 (고객 노출 OK)
 *   6. attractions UPSERT (source / external_url / confidence_score / seeded_at)
 *
 * fire-and-forget — 호출 측은 await 안 함.
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { paraphraseExternal } from './paraphrase-enforcer';

interface ExternalDescription {
  source: 'wikidata' | 'mrt' | 'hanatour' | 'modetour' | 'manual';
  url: string | null;
  text: string;
  fetched_at: string;
}

const MIN_DESC_LENGTH = 30;
const MAX_RAW_DESCRIPTIONS = 5;

/**
 * 단일 키워드 자동 시드. 백그라운드 호출 fire-and-forget.
 * 외부 source 조회 비용이 있으므로 사전에 attractions 캐시 확인 후 호출.
 */
export async function autoSeedAttraction(args: {
  keyword: string;
  destination?: string | null;
  country?: string | null;
  category?: string;
}): Promise<{ seeded: boolean; reason: string; attraction_id?: string }> {
  if (!isSupabaseConfigured) return { seeded: false, reason: 'no_db' };
  const name = args.keyword?.trim();
  if (!name || name.length < 2 || name.length > 100) {
    return { seeded: false, reason: 'invalid_name' };
  }

  try {
    // 1) 이미 있으면 skip
    const { data: existing } = await supabaseAdmin
      .from('attractions')
      .select('id, name, source, seeded_at')
      .ilike('name', name)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return { seeded: false, reason: 'already_exists', attraction_id: (existing as { id: string }).id };
    }

    // 2) external descriptions 수집 (Wikidata 만 우선 — Tier 1 MRT 는 별도 호출자가 사전 주입)
    const externalDescs = await fetchWikidataDescription(name, args.country ?? null);
    if (externalDescs.length === 0) {
      // Tier 1/2 모두 실패 → unmatched 큐에만 (자동 시드 안 함)
      return { seeded: false, reason: 'no_external_source' };
    }

    // 3) paraphrase enforcer
    const bestSource = externalDescs[0];
    const shortDescResult = await paraphraseExternal({
      originalText: bestSource.text.slice(0, 200),
      style: 'short_desc',
      attractionName: name,
      destination: args.destination ?? null,
    });
    const longDescResult = bestSource.text.length > 200
      ? await paraphraseExternal({
          originalText: bestSource.text,
          style: 'long_desc',
          attractionName: name,
          destination: args.destination ?? null,
        })
      : { text: '', ok: false, similarity: 0, attempts: 0 };

    if (!shortDescResult.ok) {
      return { seeded: false, reason: 'paraphrase_failed' };
    }

    // 4) attractions INSERT
    const { data: inserted, error } = await supabaseAdmin
      .from('attractions')
      .insert({
        name,
        short_desc: shortDescResult.text,
        long_desc: longDescResult.ok ? longDescResult.text : null,
        country: args.country ?? null,
        region: args.destination ?? null,
        category: args.category ?? 'sightseeing',
        emoji: '📍',
        is_active: true,
        mention_count: 1,
        source: bestSource.source,
        external_url: bestSource.url,
        confidence_score: shortDescResult.ok ? 0.7 : 0.5,
        raw_descriptions: externalDescs.slice(0, MAX_RAW_DESCRIPTIONS),
        seeded_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error || !inserted) {
      return { seeded: false, reason: `insert_error: ${error?.message ?? 'unknown'}` };
    }

    return {
      seeded: true,
      reason: `${bestSource.source}+paraphrase(sim=${shortDescResult.similarity.toFixed(2)})`,
      attraction_id: (inserted as { id: string }).id,
    };
  } catch (e) {
    return { seeded: false, reason: `exception: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}

/**
 * Wikidata POI 설명 조회 — 무료, ToS clean, 한국어 우선 + 영문 fallback.
 * MediaWiki API + Wikidata SPARQL 직접 호출.
 */
async function fetchWikidataDescription(name: string, country: string | null): Promise<ExternalDescription[]> {
  const results: ExternalDescription[] = [];
  try {
    // Wikipedia 한국어 요약 API
    const koUrl = `https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
    const koRes = await fetch(koUrl, {
      headers: { 'User-Agent': 'YeosonamOS/1.0 (catalog assist; contact: admin@yeosonam.com)' },
      signal: AbortSignal.timeout(8000),
    });
    if (koRes.ok) {
      const koJson = await koRes.json();
      const extract = (koJson as { extract?: string }).extract;
      if (extract && extract.length >= MIN_DESC_LENGTH) {
        results.push({
          source: 'wikidata',
          url: (koJson as { content_urls?: { desktop?: { page?: string } } }).content_urls?.desktop?.page ?? null,
          text: extract,
          fetched_at: new Date().toISOString(),
        });
      }
    }
  } catch {
    /* Wikipedia 실패 swallow */
  }
  // 추가 source 는 향후 확장 (MRT MCP 는 호출자가 주입)
  return results;
}

/**
 * MRT MCP 결과를 외부 source 로 주입할 때 사용. 호출자(예: upload/route.ts) 가 MRT 검색 결과를 받아 호출.
 */
export async function seedFromMrt(args: {
  name: string;
  mrt_gid: string;
  mrt_provider_url?: string | null;
  mrt_rating?: number | null;
  mrt_review_count?: number | null;
  description?: string | null;
  country?: string | null;
  region?: string | null;
  category?: string;
}): Promise<{ seeded: boolean; reason: string; attraction_id?: string }> {
  if (!isSupabaseConfigured) return { seeded: false, reason: 'no_db' };
  try {
    // mrt_gid 기준 upsert
    const externalDescs: ExternalDescription[] = args.description
      ? [{
          source: 'mrt',
          url: args.mrt_provider_url ?? null,
          text: args.description,
          fetched_at: new Date().toISOString(),
        }]
      : [];

    let shortDesc: string | null = null;
    let longDesc: string | null = null;
    if (args.description && args.description.length >= MIN_DESC_LENGTH) {
      const shortR = await paraphraseExternal({
        originalText: args.description.slice(0, 200),
        style: 'short_desc',
        attractionName: args.name,
        destination: args.region ?? args.country ?? null,
      });
      if (shortR.ok) shortDesc = shortR.text;
      if (args.description.length > 200) {
        const longR = await paraphraseExternal({
          originalText: args.description,
          style: 'long_desc',
          attractionName: args.name,
          destination: args.region ?? args.country ?? null,
        });
        if (longR.ok) longDesc = longR.text;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('attractions')
      .upsert({
        name: args.name,
        short_desc: shortDesc,
        long_desc: longDesc,
        country: args.country ?? null,
        region: args.region ?? null,
        category: args.category ?? 'sightseeing',
        emoji: '📍',
        is_active: true,
        mention_count: 1,
        source: 'mrt',
        external_url: args.mrt_provider_url ?? null,
        confidence_score: 0.9,
        raw_descriptions: externalDescs,
        seeded_at: new Date().toISOString(),
        mrt_gid: args.mrt_gid,
        mrt_rating: args.mrt_rating ?? null,
        mrt_review_count: args.mrt_review_count ?? null,
      }, { onConflict: 'mrt_gid', ignoreDuplicates: false })
      .select('id')
      .single();

    if (error || !data) return { seeded: false, reason: `insert_error: ${error?.message ?? 'unknown'}` };
    return { seeded: true, reason: 'mrt_canonical', attraction_id: (data as { id: string }).id };
  } catch (e) {
    return { seeded: false, reason: `exception: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}
