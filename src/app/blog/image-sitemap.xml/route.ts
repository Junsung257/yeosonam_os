import { loadPublicBlogCatalog } from '@/lib/blog-public-catalog';
import { resolveBlogCanonicalOrigin } from '@/lib/blog-canonical-url';

export const revalidate = 3600;
// Keep the XML feed on a serverless handler so Vercel does not drop the ISR
// lambda during output conversion. Cache-Control below preserves the public
// one-hour cache contract.
export const dynamic = 'force-dynamic';

const xml = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export async function GET() {
  const baseUrl = resolveBlogCanonicalOrigin();
  const posts = await loadPublicBlogCatalog().catch(() => []);
  const urls = posts.filter((post) => post.og_image_url && /^https?:\/\//i.test(post.og_image_url)).map((post) => `
  <url>
    <loc>${xml(`${baseUrl}/blog/${encodeURIComponent(post.slug)}`)}</loc>
    <image:image>
      <image:loc>${xml(post.og_image_url!)}</image:loc>
    </image:image>
  </url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls}
</urlset>`, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
