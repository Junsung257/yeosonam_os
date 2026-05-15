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
import { paraphraseExternal, generateGenericShortDesc } from './paraphrase-enforcer';

interface ExternalDescription {
  source: 'wikidata' | 'mrt' | 'hanatour' | 'modetour' | 'manual';
  url: string | null;
  text: string;
  fetched_at: string;
}

const MIN_DESC_LENGTH = 30;
const MAX_RAW_DESCRIPTIONS = 5;

/**
 * G1 + Y2 박제 (2026-05-15): active learning 폐쇄 루프.
 *   1. 사장님이 ✅정확 피드백한 attraction (attraction_feedback.verdict='accurate') 우선
 *   2. confidence_score ≥ 0.7 우선
 *   3. 같은 category/region 매칭
 *
 * 사장님 도메인 전문성이 다음 시드 prompt 의 few-shot demo 로 자동 학습 →
 *   compound improvement (운영할수록 똑똑).
 */
async function retrieveSimilarAttractionDemos(args: {
  category: string;
  destination: string | null;
  limit: number;
}): Promise<Array<{ name: string; short_desc: string }>> {
  try {
    // Y2: 사장님 accurate 피드백 받은 attraction ID 우선 retrieve (compound learning)
    const { data: accurateFeedback } = await supabaseAdmin
      .from('attraction_feedback')
      .select('attraction_id')
      .eq('verdict', 'accurate')
      .order('created_at', { ascending: false })
      .limit(50);
    const accurateIds = new Set(
      ((accurateFeedback ?? []) as Array<{ attraction_id: string }>).map(r => r.attraction_id),
    );

    let q = supabaseAdmin
      .from('attractions')
      .select('id, name, short_desc, confidence_score')
      .eq('is_active', true)
      .eq('category', args.category)
      .not('short_desc', 'is', null)
      .gte('confidence_score', 0.5); // 신뢰도 낮은 attraction 은 demo 에서 제외 (오염 차단)
    if (args.destination) {
      q = q.ilike('region', `%${args.destination}%`);
    }
    const { data } = await q.limit(args.limit * 3); // 가져온 뒤 정렬·필터
    let rows = (data ?? []) as Array<{ id: string; name: string; short_desc: string; confidence_score: number }>;
    rows = rows.filter(d => d.short_desc && d.short_desc.length >= 10);

    if (rows.length === 0 && args.destination) {
      // region fallback — 같은 category 전체
      const { data: fallback } = await supabaseAdmin
        .from('attractions')
        .select('id, name, short_desc, confidence_score')
        .eq('is_active', true)
        .eq('category', args.category)
        .not('short_desc', 'is', null)
        .gte('confidence_score', 0.5)
        .limit(args.limit * 3);
      rows = ((fallback ?? []) as Array<{ id: string; name: string; short_desc: string; confidence_score: number }>)
        .filter(d => d.short_desc && d.short_desc.length >= 10);
    }

    // Y2 정렬: 사장님 accurate 피드백 우선 → confidence_score 내림차순
    rows.sort((a, b) => {
      const aAccurate = accurateIds.has(a.id) ? 1 : 0;
      const bAccurate = accurateIds.has(b.id) ? 1 : 0;
      if (aAccurate !== bAccurate) return bAccurate - aAccurate;
      return (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
    });

    return rows.slice(0, args.limit).map(r => ({ name: r.name, short_desc: r.short_desc }));
  } catch {
    return [];
  }
}

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

    // 2) external descriptions 수집 (Wikidata 한→영 fallback, MRT 는 별도 호출자가 사전 주입)
    const externalDescs = await fetchWikidataDescription(name, args.country ?? null);

    // 3) paraphrase enforcer (Wikidata 있을 때만)
    let shortDescResult: { text: string; ok: boolean; similarity: number; attempts: number } = { text: '', ok: false, similarity: 0, attempts: 0 };
    let longDescResult: { text: string; ok: boolean; similarity: number; attempts: number } = { text: '', ok: false, similarity: 0, attempts: 0 };
    let bestSource: ExternalDescription | null = externalDescs[0] ?? null;

    // G1 박제 (2026-05-15): 같은 category/region 의 기존 attraction short_desc 패턴 retrieve.
    //   비용 0 (단일 SELECT). LLM paraphrase prompt 에 demo 로 주입하여 일관된 톤 학습.
    const fewShotDemos = await retrieveSimilarAttractionDemos({
      category: args.category ?? 'sightseeing',
      destination: args.destination ?? null,
      limit: 3,
    });

    if (bestSource) {
      shortDescResult = await paraphraseExternal({
        originalText: bestSource.text.slice(0, 200),
        style: 'short_desc',
        attractionName: name,
        destination: args.destination ?? null,
        fewShotDemos,
        enableSelfRefine: true, // G2: 사실 명시 위반·과장 자동 차단
      });
      longDescResult = bestSource.text.length > 200
        ? await paraphraseExternal({
            originalText: bestSource.text,
            style: 'long_desc',
            attractionName: name,
            destination: args.destination ?? null,
            fewShotDemos,
            enableSelfRefine: true,
          })
        : { text: '', ok: false, similarity: 0, attempts: 0 };
    }

    // E5 박제 (2026-05-15): paraphrase 실패 또는 외부 source 없을 때 LLM short generate fallback.
    //   카드 비어보임 차단. short_desc 만 보장하고 long_desc 는 null 허용.
    if (!shortDescResult.ok) {
      const generic = await generateGenericShortDesc({
        attractionName: name,
        destination: args.destination ?? null,
      });
      if (generic.ok) {
        shortDescResult = { text: generic.text, ok: true, similarity: 0, attempts: 99 };
        if (!bestSource) {
          // 외부 source 0건이면 source 정보를 'manual' 로 기록 (LLM 자체 생성)
          bestSource = {
            source: 'manual',
            url: null,
            text: generic.text,
            fetched_at: new Date().toISOString(),
          };
        }
      } else {
        return { seeded: false, reason: bestSource ? 'paraphrase_failed' : 'no_external_source' };
      }
    }

    // 4) attractions INSERT
    const insertedRow = await supabaseAdmin
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
        source: bestSource!.source,
        external_url: bestSource!.url,
        confidence_score: shortDescResult.similarity > 0 ? 0.7 : 0.4, // LLM 자체 생성은 낮은 confidence
        raw_descriptions: externalDescs.slice(0, MAX_RAW_DESCRIPTIONS),
        seeded_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertedRow.error || !insertedRow.data) {
      return { seeded: false, reason: `insert_error: ${insertedRow.error?.message ?? 'unknown'}` };
    }
    const attractionId = (insertedRow.data as { id: string }).id;

    // E4 박제 (2026-05-15): 시드 직후 Pexels multilingual photos 자동 attach (fire-and-forget).
    //   사장님 비전 "사진 매칭 자동" — 새 attraction 카드가 즉시 사진 포함되도록.
    void attachPhotosToAttraction({
      attractionId,
      name,
      destination: args.destination ?? null,
    });

    // E1 박제 (2026-05-15): 하나투어/모두투어 검색 결과로부터 alias 정규화 보강 (fire-and-forget).
    //   사장님 비전 "OTA 검색으로 관광지 표기 정형화". 사실(공개 명칭) 추출은 저작권 안전.
    //   SPA 라 실패할 수 있어 fail-soft. 출처 URL 보존.
    void attachOtaAliases({ attractionId, name });

    return {
      seeded: true,
      reason: `${bestSource!.source}+paraphrase(sim=${shortDescResult.similarity.toFixed(2)})`,
      attraction_id: attractionId,
    };
  } catch (e) {
    return { seeded: false, reason: `exception: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}

/**
 * E1 박제 (2026-05-15): 하나투어/모두투어 검색 결과로부터 alias 추출 → attractions.aliases 보강.
 * fire-and-forget. SPA 페이지면 후보 0 = fail-soft.
 */
async function attachOtaAliases(args: { attractionId: string; name: string }): Promise<void> {
  try {
    const { fetchOtaAliasCandidates } = await import('@/lib/parser/ota-name-normalizer');
    const candidates = await fetchOtaAliasCandidates(args.name);
    if (candidates.length === 0) return;

    const { data: existing } = await supabaseAdmin
      .from('attractions')
      .select('aliases, raw_descriptions')
      .eq('id', args.attractionId)
      .maybeSingle();
    const prevAliases = Array.isArray((existing as { aliases?: string[] } | null)?.aliases)
      ? ((existing as { aliases: string[] }).aliases)
      : [];
    const prevRawDescs = Array.isArray((existing as { raw_descriptions?: ExternalDescription[] } | null)?.raw_descriptions)
      ? ((existing as { raw_descriptions: ExternalDescription[] }).raw_descriptions)
      : [];

    // 중복 제거 + 합집합 (lowercase 비교)
    const aliasSet = new Set(prevAliases.map(a => a.toLowerCase().replace(/\s+/g, '')));
    const newAliases: string[] = [...prevAliases];
    for (const c of candidates) {
      const key = c.alias.toLowerCase().replace(/\s+/g, '');
      if (!aliasSet.has(key)) {
        aliasSet.add(key);
        newAliases.push(c.alias);
      }
    }

    // raw_descriptions 에 출처 URL 박제 (투명성)
    const sourceTrace: ExternalDescription[] = candidates.slice(0, 2).map(c => ({
      source: c.source,
      url: c.source_url,
      text: `[alias normalization] ${c.alias}`,
      fetched_at: c.fetched_at,
    }));

    await supabaseAdmin
      .from('attractions')
      .update({
        aliases: newAliases,
        raw_descriptions: [...prevRawDescs, ...sourceTrace].slice(0, MAX_RAW_DESCRIPTIONS),
      })
      .eq('id', args.attractionId)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn('[AutoSeed] OTA aliases UPDATE 실패(무시):', error.message);
        else console.log(`[AutoSeed] OTA aliases: ${args.name} (+${candidates.length}건)`);
      });
  } catch (e) {
    console.warn('[AutoSeed] OTA aliases 실패(무시):', e instanceof Error ? e.message : e);
  }
}

/**
 * E4 박제 (2026-05-15): 시드된 attraction 에 Pexels multilingual photos 자동 attach.
 * fire-and-forget. Pexels API 없으면 skip.
 */
async function attachPhotosToAttraction(args: {
  attractionId: string;
  name: string;
  destination: string | null;
}): Promise<void> {
  try {
    const { searchMultilingualPhotos } = await import('@/lib/parser/multilingual-photo');
    const photos = await searchMultilingualPhotos({
      englishKeyword: args.name,
      // destination 없으면 영문 only (attraction name 자체를 지역어로 넘기면 무의미 검색)
      destinationKorean: args.destination ?? undefined,
      count: 5,
    });
    if (photos.length === 0) {
      // X4-2 박제 (2026-05-15): photos 0건 시드된 attraction 어드민 alert (Pexels API fail / 검색 결과 0건 자동 감지).
      try {
        const { postAlert } = await import('@/lib/admin-alerts');
        await postAlert({
          category: 'general',
          severity: 'info',
          title: `attraction 사진 누락: ${args.name}`,
          message: `Pexels multilingual 검색 결과 0건 — 어드민에서 수동 사진 추가 권장`,
          ref_type: 'attraction',
          ref_id: args.attractionId,
          meta: { name: args.name, destination: args.destination },
          dedupe: true,
        });
      } catch { /* swallow */ }
      return;
    }

    // F3 박제: AttractionData.photos 타입 (photographer: string, pexels_id: number) 일관성 보장.
    const photoRows = photos.slice(0, 3).map(p => ({
      src_medium: p.src.medium,
      src_large: p.src.large,
      photographer: p.photographer ?? '',
      pexels_id: p.pexels_id ?? 0,
    }));

    await supabaseAdmin
      .from('attractions')
      .update({ photos: photoRows })
      .eq('id', args.attractionId)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn('[AutoSeed] attachPhotos UPDATE 실패(무시):', error.message);
        else console.log(`[AutoSeed] photos attached: ${args.name} (${photoRows.length})`);
      });
  } catch (e) {
    console.warn('[AutoSeed] attachPhotos 실패(무시):', e instanceof Error ? e.message : e);
  }
}

/**
 * Wikidata POI 설명 조회 — 무료, ToS clean, 한국어 우선 + 영문 fallback (2026-05-15 E3 박제).
 * MediaWiki Wikipedia REST API 직접 호출. 한국어 페이지 없으면 영문 시도 (베트남/중국 관광지 흡수).
 */
async function fetchWikidataDescription(name: string, _country: string | null): Promise<ExternalDescription[]> {
  const results: ExternalDescription[] = [];
  const langs: { code: 'ko' | 'en'; minLength: number }[] = [
    { code: 'ko', minLength: MIN_DESC_LENGTH },
    { code: 'en', minLength: MIN_DESC_LENGTH * 2 }, // 영문은 길면 paraphrase 가 한국어로 재구성
  ];

  for (const { code, minLength } of langs) {
    if (results.length > 0) break; // 한국어 성공 시 영문 skip (비용 절약)
    try {
      const url = `https://${code}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'YeosonamOS/1.0 (catalog assist; contact: admin@yeosonam.com)' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const extract = (json as { extract?: string }).extract;
      if (!extract || extract.length < minLength) continue;
      results.push({
        source: 'wikidata',
        url: (json as { content_urls?: { desktop?: { page?: string } } }).content_urls?.desktop?.page ?? null,
        text: extract,
        fetched_at: new Date().toISOString(),
      });
    } catch {
      /* Wikipedia 실패 swallow → 다음 lang 시도 */
    }
  }
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
