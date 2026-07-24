const BLOG_DETAIL_NOT_FOUND_PATTERN = /E1401|블로그 글을 찾을 수 없습니다|페이지를 찾을 수 없습니다|page not found|blog post not found/i;
const BLOG_DETAIL_NOINDEX_PATTERN = /<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i;
const BLOG_CANONICAL_PATTERN = /<link\b(?=[^>]*\brel=["']canonical["'])(?=[^>]*\bhref=["'][^"']*\/blog\/[^"']+["'])[^>]*>/i;

function htmlTitle(body) {
  return String(body || '').match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
}

export function blogDetailLooksRenderable(body) {
  const html = String(body || '');
  const title = htmlTitle(html);
  return Boolean(title)
    && !BLOG_DETAIL_NOT_FOUND_PATTERN.test(title)
    && !BLOG_DETAIL_NOINDEX_PATTERN.test(html)
    && BLOG_CANONICAL_PATTERN.test(html);
}
