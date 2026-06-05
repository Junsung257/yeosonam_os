const OFFICIAL_REFERENCE_LINKS = [
  { label: '외교부 해외안전여행', url: 'https://www.0404.go.kr/' },
  { label: '외교부', url: 'https://www.mofa.go.kr/' },
] as const;

function getMarkdownLinks(markdown: string): string[] {
  const linkRe = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(markdown)) !== null) {
    const url = match[2];
    if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) {
      links.push(url);
    }
  }
  return links;
}

export function appendOfficialReferenceLinksIfNeeded(markdown: string): string {
  const existingLinks = getMarkdownLinks(markdown);
  const externalLinks = existingLinks.filter(url => /^https?:\/\//.test(url) && !url.includes('yeosonam.com'));
  if (externalLinks.length >= 2) return markdown;

  const existingUrlSet = new Set(existingLinks.map(url => url.replace(/\/$/, '')));
  const missingLinks = OFFICIAL_REFERENCE_LINKS.filter(
    link => !existingUrlSet.has(link.url.replace(/\/$/, '')),
  ).slice(0, 2 - externalLinks.length);

  if (missingLinks.length === 0) return markdown;

  return `${markdown.trimEnd()}\n\n## 공식 확인 링크\n\n${missingLinks
    .map(link => `- [${link.label}](${link.url})`)
    .join('\n')}\n`;
}

export function forceAppendOfficialReferenceLinks(markdown: string): string {
  return `${markdown.trimEnd()}\n\n## 공식 확인 링크\n\n${OFFICIAL_REFERENCE_LINKS
    .map(link => `- [${link.label}](${link.url})`)
    .join('\n')}\n`;
}
