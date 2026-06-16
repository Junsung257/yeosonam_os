/**
 * Standard blog CTA block.
 *
 * The SEO scorer counts CTA links only among internal links, so this block must
 * include at least two valid internal CTA links in addition to the Kakao link.
 */
export function buildStandardBlogCtaMarkdown(opts: {
  destination: string | null | undefined;
  slug: string;
  baseUrl?: string;
  utmSource?: string;
  utmMedium?: string;
}): string {
  const base = (opts.baseUrl || process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com').replace(
    /\/$/,
    '',
  );
  const slug = opts.slug || 'blog';
  const src = opts.utmSource || 'blog';
  const med = opts.utmMedium || 'organic';
  const utm = (content: string) =>
    `utm_source=${encodeURIComponent(src)}&utm_medium=${encodeURIComponent(med)}&utm_campaign=${encodeURIComponent(slug)}&utm_content=${encodeURIComponent(content)}`;

  const dest = opts.destination?.trim();
  const pkgPath = dest
    ? `/packages?destination=${encodeURIComponent(dest)}&${utm('packages_bottom')}`
    : `/packages?${utm('packages_bottom')}`;
  const destinationBlogPath = dest
    ? `/blog/destination/${encodeURIComponent(dest)}?${utm('destination_blog')}`
    : `/blog?${utm('blog_index')}`;

  const lines = [
    '> **여소남 여행 준비**',
    '>',
    `> - [관련 패키지 보기](${base}${pkgPath})`,
    `> - [목적지 블로그 더 보기](${base}${destinationBlogPath})`,
    `> - [카카오톡 무료 상담](https://pf.kakao.com/_xfxnFj/chat)`,
    `> - [여소남 홈에서 상담 이어가기](${base}/?${utm('site_consult')})`,
  ];

  return lines.join('\n');
}
