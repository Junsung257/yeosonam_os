/**
 * 블로그 본문 HTML에서 H2/H3를 찾아 id 부여 + TOC 항목 추출.
 * 마크다운 → HTML 변환 후, sanitize 후에 호출하면 됨 (HTML 태그 단위 정규식).
 */

import type { TocItem } from '@/components/blog/TableOfContents';

const MIN_BODY_LENGTH_FOR_TOC = 1500;

function slugify(text: string): string {
  // 한글 그대로 보존, 공백 → 하이픈, 특수문자 제거
  const base = text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return base || 'section';
}

export function extractTocAndInjectIds(html: string): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = [];
  const usedSlugs = new Set<string>();

  const out = html.replace(/<(h2|h3)([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    if (!text) return match;
    // 이미 id가 있으면 그대로 사용
    const existingId = /\bid=["']([^"']+)["']/i.exec(attrs)?.[1];
    let id = existingId || slugify(text);
    if (!existingId) {
      let suffix = 1;
      const baseId = id;
      while (usedSlugs.has(id)) id = `${baseId}-${++suffix}`;
    }
    usedSlugs.add(id);
    toc.push({ level: tag.toLowerCase() === 'h2' ? 2 : 3, text, id });
    if (existingId) return match; // 그대로
    return `<${tag} id="${id}"${attrs}>${inner}</${tag}>`;
  });

  return { html: out, toc };
}

export function shouldShowToc(htmlOrMd: string, toc: { length: number }): boolean {
  if (!toc.length) return false;
  const plain = htmlOrMd.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return plain.length >= MIN_BODY_LENGTH_FOR_TOC;
}
