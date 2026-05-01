import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
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

    // photos_only=1: 홈페이지용 경량 쿼리 (사진 매칭에 필요한 최소 필드만)
    const photosOnly = searchParams.get('photos_only');
    const fields = photosOnly
      ? 'id, name, country, region, photos, mention_count'
      : 'id, name, short_desc, long_desc, category, badge_type, emoji, country, region, aliases, photos, mention_count, created_at';

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
    const { data, error } = await supabaseAdmin
      .from('attractions')
      .insert({
        name: sanitizeName(body.name) || body.name, // sanitize 후 빈 이름은 원본 유지 (edge case)
        short_desc: body.short_desc || null,
        long_desc: body.long_desc || null,
        country: body.country || null,
        region: body.region || null,
        badge_type: normalizeBadgeType(body.badge_type),
        emoji: sanitizeEmoji(body.emoji),
        aliases: body.aliases || [],
        photos: body.photos || [],
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
    if (!body.photos?.length && process.env.PEXELS_API_KEY) {
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
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

    const { error } = await supabaseAdmin
      .from('attractions')
      .update(updates)
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
