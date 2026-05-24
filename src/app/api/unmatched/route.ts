import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getUnmatchedBootstrapCandidates, getUnmatchedSummary } from '@/lib/unmatched-admin-queries';
import { getUnmatchedBootstrapEnvDefaults } from '@/lib/unmatched-bootstrap-config';
import { resweepUnmatchedActivities } from '@/lib/unmatched-resweep';
import { reEnrichAffectedPackages } from '@/lib/package-reenrich-on-attraction-change';

/**
 * POST /api/unmatched — 미매칭 관광지 자동 수집
 * 랜딩페이지 로드 시 미매칭 activity 목록 전송 → upsert
 * body: { items: Array<{ activity, package_id?, package_title?, day_number?, country?, region? }> }
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ success: false });

  try {
    const { items } = await request.json();
    if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ success: true, saved: 0 });

    // ── bounded-concurrency 병렬화 (Split 7 § 2.6) ──
    // RPC는 occurrence_count++ 의미를 보존하므로 per-row 호출 유지. 직렬 await만 제거.
    // CONCURRENCY=10 — 큰 배치(50+)에서도 connection pool 안전.
    const valid = items.filter((item: { activity?: string }) =>
      typeof item.activity === 'string' && item.activity.length >= 3
    );

    const CONCURRENCY = 10;
    let saved = 0;
    const upsertOne = async (item: { activity: string; package_id?: string; package_title?: string; day_number?: number; country?: string; region?: string }) => {
      const { error } = await supabaseAdmin.rpc('upsert_unmatched_activity', {
        p_activity: item.activity,
        p_package_id: item.package_id || null,
        p_package_title: item.package_title || null,
        p_day_number: item.day_number || null,
        p_country: item.country || null,
        p_region: item.region || null,
      }).single();

      if (error) {
        // RPC 부재 fallback — count 갱신 없이 단순 upsert (관리자 미매칭 큐 적재가 우선)
        const { error: e2 } = await supabaseAdmin
          .from('unmatched_activities')
          .upsert({
            activity: item.activity,
            package_id: item.package_id || null,
            package_title: item.package_title || null,
            day_number: item.day_number || null,
            country: item.country || null,
            region: item.region || null,
            occurrence_count: 1,
            status: 'pending',
          }, { onConflict: 'activity' });
        return !e2;
      }
      return true;
    };

    for (let i = 0; i < valid.length; i += CONCURRENCY) {
      const chunk = valid.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(chunk.map(upsertOne));
      saved += results.filter(r => r.status === 'fulfilled' && r.value === true).length;
    }

    return NextResponse.json({ success: true, saved });
  } catch (error) {
    console.error('[Unmatched API] 저장 오류:', error);
    return NextResponse.json({ success: false });
  }
}

/**
 * GET /api/unmatched — 미매칭 목록 조회 (관리자용)
 * ?status=pending (기본)
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ items: [] });

  try {
    const { searchParams } = new URL(request.url);

    if (searchParams.get('summary') === '1') {
      const summary = await getUnmatchedSummary();
      return NextResponse.json(summary);
    }

    if (searchParams.get('bootstrap') === '1') {
      const bootDef = getUnmatchedBootstrapEnvDefaults();
      const minOccurrences = Math.max(
        1,
        parseInt(searchParams.get('min_occurrences') || String(bootDef.minOccurrences), 10),
      );
      const scoreMin = parseFloat(searchParams.get('score_min') || String(bootDef.scoreMin));
      const scoreMax = parseFloat(searchParams.get('score_max') || String(bootDef.scoreMax));
      const maxRows = Math.min(80, Math.max(5, parseInt(searchParams.get('limit') || '40', 10)));
      const candidates = await getUnmatchedBootstrapCandidates({
        minOccurrences,
        scoreMin,
        scoreMax,
        maxRows,
      });
      return NextResponse.json({
        min_occurrences: minOccurrences,
        score_min: scoreMin,
        score_max: scoreMax,
        candidates,
      });
    }

    const status = searchParams.get('status') || 'pending';

    // ⚠️ ERR-unmatched-limit-200@2026-04-21:
    //    기존 하드코딩 .limit(200) → UI "미매칭 200건" 고정 표시, 실제 pending=203+ 일 때 침묵 누락.
    //    해결: 1000 건 단위 페이지네이션 루프 (attractions 와 동일 패턴).
    const buildQuery = () => {
      let q = supabaseAdmin
        .from('unmatched_activities')
        .select('*')
        .order('occurrence_count', { ascending: false })
        .order('created_at', { ascending: false });
      if (status !== 'all') q = q.eq('status', status);
      return q;
    };

    const allItems: unknown[] = [];
    const PAGE = 1000;
    for (let from = 0; from < 100000; from += PAGE) {
      const { data, error } = await buildQuery().range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allItems.push(...data);
      if (data.length < PAGE) break;
    }

    return NextResponse.json({ items: allItems });
  } catch (error) {
    console.error('[Unmatched API] 조회 오류:', error);
    return NextResponse.json({ items: [] });
  }
}

/**
 * PATCH /api/unmatched — 상태 변경 또는 별칭 연결
 * body: { id, status } — 단순 상태 변경
 * body: { id, action: 'link_alias', attractionId: 'uuid' } — 기존 관광지에 alias 연결
 */
export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const body = await request.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

    // 별칭 연결 모드
    if (body.action === 'link_alias') {
      const { attractionId } = body;
      if (!attractionId) return NextResponse.json({ error: 'attractionId 필요' }, { status: 400 });

      // 1. 미매칭 항목 조회
      const { data: unmatched } = await supabaseAdmin
        .from('unmatched_activities')
        .select('activity')
        .eq('id', id)
        .single();
      if (!unmatched) return NextResponse.json({ error: '미매칭 항목을 찾을 수 없습니다.' }, { status: 404 });

      const aliasText = unmatched.activity;

      // 2. 중복 체크 — 같은 alias가 다른 관광지에 이미 있는지
      const { data: dupeCheck } = await supabaseAdmin
        .from('attractions')
        .select('id, name, aliases')
        .neq('id', attractionId) as any;
      const dupeAttraction = (dupeCheck || []).find((a: any) =>
        (a.aliases || []).some((alias: string) => alias === aliasText)
      );
      if (dupeAttraction) {
        return NextResponse.json(
          { error: `"${aliasText}"는 이미 "${dupeAttraction.name}"에 별칭으로 등록되어 있습니다.` },
          { status: 409 }
        );
      }

      // 3. 대상 관광지 조회 & aliases 업데이트
      const { data: attraction } = await supabaseAdmin
        .from('attractions')
        .select('id, name, aliases')
        .eq('id', attractionId)
        .single() as any;
      if (!attraction) return NextResponse.json({ error: '관광지를 찾을 수 없습니다.' }, { status: 404 });

      const currentAliases: string[] = attraction.aliases || [];
      if (!currentAliases.includes(aliasText)) {
        const newAliases = [...currentAliases, aliasText];
        const { error: updateErr } = await supabaseAdmin
          .from('attractions')
          .update({ aliases: newAliases })
          .eq('id', attractionId);
        if (updateErr) throw updateErr;
      }

      // 4. 미매칭 상태 → added + resolved_* (크론 자동해결과 동일 스키마로 추적)
      const now = new Date().toISOString();
      const { error: umErr } = await supabaseAdmin
        .from('unmatched_activities')
        .update({
          status: 'added',
          resolved_at: now,
          resolved_kind: 'manual_link_alias',
          resolved_attraction_id: attractionId,
          resolved_by: 'admin_api',
        })
        .eq('id', id);
      if (umErr) throw umErr;

      // 동일 별칭을 쓰는 다른 pending 행 즉시 정리 (attractions PATCH와 동일 패턴)
      try {
        await resweepUnmatchedActivities([attractionId]);
      } catch (sweepErr) {
        console.warn('[PATCH /api/unmatched link_alias] resweep skip:', sweepErr);
      }

      // PR #93 갭 B/C — link_alias 후 영향받은 패키지 itinerary_data 재계산 + ISR 무효화
      void reEnrichAffectedPackages([attractionId], { maxPackages: 50 })
        .catch(e => console.warn('[link_alias] re-enrich 실패:', e instanceof Error ? e.message : e));

      return NextResponse.json({
        success: true,
        message: `"${aliasText}" → "${attraction.name}" 별칭 연결 완료`,
      });
    }

    // PR #87 Phase 1 — Wikidata QID 기반 신규 attraction 등록 (1-click).
    //   사장님이 어드민에서 Wikidata 후보 카드 보고 ☑ 클릭 시 호출.
    //   STRICT SSOT 정책 준수: 자동 INSERT 아님, 사장님 명시 승인 후 INSERT.
    //   body: { id, action: 'register_from_wikidata', wikidata: { qid, labels, aliases, image_thumb_url, description },
    //          country?, region?, badge_type? }
    // PR #94 갭 D — suggested_card 일괄 등록 (사장님 1-click).
    //   백그라운드 부트스트랩이 만든 AI 카드를 attractions 에 일괄 INSERT + 미매칭 처리.
    //   STRICT SSOT 준수: 사장님 명시 ☑ 후에만 INSERT.
    if (body.action === 'register_from_suggested_card') {
      const { data: unmatched } = await supabaseAdmin
        .from('unmatched_activities')
        .select('id, activity, region, country, suggested_card')
        .eq('id', id)
        .single() as { data: { id: string; activity: string; region: string | null; country: string | null; suggested_card: Record<string, unknown> | null } | null };
      if (!unmatched) return NextResponse.json({ error: '미매칭 항목 없음' }, { status: 404 });
      const card = unmatched.suggested_card;
      if (!card || typeof card !== 'object') return NextResponse.json({ error: 'suggested_card 부재 — 부트스트랩 안됨' }, { status: 400 });

      const name = String(card.name ?? '').trim();
      if (!name || name.length < 2) return NextResponse.json({ error: 'card.name invalid' }, { status: 400 });

      // 동일 name 시 alias 추가만
      const { data: existing } = await supabaseAdmin
        .from('attractions')
        .select('id, name, aliases')
        .ilike('name', name)
        .limit(1);
      if (existing && existing.length > 0) {
        const ex = existing[0] as { id: string; name: string; aliases: string[] | null };
        const aliases = ex.aliases ?? [];
        if (!aliases.includes(unmatched.activity)) {
          await supabaseAdmin.from('attractions').update({ aliases: [...aliases, unmatched.activity] }).eq('id', ex.id);
        }
        await supabaseAdmin.from('unmatched_activities').update({
          status: 'added',
          resolved_at: new Date().toISOString(),
          resolved_kind: 'manual_register_suggested_existing',
          resolved_attraction_id: ex.id,
          resolved_by: 'admin_suggested',
        }).eq('id', id);
        return NextResponse.json({ success: true, message: `이미 존재: "${ex.name}" → alias 추가`, attraction_id: ex.id });
      }

      // 2026-05-17 박제 (ERR-shizuoka-country-destination):
      //   unmatched_activities.country 에 한글 destination(예 '시즈오카')이 잘못 박혀 있던
      //   레거시 row 가 다수 존재. 그대로 INSERT 하면 attractions.country='시즈오카' 박혀
      //   page.tsx OR clause(country.eq.JP) 매칭 실패 → 모바일 카드 미표출 사고.
      //   INSERT 시점에 ISO2 정규화. region 은 한글 destination 보존.
      const { inferCountryFromDestination } = await import('@/lib/destination-iso');
      const rawCountry = unmatched.country as string | null;
      const rawRegion = unmatched.region as string | null;
      const isISO2 = (s: string | null) => !!s && /^[A-Z]{2}$/.test(s);
      const normCountry = isISO2(rawCountry) ? rawCountry : (inferCountryFromDestination(rawCountry) ?? inferCountryFromDestination(rawRegion));
      const normRegion = rawRegion ?? (isISO2(rawCountry) ? null : rawCountry);

      // 신규 INSERT
      const { data: created, error: insErr } = await supabaseAdmin.from('attractions').insert({
        name,
        short_desc: card.short_desc ?? null,
        long_desc: card.long_desc ?? null,
        aliases: Array.isArray(card.aliases) ? card.aliases : [],
        country: normCountry,
        region: normRegion,
        badge_type: card.badge_type ?? 'tour',
        emoji: card.emoji ?? '📍',
        category: 'sightseeing',
        source: 'paste-auto-bootstrap',
        confidence_score: 0.7,
        seeded_at: new Date().toISOString(),
        is_active: true,
        is_manual_override: true,  // 사장님 명시 ☑ = manual
        last_owner_edited_at: new Date().toISOString(),
      }).select('id, name').single() as { data: { id: string; name: string } | null; error: { message: string } | null };
      if (insErr || !created) return NextResponse.json({ error: insErr?.message ?? 'INSERT 실패' }, { status: 500 });

      await supabaseAdmin.from('unmatched_activities').update({
        status: 'added',
        resolved_at: new Date().toISOString(),
        resolved_kind: 'manual_register_suggested_card',
        resolved_attraction_id: created.id,
        resolved_by: 'admin_suggested',
      }).eq('id', id);

      // resweep + re-enrich (PR #93)
      try {
        await resweepUnmatchedActivities([created.id]);
        const { reEnrichAffectedPackages } = await import('@/lib/package-reenrich-on-attraction-change');
        void reEnrichAffectedPackages([created.id], { maxPackages: 50 }).catch(() => {});
      } catch {}

      // 2026-05-17 박제 (ERR-shizuoka-photos-empty 갭 G2):
      //   부트스트랩으로 INSERT 된 attraction 은 photos=[] 빈 상태로 박혀 모바일 카드가
      //   매칭은 되지만 사진이 0건이라 결국 카드 미표출 (시즈오카 8개 사고). INSERT 직후
      //   Pexels 자동 fetch + UPDATE 로 photos 3장 보강. fire-and-forget.
      void (async () => {
        try {
          const { searchPexelsPhotos, isPexelsConfigured } = await import('@/lib/pexels');
          if (!isPexelsConfigured()) return;
          // 한글 검색은 false-match 위험. 영어 alias 우선, 없으면 name + region + 'travel'.
          const eng = Array.isArray(card.aliases) ? (card.aliases as unknown[]).find(a => typeof a === 'string' && /^[\x20-\x7E]+$/.test(a)) as string | undefined : undefined;
          const keyword = eng || `${name} ${normRegion ?? ''} travel`.trim();
          const photos = await searchPexelsPhotos(keyword, 3);
          if (photos.length === 0) return;
          const simplified = photos.map(p => ({
            pexels_id: p.id,
            src_medium: p.src.medium,
            src_large: p.src.large2x,
            photographer: p.photographer,
            alt: p.alt,
          }));
          await supabaseAdmin.from('attractions').update({ photos: simplified, updated_at: new Date().toISOString() }).eq('id', created.id);
          console.log(`[unmatched register_from_suggested_card] Pexels auto-attached ${photos.length} photos to "${name}"`);
        } catch (e) {
          console.warn('[unmatched register_from_suggested_card] Pexels auto-attach 실패(무시):', e instanceof Error ? e.message : e);
        }
      })();

      return NextResponse.json({ success: true, message: `신규 등록: "${created.name}"`, attraction_id: created.id });
    }

    if (body.action === 'register_from_wikidata') {
      const wd = body.wikidata as {
        qid: string;
        description: string | null;
        labels: { ko: string | null; en: string | null; zh: string | null; ja: string | null };
        aliases: { ko: string[]; en: string[]; zh: string[]; ja: string[] };
        image_thumb_url: string | null;
        image_filename: string | null;
      } | undefined;
      if (!wd?.qid) return NextResponse.json({ error: 'wikidata.qid 필요' }, { status: 400 });

      // 1. 미매칭 + 캐노니컬 결정
      const { data: unmatched } = await supabaseAdmin
        .from('unmatched_activities')
        .select('activity, region, country')
        .eq('id', id)
        .single();
      if (!unmatched) return NextResponse.json({ error: '미매칭 항목을 찾을 수 없습니다.' }, { status: 404 });

      const canonical = wd.labels.ko ?? wd.labels.en ?? unmatched.activity;
      const aliases = [
        wd.labels.ko, wd.labels.en, wd.labels.zh, wd.labels.ja,
        ...wd.aliases.ko, ...wd.aliases.en, ...wd.aliases.zh, ...wd.aliases.ja,
        unmatched.activity,
      ].filter((v): v is string => !!v && v !== canonical);
      const dedupedAliases = [...new Set(aliases)];

      // 2. 동일 QID 또는 동일 name 이미 있는지 체크
      const { data: existing } = await supabaseAdmin
        .from('attractions')
        .select('id, name')
        .or(`wikidata_qid.eq.${wd.qid},name.eq.${canonical}`)
        .limit(1);
      if (existing && existing.length > 0) {
        // 이미 존재 → unmatched 만 link_alias 처리
        const attractionId = (existing[0] as { id: string }).id;
        const { error: linkErr } = await supabaseAdmin
          .from('unmatched_activities')
          .update({
            status: 'added',
            resolved_at: new Date().toISOString(),
            resolved_kind: 'manual_register_existing',
            resolved_attraction_id: attractionId,
            resolved_by: 'admin_wikidata',
          })
          .eq('id', id);
        if (linkErr) throw linkErr;
        return NextResponse.json({
          success: true,
          message: `이미 등록된 관광지 "${(existing[0] as { name: string }).name}" 에 미매칭 연결 완료`,
          attraction_id: attractionId,
        });
      }

      // 3. attractions INSERT
      const photos = wd.image_thumb_url ? [{
        src_medium: wd.image_thumb_url,
        src_large: wd.image_thumb_url,
        photographer: 'Wikimedia Commons',
        pexels_id: 0,
        license: 'wikimedia-commons',
        source_url: wd.image_filename ? `https://commons.wikimedia.org/wiki/File:${wd.image_filename}` : null,
      }] : null;
      const { data: created, error: insErr } = await supabaseAdmin
        .from('attractions')
        .insert({
          name: canonical,
          short_desc: wd.description ?? null,
          aliases: dedupedAliases,
          country: unmatched.country ?? null,
          region: unmatched.region ?? null,
          badge_type: body.badge_type ?? 'tour',
          emoji: '📍',
          category: 'sightseeing',
          wikidata_qid: wd.qid,
          source: 'wikidata',
          external_url: `https://www.wikidata.org/wiki/${wd.qid}`,
          confidence_score: 0.85,
          seeded_at: new Date().toISOString(),
          is_active: true,
          photos,
        })
        .select('id, name')
        .single() as { data: { id: string; name: string } | null; error: { message: string } | null };
      if (insErr || !created) return NextResponse.json({ error: insErr?.message ?? 'INSERT 실패' }, { status: 500 });

      // 4. 미매칭 처리
      const { error: umErr } = await supabaseAdmin
        .from('unmatched_activities')
        .update({
          status: 'added',
          resolved_at: new Date().toISOString(),
          resolved_kind: 'manual_register_wikidata',
          resolved_attraction_id: created.id,
          resolved_by: 'admin_wikidata',
        })
        .eq('id', id);
      if (umErr) throw umErr;

      try {
        await resweepUnmatchedActivities([created.id]);
      } catch (sweepErr) {
        console.warn('[PATCH /api/unmatched register_from_wikidata] resweep skip:', sweepErr);
      }

      // PR #93 갭 A/B/C — Wikidata 신규 등록 후 영향받은 패키지 itinerary_data 재계산 + ISR
      void reEnrichAffectedPackages([created.id], { maxPackages: 50 })
        .catch(e => console.warn('[register_from_wikidata] re-enrich 실패:', e instanceof Error ? e.message : e));

      return NextResponse.json({
        success: true,
        message: `Wikidata ${wd.qid} → "${created.name}" 신규 등록 완료 (다국어 alias ${dedupedAliases.length}개)`,
        attraction_id: created.id,
      });
    }

    // P11-3: 1-click reconcile (Wikidata 자동 검색 -> auto INSERT)
    //   upload route.ts 의 P11-3 로직과 동일,
    //   어드민 UI에서 "🪄 1-click reconcile" 버튼으로 호출
    if (body.action === 'reconcile_auto_insert') {
      const { data: unmatched } = await supabaseAdmin
        .from('unmatched_activities')
        .select('id, activity, region, country')
        .eq('id', id)
        .single();
      if (!unmatched) return NextResponse.json({ error: '항목 없음' }, { status: 404 });

      const { reconcilePlaceName } = await import('@/lib/wikidata-reconcile');
      const { inferCategory } = await import('@/lib/parser/attraction-category');

      const reconciled = await reconcilePlaceName(unmatched.activity, {
        country: (unmatched.country as string | undefined),
        typeId: 'Q570',
        topRes: 3,
      });

      if (reconciled.length === 0) {
        return NextResponse.json({ error: 'Wikidata 에서 일치하는 POI를 찾을 수 없습니다. 수동 등록 또는 별칭 연결을 이용하세요.' }, { status: 404 });
      }

      const top = reconciled[0];

      // qid 중복 체크
      const { data: existing } = await supabaseAdmin
        .from('attractions')
        .select('id, aliases')
        .eq('qid', top.qid)
        .maybeSingle();

      const now = new Date().toISOString();

      if (existing) {
        // 기존 attraction 에 alias 만 추가
        const existingAliases: string[] = (existing as any).aliases ?? [];
        if (!existingAliases.includes(unmatched.activity)) {
          await supabaseAdmin
            .from('attractions')
            .update({ aliases: [...new Set([...existingAliases, unmatched.activity])], updated_at: now })
            .eq('id', (existing as any).id);
        }
        await supabaseAdmin
          .from('unmatched_activities')
          .update({ status: 'added', note: `auto-matched: ${top.qid} (conf=${top.confidence.toFixed(2)})`, resolved_at: now, resolved_kind: 'manual_reconcile', resolved_attraction_id: (existing as any).id, resolved_by: 'admin_api' })
          .eq('id', id);

        // resweep + re-enrich
        try {
          await resweepUnmatchedActivities([(existing as any).id]);
          void reEnrichAffectedPackages([(existing as any).id], { maxPackages: 50 }).catch(() => {});
        } catch {}

        return NextResponse.json({ success: true, message: `기존 "${top.label_ko || top.label_en || top.qid}" 에 alias 연결 완료` });
      }

      // 신규 INSERT
      const aliasSet = new Set<string>([unmatched.activity, top.label_ko || '', top.label_en || ''].filter(Boolean));
      for (const a of top.aliases) {
        if (a !== top.label_ko && a !== top.label_en) aliasSet.add(a);
      }

      const category = inferCategory(unmatched.activity, top.type_qid || undefined);
      const photos = top.image_url
        ? [{ src_medium: top.image_url, src_large: top.image_url, photographer: 'Wikimedia Commons', source: 'wikimedia' }]
        : [];

      const { data: created, error: insErr } = await supabaseAdmin
        .from('attractions')
        .insert({
          name: top.label_ko || top.label_en || unmatched.activity,
          qid: top.qid,
          aliases: [...aliasSet].filter(Boolean),
          short_desc: top.description?.slice(0, 30) || null,
          country: unmatched.country,
          region: unmatched.region,
          category,
          photos,
          mention_count: 1,
          is_active: true,
        })
        .select('id, name')
        .single();
      if (insErr || !created) return NextResponse.json({ error: insErr?.message || 'INSERT 실패' }, { status: 500 });

      await supabaseAdmin
        .from('unmatched_activities')
        .update({ status: 'added', note: `auto-inserted: ${top.qid} (conf=${top.confidence.toFixed(2)})`, resolved_at: now, resolved_kind: 'manual_reconcile', resolved_attraction_id: (created as any).id, resolved_by: 'admin_api' })
        .eq('id', id);

      // fire-and-forget: photo + description 백그라운드
      void (async () => {
        try {
          const { generateAttractionDescription } = await import('@/lib/attraction-desc-gen');
          const desc = await generateAttractionDescription(top.label_ko || top.label_en || unmatched.activity, {
            qid: top.qid, wdDescription: top.description, destination: unmatched.region,
          });
          await supabaseAdmin.from('attractions').update({ short_desc: desc.short_desc, updated_at: now }).eq('id', (created as any).id);

          const { runAttractionPhotoMatch } = await import('@/lib/attraction-photo-match');
          await runAttractionPhotoMatch((created as any).id, {
            keywords: [top.label_ko || '', top.label_en || '', unmatched.activity, ...top.aliases].filter(Boolean),
            qid: top.qid, maxPhotos: 5,
          });
        } catch {}
      })();

      // resweep + re-enrich
      try {
        await resweepUnmatchedActivities([(created as any).id]);
        void reEnrichAffectedPackages([(created as any).id], { maxPackages: 50 }).catch(() => {});
      } catch {}

      return NextResponse.json({ success: true, message: `신규 등록: "${(created as any).name}" (${top.qid})`, attraction_id: (created as any).id });
    }

    // 단순 상태 변경 모드
    const { status } = body;
    if (!status) return NextResponse.json({ error: 'status 필요' }, { status: 400 });

    const { error } = await supabaseAdmin
      .from('unmatched_activities')
      .update({ status })
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Unmatched API] 처리 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '처리 실패' }, { status: 500 });
  }
}
