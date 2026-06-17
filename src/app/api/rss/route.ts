import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');

// ISR 10분 — Edge CDN + 프레임워크 캐시 둘 다 활용. force-dynamic 보다 cold start 빠름.
export const revalidate = 600;
export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = {
    'Content-Type': 'application/rss+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=3600',
  };

  if (!isSupabaseConfigured) {
    return new Response(buildFeed([]), { headers });
  }

  try {
    // blog_html 제외 (전체 본문은 무거움. snippet 은 seo_description fallback).
    //   이전: blog_html 포함 시 50개 row 가 수 MB 됨 → 5초+ TTFB
    const { data: posts } = await supabaseAdmin
      .from('content_creatives')
      .select('slug, seo_title, seo_description, published_at, og_image_url, travel_packages(title, destination)')
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(50);

    return new Response(buildFeed(posts || []), { headers });
  } catch {
    return new Response(buildFeed([]), { headers });
  }
}

function buildFeed(posts: any[]): string {
  const items = posts.filter((post) => typeof post?.slug === 'string' && post.slug.trim()).map((post) => {
    const title = escXml(post.seo_title || post.travel_packages?.title || '여소남 블로그');
    const desc = escXml(post.seo_description || '');
    const link = `${BASE_URL}/blog/${encodeURIComponent(post.slug.trim())}`;
    const date = post.published_at ? new Date(post.published_at) : new Date();
    const pubDate = Number.isFinite(date.getTime()) ? date.toUTCString() : new Date().toUTCString();
    const imageUrl = typeof post.og_image_url === 'string' && /^https?:\/\//i.test(post.og_image_url.trim())
      ? post.og_image_url.trim()
      : null;
    // blog_html 안 가져오므로 seo_description 으로 fallback (이미 escape 된 desc 재사용).
    const snippet = desc;

    return `    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <description>${desc}</description>
      <content:encoded><![CDATA[${snippet}]]></content:encoded>
      <pubDate>${pubDate}</pubDate>${imageUrl ? `
      <enclosure url="${escXml(imageUrl)}" type="image/jpeg" />` : ''}
    </item>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>여소남 여행 블로그</title>
    <link>${BASE_URL}/blog</link>
    <description>단체·패키지 여행 전문 AI 플랫폼 여소남의 여행 블로그</description>
    <language>ko</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${BASE_URL}/api/rss" rel="self" type="application/rss+xml" />
    <atom:link rel="hub" href="https://pubsubhubbub.appspot.com" />
${items.join('\n')}
  </channel>
</rss>`;
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
