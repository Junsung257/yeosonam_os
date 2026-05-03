/**
 * 블로그 본문 하단 CTA — UTM·캠페인 슬러그 표준 (자비스/분석 귀속용).
 */
export function buildStandardBlogCtaMarkdown(opts: {
  destination: string | null | undefined;
  slug: string;
  baseUrl?: string;
}): string {
  const base = (opts.baseUrl || process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com').replace(
    /\/$/,
    '',
  );
  const slug = opts.slug || 'blog';
  const utm = (content: string) =>
    `utm_source=blog&utm_medium=organic&utm_campaign=${encodeURIComponent(slug)}&utm_content=${encodeURIComponent(content)}`;

  const dest = opts.destination?.trim();
  const pkgPath = dest
    ? `/packages?destination=${encodeURIComponent(dest)}&${utm('packages_bottom')}`
    : `/packages?${utm('packages_bottom')}`;

  const lines = [
    '> **여소남 여행 준비**',
    '>',
    `> - [관련 패키지 보기](${base}${pkgPath})`,
    `> - [카카오톡 무료 상담](https://pf.kakao.com/_xfxnFj/chat)`,
    `> - [여소남 홈에서 상담 이어가기](${base}/?${utm('site_consult')})`,
  ];

  return lines.join('\n');
}
