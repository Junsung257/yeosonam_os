/**
 * blog-publisher ↔ /api/blog/from-card-news `publisher_bridge` 응답 계약.
 * 크론 재시도·배포 버전 불일치 시 조기에 실패 원인을 좁히기 위한 파서.
 */

export type PublisherBridgeResponse = {
  publisher_bridge: true;
  blog_html: string;
  slug: string;
  seo_title: string;
  seo_description: string;
  og_image_url?: string | null;
};

export function parsePublisherBridgeResponse(raw: unknown): PublisherBridgeResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.publisher_bridge !== true) return null;
  const blog_html = typeof o.blog_html === 'string' ? o.blog_html : '';
  const slug = typeof o.slug === 'string' ? o.slug : '';
  const seo_title = typeof o.seo_title === 'string' ? o.seo_title : '';
  const seo_description = typeof o.seo_description === 'string' ? o.seo_description : '';
  if (!blog_html.trim() || !slug.trim()) return null;

  let og_image_url: string | null | undefined;
  if (typeof o.og_image_url === 'string') og_image_url = o.og_image_url;
  else if (o.og_image_url === null) og_image_url = null;

  return {
    publisher_bridge: true,
    blog_html,
    slug,
    seo_title,
    seo_description,
    og_image_url,
  };
}
