import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getCardNewsList, upsertCardNews } from '@/lib/supabase';
import { searchPexelsPhotos, buildPexelsKeyword, isPexelsConfigured } from '@/lib/pexels';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ card_news: [] });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status') ?? undefined;
  const packageId = searchParams.get('package_id') ?? undefined;
  const limit = parseInt(searchParams.get('limit') ?? '20');

  try {
    const list = await getCardNewsList({ status, packageId, limit });
    return NextResponse.json({ card_news: list });
  } catch (error) {
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const { package_id, title: customTitle } = await request.json();

    if (!package_id) {
      return NextResponse.json({ error: 'package_id 필수' }, { status: 400 });
    }

    // 상품 정보 조회 (supabaseAdmin으로 RLS 우회)
    const { supabaseAdmin } = await import('@/lib/supabase');
    const { data: pkg } = await supabaseAdmin
      .from('travel_packages')
      .select('title, destination, price, duration, itinerary, inclusions, excludes, product_highlights, product_summary')
      .eq('id', package_id)
      .single();

    if (!pkg) {
      return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });
    }

    const title = customTitle ?? `${pkg.title} — 카드뉴스`;
    const destination = pkg.destination ?? '여행지';

    // 슬라이드 자동 생성
    const slides = await buildAutoSlides(pkg, destination) as import('@/lib/supabase').CardNewsSlide[];

    const cardNews = await upsertCardNews({
      package_id,
      title,
      status: 'DRAFT',
      slides,
    });

    return NextResponse.json({ card_news: cardNews }, { status: 201 });
  } catch (error) {
    console.error('카드뉴스 생성 실패:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '생성 실패' },
      { status: 500 }
    );
  }
}

async function buildAutoSlides(pkg: any, destination: string) {
  // Pexels 이미지 — 타임아웃 방어 (최대 5초)
  const pexelsEnabled = isPexelsConfigured();

  async function getImage(keyword: string): Promise<string> {
    if (!pexelsEnabled) return '';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const photos = await searchPexelsPhotos(keyword, 3);
      clearTimeout(timeout);
      return photos[0]?.src?.large2x ?? '';
    } catch {
      return '';
    }
  }

  const slideTypes = [
    'cover',
    ...(pkg.itinerary?.slice(0, 4).map((_: string, i: number) => `day${i + 1}`) ?? []),
    'inclusions',
    'excludes',
    'cta',
  ];

  // 병렬 + 타임아웃 래퍼 (전체 8초 제한)
  let images: string[];
  try {
    images = await Promise.race([
      Promise.all(
        slideTypes.map(t => getImage(buildPexelsKeyword(destination, t.startsWith('day') ? 'itinerary' : t)))
      ),
      new Promise<string[]>(resolve =>
        setTimeout(() => resolve(slideTypes.map(() => '')), 7000)
      ),
    ]);
  } catch {
    images = slideTypes.map(() => '');
  }

  const slides = [];
  let pos = 0;

  // 커버 슬라이드
  slides.push({
    id: crypto.randomUUID(),
    position: pos++,
    headline: pkg.title,
    body: `📍 ${destination}  ·  ${pkg.duration ?? '?'}일  ·  ${(pkg.price ?? 0).toLocaleString()}원~`,
    bg_image_url: images[0] ?? '',
    pexels_keyword: buildPexelsKeyword(destination, 'cover'),
    overlay_style: 'gradient-bottom',
  });

  // 일정 슬라이드 (최대 4개)
  const itinerary: string[] = pkg.itinerary?.slice(0, 4) ?? [];
  for (let i = 0; i < itinerary.length; i++) {
    slides.push({
      id: crypto.randomUUID(),
      position: pos++,
      headline: `Day ${i + 1}`,
      body: itinerary[i],
      bg_image_url: images[1 + i] ?? '',
      pexels_keyword: buildPexelsKeyword(destination, 'itinerary'),
      overlay_style: 'dark',
    });
  }

  // 포함사항
  const inclusions: string[] = pkg.inclusions?.slice(0, 5) ?? [];
  if (inclusions.length > 0) {
    slides.push({
      id: crypto.randomUUID(),
      position: pos++,
      headline: '✅ 포함사항',
      body: inclusions.map((s: string) => `• ${s}`).join('\n'),
      bg_image_url: images[1 + itinerary.length] ?? '',
      pexels_keyword: buildPexelsKeyword(destination, 'inclusions'),
      overlay_style: 'gradient-top',
    });
  }

  // 불포함사항
  const excludes: string[] = pkg.excludes?.slice(0, 4) ?? [];
  if (excludes.length > 0) {
    slides.push({
      id: crypto.randomUUID(),
      position: pos++,
      headline: '❌ 불포함사항',
      body: excludes.map((s: string) => `• ${s}`).join('\n'),
      bg_image_url: images[2 + itinerary.length] ?? '',
      pexels_keyword: buildPexelsKeyword(destination, 'excludes'),
      overlay_style: 'dark',
    });
  }

  // CTA 슬라이드
  slides.push({
    id: crypto.randomUUID(),
    position: pos++,
    headline: '지금 예약하기',
    body: `${destination} ${pkg.duration ?? ''}일 여행\n단 ${(pkg.price ?? 0).toLocaleString()}원부터`,
    bg_image_url: images[images.length - 1] ?? '',
    pexels_keyword: buildPexelsKeyword(destination, 'cta'),
    overlay_style: 'gradient-bottom',
  });

  return slides;
}
