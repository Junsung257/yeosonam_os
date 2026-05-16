import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';
import { resweepUnmatchedActivities } from '@/lib/unmatched-resweep';

// GET /api/attractions — 전체 관광지 목록
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ attractions: [] });

  try {
    const { searchParams } = new URL(request.url);
    const country = searchParams.get('country');
    const region = searchParams.get('region');
    const badge_type = searchParams.get('badge_type');
    const search = searchParams.get('search'); // 이름 검색 (별칭 연결용)
    const limit = searchParams.get('limit');
    const idsParam = searchParams.get('ids'); // comma-separated UUID list

    // photos_only=1: 홈페이지용 경량 쿼리 (사진 매칭에 필요한 최소 필드만)
    const photosOnly = searchParams.get('photos_only');
    const fields = photosOnly
      ? 'id, name, country, region, photos, mention_count, mrt_gid'
      : 'id, name, short_desc, long_desc, category, badge_type, emoji, country, region, aliases, photos, mention_count, mrt_gid, mrt_rating, mrt_review_count, created_at';

    // ids 지정 조회: itinerary_data attraction_ids 기반 경량 조회
    if (idsParam) {
      const ids = idsParam
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (ids.length === 0) return NextResponse.json({ attractions: [] });
      const { data, error } = await supabaseAdmin
        .from('attractions')
        .select(fields)
        .in('id', ids)
        .eq('is_active', true);
      if (error) throw error;
      return NextResponse.json({ attractions: data || [] }, {
        headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' },
      });
    }

    // ⚠️ ERR-attractions-limit-1000@2026-04-21:
    //    Supabase PostgREST 기본 max-rows=1000 때문에 .limit(5000) 을 호출해도 서버에서 1000 에서 잘림.
    //    실제 1097건이 등록돼 있음에도 UI 상단에 "총 1000개"로 잘못 표시되는 버그.
    //    해결: 명시 limit 파라미터가 없으면 1000건 단위 페이지네이션 루프로 전체 조회.
    // include_inactive=1 → 어드민 휴지통 보기. 기본은 활성만.
    const includeInactive = searchParams.get('include_inactive') === '1';

    const baseQuery = () => {
      let q = supabaseAdmin.from('attractions').select(fields).order('mention_count', { ascending: false });
      if (!includeInactive) q = q.eq('is_active', true);
      if (search) q = q.ilike('name', `%${search}%`);
      if (country) q = q.eq('country', country);
      if (region) q = q.eq('region', region);
      if (badge_type) q = q.eq('badge_type', badge_type);
      return q;
    };

    let allData: unknown[] = [];
    if (limit) {
      // 명시 limit → 단일 쿼리 (기존 경량 호출 경로 호환)
      const { data, error } = await baseQuery().limit(parseInt(limit));
      if (error) throw error;
      allData = data || [];
    } else {
      // 페이지네이션 루프 — 1000건 단위로 전체 조회
      const PAGE = 1000;
      for (let from = 0; from < 100000; from += PAGE) {
        const { data, error } = await baseQuery().range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData.push(...data);
        if (data.length < PAGE) break; // 마지막 페이지
      }
    }

    return NextResponse.json({ attractions: allData }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    });
  } catch (error) {
    console.error('[Attractions API] 조회 오류:', error);
    return NextResponse.json({ attractions: [] });
  }
}

// POST /api/attractions — 신규 등록
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const body = await request.json();

    // PR #92 — 사장님 paste-and-parse 또는 직접 등록은 manual override.
    //   wikidata-suggest 자동 등록(/api/unmatched register_from_wikidata)은 source='wikidata' + is_manual_override=false.
    //   sourceLevel: 'manual' (사장님 직접) | 'paste' (paste-and-parse 사장님 ☑) → 둘 다 manual_override=true
    //   'auto' (Wikidata 자동) → false
    const sourceLevel = (body.source_level ?? 'manual') as 'manual' | 'paste' | 'auto';
    const isManual = sourceLevel === 'manual' || sourceLevel === 'paste';

    // 동일 name 중복 체크 — 사장님 paste-and-parse 시 중복 방지 (3-옵션 모달 트리거)
    const cleanName = sanitizeName(body.name) || body.name;
    if (cleanName) {
      const { data: existing } = await supabaseAdmin
        .from('attractions')
        .select('id, name, short_desc, source, is_manual_override')
        .ilike('name', cleanName)
        .limit(1);
      if (existing && existing.length > 0) {
        return NextResponse.json({
          error: 'duplicate',
          message: `이미 등록된 attraction: "${(existing[0] as { name: string }).name}"`,
          existing: existing[0],
          options: ['skip', 'add_alias', 'overwrite'],
        }, { status: 409 });
      }
    }

    const { data, error } = await supabaseAdmin
      .from('attractions')
      .insert({
        name: cleanName,
        short_desc: body.short_desc || null,
        long_desc: body.long_desc || null,
        country: body.country || null,
        region: body.region || null,
        badge_type: normalizeBadgeType(body.badge_type),
        emoji: sanitizeEmoji(body.emoji),
        aliases: body.aliases || [],
        photos: body.photos || [],
        is_manual_override: isManual,
        last_owner_edited_at: isManual ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error) throw error;

    // 🆕 ERR-unmatched-stale-after-alias@2026-04-29 — 신규 attraction 추가 후 unmatched 자동 정리
    let sweep = null;
    try {
      sweep = await resweepUnmatchedActivities([data.id]);
    } catch (e) {
      console.warn('[Attractions API] resweep 실패 (등록은 성공):', e instanceof Error ? e.message : e);
    }

    // 🆕 Pexels 자동 사진 fetch — photos 없이 등록된 경우 비동기로 채움 (등록을 블로킹하지 않음)
    if (!body.photos?.length && getSecret('PEXELS_API_KEY')) {
      void (async () => {
        try {
          const { searchPexelsPhotos, destToEnKeyword } = await import('@/lib/pexels');
          const keyword = destToEnKeyword(data.destination || data.region || data.name);
          const photos = await searchPexelsPhotos(`${keyword} travel`, 5);
          if (photos.length > 0) {
            const photoData = photos.map(p => ({
              pexels_id: p.id,
              src_large2x: p.src.large2x,
              src_large: p.src.large,
              src_medium: p.src.medium,
              photographer: p.photographer,
              alt: p.alt,
            }));
            await supabaseAdmin.from('attractions').update({ photos: photoData }).eq('id', data.id);
          }
        } catch (e) {
          console.warn('[Attractions API] Pexels 자동 사진 실패 (등록은 성공):', e instanceof Error ? e.message : e);
        }
      })();
    }

    return NextResponse.json({ attraction: data, sweep }, { status: 201 });
  } catch (error) {
    console.error('[Attractions API] 등록 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '등록 실패' }, { status: 500 });
  }
}

// PATCH /api/attractions — 수정
export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const body = await request.json();
    const { id, action, ...updates } = body;
    if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

    // PR #88 Phase 2a — Wikipedia summary 자동 채움 (사장님 1-click).
    //   action='fill_from_wikipedia' 시 short_desc/long_desc 자동 fetch + UPDATE.
    //   STRICT SSOT 정책 준수: 자동 INSERT 아님, 기존 attraction 업데이트만, 사장님 명시 트리거.
    //   라이선스: Wikipedia 본문 CC-BY-SA → external_url 저장, source='wikipedia'.
    // PR #93 — DeepSeek 으로 desc 자동 채움 (Wikipedia 보다 ROI 높음).
    //   사장님 톤 prompt + Wikipedia 그라운딩 fallback (있을 때만). is_manual_override=true 면 차단.
    if (action === 'fill_from_llm') {
      const { data: attr } = await supabaseAdmin
        .from('attractions')
        .select('id, name, aliases, region, country, badge_type, short_desc, long_desc, is_manual_override')
        .eq('id', id)
        .single() as { data: { id: string; name: string; aliases: string[] | null; region: string | null; country: string | null; badge_type: string | null; short_desc: string | null; long_desc: string | null; is_manual_override: boolean | null } | null };
      if (!attr) return NextResponse.json({ error: 'attraction 없음' }, { status: 404 });
      if (attr.is_manual_override) {
        return NextResponse.json({ error: '사장님 직접 입력 attraction 은 자동 채움 차단됨', locked: true }, { status: 423 });
      }

      const { llmCall } = await import('@/lib/llm-gateway');
      const { fetchWikipediaWithFallback } = await import('@/lib/wikipedia-summary');

      // 그라운딩: Wikipedia 한국어/영어 hit 시 fact 추출
      const koAlias = (attr.aliases ?? []).find(a => /[가-힣]/.test(a));
      const searchKey = koAlias && /[가-힣]/.test(attr.name) ? attr.name : (koAlias ?? attr.name);
      const wiki = await fetchWikipediaWithFallback(searchKey).catch(() => null);
      const groundFact = wiki?.extract ?? '';

      const SYS = `당신은 여소남 OS 의 한국 패키지 여행 attraction 카피 작성자입니다.
사장님 톤: 친근, 구체, 소통. 슬래시 나열 금지. 마케팅 과장 금지.
형식: { "short_desc": "1줄 hook 15-40자", "long_desc": "2-3문장 100-200자, 친근 한국어, 사실만" }
환각 금지: 외부 그라운딩 fact 가 있으면 그것만 활용. 없으면 일반적/보수적 안내.`;
      const userPrompt = `attraction: "${attr.name}" (지역: ${attr.region ?? ''} / 국가: ${attr.country ?? ''} / 카테고리: ${attr.badge_type ?? 'tour'})
${groundFact ? `Wikipedia 그라운딩 fact:\n${groundFact.slice(0, 500)}\n` : '(외부 그라운딩 없음 — 보수적 안내)'}
JSON 객체만 응답:`;

      const result = await llmCall<{ short_desc?: string; long_desc?: string }>({
        task: 'extract-meta',
        systemPrompt: SYS,
        userPrompt,
        maxTokens: 600,
      });
      if (!result.success) {
        return NextResponse.json({ error: `LLM 호출 실패: ${result.errors?.join(', ') ?? 'unknown'}` }, { status: 502 });
      }

      let parsed: { short_desc?: string; long_desc?: string } = {};
      try {
        const raw = result.data ?? result.rawText ?? '';
        if (typeof raw === 'object' && raw !== null) parsed = raw as typeof parsed;
        else if (typeof raw === 'string') {
          const trimmed = raw.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
          parsed = JSON.parse(trimmed);
        }
      } catch (e) {
        return NextResponse.json({ error: 'LLM JSON 파싱 실패', raw_preview: String(result.rawText ?? '').slice(0, 300) }, { status: 502 });
      }

      // no-overwrite: 사장님이 채운 값 절대 보존
      const newShort = !attr.short_desc?.trim() && parsed.short_desc ? parsed.short_desc.trim() : attr.short_desc;
      const newLong = !attr.long_desc?.trim() && parsed.long_desc ? parsed.long_desc.trim() : attr.long_desc;

      const { error: upErr } = await supabaseAdmin
        .from('attractions')
        .update({
          short_desc: newShort,
          long_desc: newLong,
          source: groundFact ? 'wikipedia+llm' : 'llm',
          external_url: wiki?.page_url ?? null,
          confidence_score: groundFact ? 0.75 : 0.55,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (upErr) throw upErr;

      return NextResponse.json({
        success: true,
        message: `DeepSeek 채움 완료${groundFact ? ' (Wikipedia 그라운딩)' : ''}`,
        result: { short_desc: newShort, long_desc: newLong, grounded: !!groundFact },
        llm_meta: { provider: result.provider, model: result.model, elapsed_ms: result.elapsed_ms },
      });
    }

    if (action === 'fill_from_wikipedia') {
      const { fetchWikipediaWithFallback } = await import('@/lib/wikipedia-summary');
      const { data: attr } = await supabaseAdmin
        .from('attractions')
        .select('id, name, aliases, wikidata_qid, short_desc, long_desc, is_manual_override')
        .eq('id', id)
        .single() as { data: { id: string; name: string; aliases: string[] | null; wikidata_qid: string | null; short_desc: string | null; long_desc: string | null; is_manual_override: boolean | null } | null };
      if (!attr) return NextResponse.json({ error: 'attraction 없음' }, { status: 404 });

      // PR #92 — 사장님 입력 우선 잠금
      if (attr.is_manual_override) {
        return NextResponse.json({
          error: '사장님이 직접 입력한 attraction 은 자동 채움 차단됨 (is_manual_override=true)',
          locked: true,
        }, { status: 423 });
      }

      // 한국어 alias 우선 시도, 없으면 name
      const koAlias = (attr.aliases ?? []).find(a => /[가-힣]/.test(a));
      const searchKey = koAlias && /[가-힣]/.test(attr.name) ? attr.name : (koAlias ?? attr.name);
      const summary = await fetchWikipediaWithFallback(searchKey);
      if (!summary) {
        return NextResponse.json({ error: 'Wikipedia summary 부재 (ko/en/zh/ja 모두 미확인)' }, { status: 404 });
      }

      // short_desc 비어 있으면 extract_short, long_desc 비어 있으면 extract
      // 사장님이 기존 채움값 보존: 비어 있을 때만 채움 (no-overwrite)
      const newShort = !attr.short_desc?.trim() ? summary.extract_short : attr.short_desc;
      const newLong = !attr.long_desc?.trim() ? summary.extract : attr.long_desc;

      const { error: upErr } = await supabaseAdmin
        .from('attractions')
        .update({
          short_desc: newShort,
          long_desc: newLong,
          external_url: summary.page_url,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (upErr) throw upErr;

      return NextResponse.json({
        success: true,
        message: `Wikipedia ${summary.lang} "${summary.title}" 으로 채움 완료 (${summary.extract.length}자)`,
        summary: {
          lang: summary.lang,
          title: summary.title,
          extract_short: summary.extract_short,
          page_url: summary.page_url,
          thumbnail_url: summary.thumbnail_url,
        },
      });
    }

    // PR #92 — 사장님 입력 우선 잠금 자동 트리거.
    //   고객 노출 필드 (short_desc/long_desc/name/aliases/photos/badge_type/emoji) 가
    //   API PATCH 로 수정되면 사장님 직접 편집으로 간주 → is_manual_override=true + last_owner_edited_at.
    //   이후 fill_from_wikipedia 같은 자동 채움이 차단됨.
    const OWNER_EDIT_FIELDS = ['short_desc', 'long_desc', 'name', 'aliases', 'photos', 'badge_type', 'emoji'];
    const isOwnerEdit = OWNER_EDIT_FIELDS.some(f => f in updates);
    const finalUpdates: Record<string, unknown> = { ...updates };
    if (isOwnerEdit) {
      finalUpdates.is_manual_override = true;
      finalUpdates.last_owner_edited_at = new Date().toISOString();
    }

    const { error } = await supabaseAdmin
      .from('attractions')
      .update(finalUpdates)
      .eq('id', id);

    if (error) throw error;

    // 🆕 ERR-unmatched-stale-after-alias@2026-04-29 — name/aliases 변경 시 unmatched 자동 재매칭
    // 다른 필드 (short_desc·photos 등) 변경에도 트리거 — 비용 미미 (단일 attraction 좁은 sweep)
    let sweep = null;
    if ('aliases' in updates || 'name' in updates) {
      try {
        sweep = await resweepUnmatchedActivities([id]);
      } catch (e) {
        console.warn('[Attractions API] resweep 실패 (수정은 성공):', e instanceof Error ? e.message : e);
      }
    }
    return NextResponse.json({ success: true, sweep });
  } catch (error) {
    console.error('[Attractions API] 수정 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '수정 실패' }, { status: 500 });
  }
}

// PUT /api/attractions — CSV 일괄 업로드 (upsert)
// ⚠️ ERR-attractions-csv-badge-check@2026-04-21:
//    "CSV 업로드 0건 반영" 사고 — attractions_badge_type_check 위반.
//    엑셀 편집 시 badge_type 컬럼이 빈 문자열 / 한글 label("관광") / 대소문자 변경("Tour") 으로
//    들어가면 CHECK 제약 위반으로 배치 전체 실패. 해결: 관대한 정규화 (한글→value 매핑 + fallback).
const BADGE_ALLOWED = new Set(['tour', 'special', 'shopping', 'meal', 'optional', 'hotel', 'restaurant', 'golf', 'activity', 'onsen']);
const BADGE_KO_MAP: Record<string, string> = {
  '관광': 'tour', '특전': 'special', '쇼핑': 'shopping', '특식': 'meal',
  '선택관광': 'optional', '선택': 'optional', '숙소': 'hotel', '호텔': 'hotel',
  '식당': 'restaurant', '골프': 'golf', '액티비티': 'activity', '온천': 'onsen',
};
function normalizeBadgeType(raw: unknown): string {
  if (typeof raw !== 'string') return 'tour';
  const s = raw.trim().toLowerCase();
  if (!s) return 'tour';
  if (BADGE_ALLOWED.has(s)) return s;
  const ko = BADGE_KO_MAP[raw.trim()];
  if (ko) return ko;
  return 'tour'; // 알 수 없는 값 → 안전 fallback
}

// ⚠️ ERR-attractions-name-label-prefix@2026-04-21:
//    엑셀에서 실수로 "관광 노산" / "선택관광 빈그랜드월드" 처럼 badge label 을 name 앞에 붙이는 경우,
//    pill 배지 label 과 혼동되어 UI 에서 "관광 노산" 한 덩어리로 읽힘. DB 오염 예방을 위해 업로드 시
//    선두 label prefix 를 자동 제거.
const NAME_PREFIX_RE = /^(선택관광|관광|특전|쇼핑|특식|숙소|호텔|식당|골프|액티비티|온천|선택)\s+(?=\S)/;
function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let s = raw.trim();
  // 앞뒤 ▶ / ☆ / - 같은 bullet 제거 (unmatched CSV 에 남아있을 수도)
  s = s.replace(/^[▶☆\-·•]\s*/, '').trim();
  // label prefix 1회 제거
  s = s.replace(NAME_PREFIX_RE, '').trim();
  return s;
}

// ⚠️ ERR-attractions-emoji-label-merged@2026-04-21:
//    CSV 업로드 시 emoji 컬럼에 "📍 관광" / "💎 선택관광" / "🛍️ 쇼핑" / "⛳ 골프" 같은 이모지+label
//    복합값이 저장돼 UI 가 `{emoji} {name}` 렌더링 시 "📍 관광 노산" 처럼 label 이 name 앞에 붙어 보임.
//    해결: emoji 값에서 첫 공백 앞까지만 유지 (이모지만 남기고 label 제거).
function sanitizeEmoji(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const idx = s.search(/\s/);
  if (idx === -1) return s;
  return s.slice(0, idx);
}

export async function PUT(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const { items } = await request.json();
    if (!Array.isArray(items)) return NextResponse.json({ error: 'items 배열 필요' }, { status: 400 });

    // 유효 행만 필터 + 정규화
    const sanitizedCount = { prefix: 0 };
    const normalized = items
      .filter((i: Record<string, unknown>) => typeof i.name === 'string' && (i.name as string).trim())
      .map((i: Record<string, unknown>) => {
        const originalName = (i.name as string).trim();
        const cleanedName = sanitizeName(originalName);
        if (cleanedName && cleanedName !== originalName) sanitizedCount.prefix++;
        return {
          name: cleanedName,
          short_desc: (i.short_desc as string)?.toString().trim() || null,
          long_desc: (i.long_desc as string)?.toString().trim() || null,
          country: (i.country as string)?.toString().trim() || null,
          region: (i.region as string)?.toString().trim() || null,
          badge_type: normalizeBadgeType(i.badge_type),
          emoji: sanitizeEmoji(i.emoji),
          ...(i.aliases ? { aliases: i.aliases } : {}),
          ...(i.photos ? { photos: i.photos } : {}),
        };
      })
      .filter((i) => i.name); // sanitize 후 빈 이름은 제외

    // 배치 내 name 중복 제거 (ON CONFLICT DO UPDATE 2회 동일 row 에러 방지)
    const byName = new Map<string, typeof normalized[number]>();
    for (const it of normalized) byName.set(it.name, it);
    const cleaned = [...byName.values()];

    // 500건씩 배치 upsert + 실패 시 단건 fallback (어느 row 가 문제인지 식별)
    let upserted = 0;
    const rowErrors: Array<{ name: string; error: string }> = [];
    const BATCH = 500;
    for (let i = 0; i < cleaned.length; i += BATCH) {
      const chunk = cleaned.slice(i, i + BATCH);
      const { error } = await supabaseAdmin
        .from('attractions')
        .upsert(chunk as never[], { onConflict: 'name' });
      if (!error) {
        upserted += chunk.length;
        continue;
      }
      // 배치 실패 → 단건 fallback 으로 성공 건 최대화 + 실패 건 식별
      console.error('[Attractions CSV] 배치 upsert 오류:', error.message);
      for (const row of chunk) {
        const { error: rowErr } = await supabaseAdmin
          .from('attractions')
          .upsert([row] as never[], { onConflict: 'name' });
        if (rowErr) rowErrors.push({ name: row.name, error: rowErr.message });
        else upserted++;
      }
    }

    return NextResponse.json({
      success: rowErrors.length === 0,
      upserted,
      total: cleaned.length,
      skippedDuplicates: normalized.length - cleaned.length,
      errors: rowErrors.slice(0, 20), // 상위 20건만 (알림창 길이 방어)
      totalErrors: rowErrors.length,
    });
  } catch (error) {
    console.error('[Attractions API] 일괄 업로드 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '업로드 실패' }, { status: 500 });
  }
}

// DELETE /api/attractions?id=        → 소프트 삭제 (is_active=false)
// DELETE /api/attractions?id=&hard=1  → 하드 삭제 (특수 상황만, audit 트레일 손실)
// PUT 별칭으로 ?id=&restore=1 로 복구도 가능 (PATCH 경로 활용)
export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const hard = searchParams.get('hard') === '1';
    if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

    if (hard) {
      // 하드 삭제 — FK / aliases 연결 끊김 위험. 어드민 명시 옵션 시에만 허용.
      const { error } = await supabaseAdmin
        .from('attractions')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, mode: 'hard' });
    }

    // 기본: 소프트 삭제 (CLAUDE.md §2-3)
    const { error } = await supabaseAdmin
      .from('attractions')
      .update({ is_active: false })
      .eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true, mode: 'soft' });
  } catch (error) {
    console.error('[Attractions API] 삭제 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '삭제 실패' }, { status: 500 });
  }
}
