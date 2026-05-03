import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 목적지별 RSS 피드 — /destinations/[city]/rss.xml
 *
 * 용도:
 *  - 팬 구독 (Feedly, Inoreader 등)
 *  - 네이버 블로그 RSS 수신자
 *  - 파워유저용 콘텐츠 피드
 *
 * 포함 항목:
 *  - destination 매칭 블로그 글 최신 20개
 *  - Pillar 포함, 모든 content_type
 *  - 간단 캐싱 (Cache-Control: 30분)
 */

export const revalidate = 1800;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { city: string } },
) {
  const { city } = params;
  const decoded = decodeURIComponent(city);

  if (!isSupabaseConfigured) {
    return new NextResponse('<error>db not configured</error>', { status: 503 });
  }

  // destination 매칭 글 (destination 컬럼 또는 travel_packages.destination)
  const { data: posts } = await supabaseAdmin
    .from('content_creatives')
    .select('id, slug, seo_title, seo_description, og_image_url, published_at, updated_at, content_type, destination, travel_packages(destination)')
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .not('slug', 'is', null)
    .order('published_at', { ascending: false })
    .limit(50);

  const filtered = ((posts || []) as Array<any>).filter(p =>
    p.destination === decoded || p.travel_packages?.destination === decoded
  ).slice(0, 20);

  const channelUrl = `${BASE_URL}/destinations/${encodeURIComponent(decoded)}`;
  const channelTitle = `${decoded} 여행 매거진 | 여소남`;
  const channelDesc = `여소남이 엄선한 ${decoded} 여행 가이드와 꿀팁 — 실시간 업데이트`;
  const lastBuild = filtered[0]?.published_at
    ? new Date(filtered[0].published_at).toUTCString()
    : new Date().toUTCString();

  const items = filtered.map(p => {
    const url = `${BASE_URL}/blog/${p.slug}`;
    const pubDate = new Date(p.published_at || Date.now()).toUTCString();
    const title = p.seo_title || `${decoded} 여행 가이드`;
    const desc = p.seo_description || '';
    const category = p.content_type || 'guide';

    return `
    <item>
      <title>${esc(title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${esc(desc)}</description>
      <category>${esc(category)}</category>
      <pubDate>${pubDate}</pubDate>
      ${p.og_image_url ? `<enclosure url="${esc(p.og_image_url)}" type="image/jpeg" />` : ''}
    </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${esc(channelTitle)}</title>
    <link>${channelUrl}</link>
    <atom:link href="${channelUrl}/rss.xml" rel="self" type="application/rss+xml" />
    <description>${esc(channelDesc)}</description>
    <language>ko-KR</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <generator>Yeosonam Blog Engine</generator>
    <image>
      <url>${BASE_URL}/logo.png</url>
      <title>${esc(channelTitle)}</title>
      <link>${channelUrl}</link>
    </image>
${items}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600',
    },
  });
}
