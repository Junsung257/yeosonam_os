/**
 * POST /api/card-news/campaign
 * 원클릭 캠페인 오케스트레이터:
 *   ContentBrief 생성 → 슬라이드 생성 → render-v2 await → (auto_confirm 시) CONFIRMED
 *
 * Body:
 *   package_id: string                        // 대상 상품 UUID
 *   angle?: string                            // value|luxury|urgency|emotional|filial|activity|food
 *   template_family?: string                  // editorial|cinematic|premium|bold
 *   auto_confirm?: boolean                    // true면 렌더 완료 후 자동 CONFIRMED (기본 false)
 *
 * Response:
 *   { card_news_id, job_id, status, render_ok, card_news }
 *
 * GET /api/card-news/campaign?job_id=xxx
 *   → content_factory_jobs 조회 (UI polling용)
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin, upsertCardNews } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';
import { insertBlogTopicQueue } from '@/lib/card-news/blog-topic-queue';
import { getSecret } from '@/lib/secret-registry';
import { generateContentBrief } from '@/lib/content-pipeline/content-brief';
import { generateCardCopy, type CardSlideCopy } from '@/lib/content-pipeline/card-copy';
import { searchPexelsPhotos, isPexelsConfigured } from '@/lib/pexels';

export const maxDuration = 120;
export const runtime = 'nodejs';

function appOrigin(): string {
  const u = getSecret('NEXT_PUBLIC_APP_URL') || getSecret('NEXT_PUBLIC_BASE_URL');
  if (u) return u.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://127.0.0.1:${process.env.PORT ?? 3000}`;
}

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const jobId = request.nextUrl.searchParams.get('job_id');
  if (!jobId) {
    return NextResponse.json({ error: 'job_id 필수' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('content_factory_jobs')
    .select('id, card_news_id, status, steps, completed_steps, failed_steps, created_at, updated_at')
    .eq('id', jobId)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: '잡을 찾을 수 없습니다' }, { status: 404 });
  }

  const { data: cn } = await supabaseAdmin
    .from('card_news')
    .select('id, status, title, slide_image_urls, template_family')
    .eq('id', (data as { card_news_id: string }).card_news_id)
    .maybeSingle();

  return NextResponse.json({ job: data, card_news: cn });
}

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json() as {
      package_id: string;
      angle?: string;
      template_family?: string;
      auto_confirm?: boolean;
    };

    if (!body.package_id) {
      return NextResponse.json({ error: 'package_id 필수' }, { status: 400 });
    }

    const templateFamily = (body.template_family ?? 'editorial') as 'editorial' | 'cinematic' | 'premium' | 'bold';

    // Step 1: 상품 정보 조회
    type PkgRow = {
      title: string; destination?: string; price?: number; duration?: string | number;
      itinerary?: string[]; inclusions?: string[]; product_highlights?: string[];
      product_summary?: string; special_notes?: string; airline?: string; departure_airport?: string;
    };
    const { data: pkg } = await supabaseAdmin
      .from('travel_packages')
      .select('title, destination, price, duration, itinerary, inclusions, product_highlights, product_summary, special_notes, airline, departure_airport')
      .eq('id', body.package_id)
      .maybeSingle();
    if (!pkg) {
      return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });
    }
    const pkgRow = pkg as PkgRow;

    // Step 2: ContentBrief 생성 (라이브러리 직접 호출)
    const brief = await generateContentBrief({
      mode: 'product',
      product: {
        title: pkgRow.title,
        destination: pkgRow.destination,
        price: pkgRow.price,
        inclusions: pkgRow.inclusions,
        product_highlights: pkgRow.product_highlights,
        itinerary: pkgRow.itinerary,
        product_summary: pkgRow.product_summary,
        special_notes: pkgRow.special_notes,
        airline: pkgRow.airline,
        departure_airport: pkgRow.departure_airport,
      },
      angle: body.angle,
    });

    // Step 3: 슬라이드 카피 생성
    const copySlides = await generateCardCopy(brief as never);
    const briefAny = brief as { h1?: string; target_audience?: string };

    // Pexels 이미지 병렬 로드
    const pexelsEnabled = isPexelsConfigured();
    const fallbackKeyword = String(briefAny.h1 ?? briefAny.target_audience ?? 'travel')
      .split(/\s+/).slice(0, 2).join(' ') || 'travel';

    const images: string[] = await Promise.all(
      copySlides.map(async (s: CardSlideCopy) => {
        if (!pexelsEnabled) return '';
        const candidates = [s.pexels_keyword, fallbackKeyword, 'travel landscape']
          .filter((k): k is string => !!k && k.trim().length > 0);
        for (const kw of candidates) {
          try {
            const photos = await searchPexelsPhotos(kw, 3);
            const url = (photos[0] as { src?: { large2x?: string; large?: string } })?.src?.large2x
              || (photos[0] as { src?: { large?: string } })?.src?.large;
            if (url) return url;
          } catch { /* fallback */ }
        }
        return '';
      }),
    );

    const slides = copySlides.map((s: CardSlideCopy, i: number) => ({
      id: crypto.randomUUID(),
      position: s.position ?? i,
      headline: s.headline,
      body: s.body,
      bg_image_url: images[i] ?? '',
      pexels_keyword: s.pexels_keyword,
      overlay_style: s.role === 'hook' || s.role === 'cta' ? 'gradient-bottom' : 'dark',
      headline_style: { fontFamily: 'Pretendard', fontSize: s.role === 'hook' ? 40 : 32, color: '#ffffff', fontWeight: 'bold', textAlign: 'center' },
      body_style: { fontFamily: 'Pretendard', fontSize: 18, color: '#e0e0e0', fontWeight: 'normal', textAlign: 'center' },
      template_id: s.template_id,
      role: s.role,
      badge: s.badge ?? null,
      template_family: templateFamily,
      template_version: 'v2',
      eyebrow: s.eyebrow ?? null,
      tip: s.tip ?? null,
      warning: s.warning ?? null,
      price_chip: s.price_chip ?? null,
      trust_row: s.trust_row ?? null,
      accent_color: s.accent_color ?? null,
      photo_hint: s.photo_hint ?? null,
    }));

    const cardNews = await upsertCardNews({
      package_id: body.package_id,
      title: briefAny.h1 ?? pkgRow.title ?? '카드뉴스',
      status: 'DRAFT',
      slides,
      card_news_type: 'product',
      template_family: templateFamily,
      template_version: 'v2',
      generation_config: { brief, angle: body.angle },
    } as never);

    const cardNewsId = (cardNews as { id?: string })?.id;
    if (!cardNewsId) {
      return NextResponse.json({ error: '카드뉴스 ID 누락' }, { status: 500 });
    }

    // content_factory_jobs INSERT
    await supabaseAdmin.from('content_factory_jobs').insert({
      card_news_id: cardNewsId,
      product_id: body.package_id,
      status: 'pending',
    }).then().catch(() => {});

    // job_id 조회
    const { data: jobRow } = await supabaseAdmin
      .from('content_factory_jobs')
      .select('id')
      .eq('card_news_id', cardNewsId)
      .maybeSingle();
    const jobId = (jobRow as { id?: string } | null)?.id ?? null;

    // Step 4: render-v2 await (동기 처리)
    const origin = appOrigin();
    const renderRes = await fetch(`${origin}/api/card-news/render-v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_news_id: cardNewsId, formats: ['1x1'] }),
    }).catch(() => null);

    let renderOk = false;
    if (renderRes?.ok) {
      const renderData = await renderRes.json().catch(() => ({})) as { renders?: Array<{ url: string | null }> };
      renderOk = renderData.renders?.some((r) => r.url !== null) ?? false;
    }

    // Step 5: auto_confirm + 렌더 성공 시 CONFIRMED 전환
    if (body.auto_confirm && renderOk) {
      await supabaseAdmin
        .from('card_news')
        .update({ status: 'CONFIRMED', updated_at: new Date().toISOString() })
        .eq('id', cardNewsId);
      await insertBlogTopicQueue(cardNewsId, 'card_news_confirm_hook');
    }

    const { data: finalCn } = await supabaseAdmin
      .from('card_news')
      .select('id, status, title, slide_image_urls')
      .eq('id', cardNewsId)
      .maybeSingle();

    return NextResponse.json({
      card_news_id: cardNewsId,
      job_id: jobId,
      status: (finalCn as { status?: string } | null)?.status ?? 'DRAFT',
      render_ok: renderOk,
      card_news: finalCn,
    }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[campaign] 오케스트레이터 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
