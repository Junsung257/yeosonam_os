/**
 * @file package-reenrich-on-attraction-change.ts
 *
 * 사장님이 attractions 변경 (신규 추가 / alias 추가 / paste-and-parse 일괄 등록 / Wikidata 1-click)
 * 했을 때 영향받은 travel_packages 의 itinerary_data 자동 재계산 + ISR revalidate.
 *
 * STRICT SSOT (PR #93 갭 B 박제):
 *   PR #85 에서 제거한 "Same-Session Seed-Reflect" 흐름의 attraction-change 트리거 버전.
 *   사장님 paste 후 모바일 카드 즉시 반영 보장.
 *
 * 영향 범위:
 *   1. resolved_attraction_id 가 신규 attraction 인 unmatched_activities 의 package_id 수집
 *   2. 또는 신규 attraction.region 으로 필터된 패키지 (광역 sweep)
 *   3. 각 패키지의 itinerary_data 에 대해 enrichItineraryWithAttractionReferences 재실행
 *   4. matchedCanonicalNames 변경 있으면 UPDATE + revalidatePath
 *
 * 안전: fire-and-forget 가능 (사장님 응답 블로킹하지 않음).
 */

import { revalidatePath } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from './supabase';
import { enrichItineraryWithAttractionReferences, type ItineraryDataLike } from './itinerary-attraction-enricher';
import type { AttractionData } from './attraction-matcher';

export interface ReEnrichResult {
  scanned_packages: number;
  updated_packages: number;
  revalidated_paths: number;
  duration_ms: number;
  errors: number;
}

/**
 * 영향받은 패키지 자동 re-enrich.
 *
 * @param attractionIds 변경된 attraction ID 배열 (필수). region 광역 sweep 막기 위해 명시 권장.
 * @param options.maxPackages 한 번에 처리할 최대 패키지 수 (default 100, 대량 변경 시 폭주 방지)
 * @param options.forceRevalidate true 면 attraction_ids 변경 없어도 revalidatePath 호출.
 *   PR #98: 사진/desc/emoji 만 변경 시 itinerary_data 변경은 없지만 모바일 카드 즉시 반영 위해 필요.
 */
export async function reEnrichAffectedPackages(
  attractionIds: string[],
  options: { maxPackages?: number; forceRevalidate?: boolean } = {},
): Promise<ReEnrichResult> {
  const start = Date.now();
  const result: ReEnrichResult = {
    scanned_packages: 0,
    updated_packages: 0,
    revalidated_paths: 0,
    duration_ms: 0,
    errors: 0,
  };

  if (!isSupabaseConfigured || attractionIds.length === 0) {
    result.duration_ms = Date.now() - start;
    return result;
  }

  const maxPackages = options.maxPackages ?? 100;

  try {
    // 1) 영향받은 attractions fetch (region/country 추출용)
    const { data: attrs } = await supabaseAdmin
      .from('attractions')
      .select('id, name, aliases, region, country, short_desc, badge_type, emoji, category, mrt_gid')
      .in('id', attractionIds)
      .eq('is_active', true);
    const attractions = (attrs ?? []) as AttractionData[];
    if (attractions.length === 0) {
      result.duration_ms = Date.now() - start;
      return result;
    }

    // 2) 영향받은 패키지 수집:
    //    (a) unmatched_activities 의 package_id 중 attraction_ids 와 매칭된 것
    //    (b) attractions[].region 과 매칭되는 travel_packages.destination
    const packageIdSet = new Set<string>();

    // (a) unmatched 큐 통한 영향
    const { data: viaUnmatched } = await supabaseAdmin
      .from('unmatched_activities')
      .select('package_id')
      .in('resolved_attraction_id', attractionIds)
      .not('package_id', 'is', null)
      .limit(maxPackages * 3);
    for (const r of (viaUnmatched ?? []) as Array<{ package_id: string | null }>) {
      if (r.package_id) packageIdSet.add(r.package_id);
    }

    // (b) destination 광역 (regions 기반)
    const regions = [...new Set(attractions.map(a => a.region).filter(Boolean))] as string[];
    if (regions.length > 0 && packageIdSet.size < maxPackages) {
      // ilike OR 조건은 PostgREST 한계 — 단순 region match
      for (const region of regions) {
        const { data: viaRegion } = await supabaseAdmin
          .from('travel_packages')
          .select('id')
          .ilike('destination', `%${region}%`)
          .eq('status', 'active')
          .limit(maxPackages);
        for (const r of (viaRegion ?? []) as Array<{ id: string }>) {
          packageIdSet.add(r.id);
          if (packageIdSet.size >= maxPackages) break;
        }
        if (packageIdSet.size >= maxPackages) break;
      }
    }

    const packageIds = [...packageIdSet].slice(0, maxPackages);
    result.scanned_packages = packageIds.length;
    if (packageIds.length === 0) {
      result.duration_ms = Date.now() - start;
      return result;
    }

    // 3) 모든 활성 attractions fetch (매칭 정확도 위해 전체 candidates 필요)
    const allAttrs: AttractionData[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('attractions')
        .select('id, name, aliases, region, country, short_desc, badge_type, emoji, category, mrt_gid')
        .eq('is_active', true)
        .order('id')
        .range(offset, offset + 999);
      if (error) break;
      if (!data || data.length === 0) break;
      allAttrs.push(...((data as AttractionData[]) ?? []));
      if (data.length < 1000) break;
      offset += 1000;
    }

    // 4) 각 패키지 fetch + enrich + update
    for (const pid of packageIds) {
      try {
        const { data: pkg } = await supabaseAdmin
          .from('travel_packages')
          .select('id, destination, itinerary_data')
          .eq('id', pid)
          .maybeSingle() as { data: { id: string; destination: string | null; itinerary_data: ItineraryDataLike | null } | null };
        if (!pkg) continue;

        const re = enrichItineraryWithAttractionReferences(
          pkg.itinerary_data,
          allAttrs,
          pkg.destination ?? undefined,
        );

        // 변경 감지: 기존 itinerary_data 와 attraction_ids 차이
        const beforeIds = new Set<string>();
        for (const day of (pkg.itinerary_data as { days?: Array<{ schedule?: Array<{ attraction_ids?: string[] }> }> } | null)?.days ?? []) {
          for (const item of day.schedule ?? []) {
            for (const id of item.attraction_ids ?? []) beforeIds.add(id);
          }
        }
        const afterIds = new Set<string>();
        for (const day of (re.itineraryData as { days?: Array<{ schedule?: Array<{ attraction_ids?: string[] }> }> } | null)?.days ?? []) {
          for (const item of day.schedule ?? []) {
            for (const id of item.attraction_ids ?? []) afterIds.add(id);
          }
        }
        const hasChange = beforeIds.size !== afterIds.size
          || [...afterIds].some(id => !beforeIds.has(id));

        // PR #98 — forceRevalidate=true 면 attraction_ids 변경 없어도 ISR 무효화.
        //   사진/desc/emoji 만 수정 시 itinerary_data 의 attraction_ids 변경 없지만
        //   모바일은 attraction_ids 로 attractions 테이블 직접 fetch 하므로 ISR 캐시 무효화 필요.
        if (!hasChange && !options.forceRevalidate) continue;

        if (hasChange) {
          const { error: upErr } = await supabaseAdmin
            .from('travel_packages')
            .update({
              itinerary_data: re.itineraryData,
              updated_at: new Date().toISOString(),
            })
            .eq('id', pid);
          if (upErr) {
            result.errors++;
            continue;
          }
          result.updated_packages++;
        }

        // ISR revalidate (모바일 즉시 반영) — hasChange 또는 forceRevalidate 시 호출
        try {
          revalidatePath(`/packages/${pid}`);
          revalidatePath(`/m/packages/${pid}`);
          result.revalidated_paths += 2;
        } catch {
          // revalidatePath 가 server context 외 호출 시 throw — 무시
        }
      } catch {
        result.errors++;
      }
    }
  } catch (e) {
    console.warn('[reEnrichAffectedPackages] 실패:', e instanceof Error ? e.message : e);
    result.errors++;
  }

  result.duration_ms = Date.now() - start;
  return result;
}
