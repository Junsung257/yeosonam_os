import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';

export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = {
    'Content-Type': 'application/rss+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=600, s-maxage=600',
  };

  if (!isSupabaseConfigured) {
    return new Response(buildFeed([]), { headers });
  }

  try {
    const { data: posts } = await supabaseAdmin
      .from('content_creatives')
      .select('slug, seo_title, seo_description, blog_html, published_at, og_image_url, travel_packages(title, destination)')
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
  const items = posts.map((post) => {
    const title = escXml(post.seo_title || post.travel_packages?.title || '여소남 블로그');
    const desc = escXml(post.seo_description || '');
    const link = `${BASE_URL}/blog/${post.slug}`;
    const pubDate = post.published_at ? new Date(post.published_at).toUTCString() : new Date().toUTCString();
    const snippet = escXml(
      (post.blog_html || '').replace(/<[^>]*>/g, '').replace(/[#*\[\]()!|`>-]/g, '').trim().substring(0, 300)
    );

    return `    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <description>${desc}</description>
      <content:encoded><![CDATA[${snippet}]]></content:encoded>
      <pubDate>${pubDate}</pubDate>${post.og_image_url ? `
      <enclosure url="${escXml(post.og_image_url)}" type="image/jpeg" />` : ''}
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
