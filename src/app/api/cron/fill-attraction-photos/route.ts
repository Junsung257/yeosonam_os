import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { searchPexelsPhotos, destToEnKeyword, isPexelsConfigured } from '@/lib/pexels';

/**
 * 사진 없는 관광지 자동 Pexels 백필 — 이미지 파이프라인 Tier 3
 *
 * 신규 attraction POST 훅(Tier 2)이 대부분 채우지만, 다음 케이스를 보강:
 *   - 대시보드에서 직접 등록한 attraction
 *   - Pexels API 키 없이 등록된 레거시 데이터
 *   - POST 훅 비동기 실패 (best-effort)
 *
 * vercel.json crons 등록:
 *   { "path": "/api/cron/fill-attraction-photos", "schedule": "0 3 * * *" }
 *
 * 응답: { ok, total, filled, skipped, errors, durationMs }
 */
export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 500 });
  }
  if (!isPexelsConfigured()) {
    return NextResponse.json({ ok: false, error: 'PEXELS_API_KEY 미설정' }, { status: 500 });
  }

  const start = Date.now();
  let filled = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // photos null OR 빈 배열인 활성 attraction 최대 30개 조회
    const { data: targets, error: fetchErr } = await supabaseAdmin
      .from('attractions')
      .select('id, name, destination, region, country')
      .eq('is_active', true)
      .or('photos.is.null,photos.eq.[]')
      .limit(30);

    if (fetchErr) throw fetchErr;
    if (!targets || targets.length === 0) {
      return NextResponse.json({ ok: true, total: 0, filled: 0, skipped: 0, errors: 0, durationMs: Date.now() - start });
    }

    // 병렬 처리 (Pexels 200req/h 제한 — 30개 병렬 문제없음)
    type AttrTarget = { id: string; name: string; destination: string | null; region: string | null; country: string | null };
    await Promise.all(
      (targets as AttrTarget[]).map(async (attr) => {
        try {
          const keyword = destToEnKeyword(attr.destination || attr.region || attr.name);
          const photos = await searchPexelsPhotos(`${keyword} travel`, 5);

          if (photos.length === 0) {
            skipped++;
            return;
          }

          const photoData = photos.map(p => ({
            pexels_id: p.id,
            src_large2x: p.src.large2x,
            src_large: p.src.large,
            src_medium: p.src.medium,
            photographer: p.photographer,
            alt: p.alt,
          }));

          const { error: updateErr } = await supabaseAdmin
            .from('attractions')
            .update({ photos: photoData })
            .eq('id', attr.id);

          if (updateErr) {
            console.error(`[fill-attraction-photos] UPDATE 실패 id=${attr.id}:`, updateErr.message);
            errors++;
          } else {
            filled++;
          }
        } catch (e) {
          console.error(`[fill-attraction-photos] id=${attr.id} 처리 실패:`, e instanceof Error ? e.message : e);
          errors++;
        }
      })
    );

    return NextResponse.json({
      ok: true,
      total: targets.length,
      filled,
      skipped,
      errors,
      durationMs: Date.now() - start,
    });
  } catch (error) {
    console.error('[fill-attraction-photos] 크론 실패:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '처리 실패', durationMs: Date.now() - start },
      { status: 500 },
    );
  }
}
