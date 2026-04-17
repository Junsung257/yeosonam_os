import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

// 이 라우트는 동적으로 XML을 생성하는 API 엔드포인트
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

// 정적 페이지들 (우선도: 높음)
const STATIC_PAGES = [
  { url: '/', priority: 1.0, changefreq: 'daily' },
  { url: '/packages', priority: 0.9, changefreq: 'daily' },
  { url: '/blog', priority: 0.8, changefreq: 'weekly' },
  { url: '/concierge', priority: 0.7, changefreq: 'monthly' },
  { url: '/group-inquiry', priority: 0.6, changefreq: 'monthly' },
];

async function generateSitemap() {
  let blogPosts: Array<{ slug: string; published_at: string }> = [];

  if (isSupabaseConfigured) {
    try {
      const { data } = await supabaseAdmin
        .from('content_creatives')
        .select('slug, published_at')
        .eq('status', 'published')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .order('published_at', { ascending: false });

      if (data) {
        blogPosts = data as Array<{ slug: string; published_at: string }>;
      }
    } catch (err) {
      console.error('[Sitemap] 블로그 글 조회 실패:', err);
    }
  }

  // XML 생성
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  // 정적 페이지
  STATIC_PAGES.forEach(page => {
    xml += '  <url>\n';
    xml += `    <loc>${BASE_URL}${page.url}</loc>\n`;
    xml += `    <priority>${page.priority}</priority>\n`;
    xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
    xml += '  </url>\n';
  });

  // 동적 블로그 글
  blogPosts.forEach(post => {
    xml += '  <url>\n';
    xml += `    <loc>${BASE_URL}/blog/${post.slug}</loc>\n`;
    xml += `    <lastmod>${new Date(post.published_at).toISOString().split('T')[0]}</lastmod>\n`;
    xml += '    <priority>0.7</priority>\n';
    xml += '    <changefreq>monthly</changefreq>\n';
    xml += '  </url>\n';
  });

  xml += '</urlset>';
  return xml;
}

export async function GET(request: NextRequest) {
  try {
    const sitemap = await generateSitemap();
    return new NextResponse(sitemap, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600', // 1시간 캐시
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('[Sitemap] 생성 실패:', err);
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
      {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  }
}
