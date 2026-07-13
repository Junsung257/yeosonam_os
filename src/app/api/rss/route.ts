import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');

export const revalidate = 600;
export const dynamic = 'force-dynamic';

type RssPost = {
  slug?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  published_at?: string | null;
  og_image_url?: string | null;
};

export async function GET() {
  const headers = {
    'Content-Type': 'application/rss+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=3600',
  };

  if (!isSupabaseConfigured) {
    return new Response(buildFeed([]), { headers });
  }

  try {
    const { data: posts } = await supabaseAdmin
      .from('content_creatives')
      .select('slug, seo_title, seo_description, published_at, og_image_url')
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(50);

    return new Response(buildFeed((posts || []) as RssPost[]), { headers });
  } catch {
    return new Response(buildFeed([]), { headers });
  }
}

function buildFeed(posts: RssPost[]): string {
  const items = posts.filter((post) => typeof post?.slug === 'string' && post.slug.trim()).map((post) => {
    const title = escXml(post.seo_title || '여소남 블로그');
    const desc = escXml(post.seo_description || '');
    const link = `${BASE_URL}/blog/${encodeURIComponent(post.slug!.trim())}`;
    const date = post.published_at ? new Date(post.published_at) : new Date();
    const pubDate = Number.isFinite(date.getTime()) ? date.toUTCString() : new Date().toUTCString();
    const imageUrl = typeof post.og_image_url === 'string' && /^https?:\/\//i.test(post.og_image_url.trim())
      ? post.og_image_url.trim()
      : null;

    return `    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <description>${desc}</description>
      <content:encoded><![CDATA[${desc}]]></content:encoded>
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
    <description>여소남이 정리한 여행 가이드와 패키지 여행 정보입니다.</description>
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
