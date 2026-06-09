import { applyHtmlAccents, applyMarkdownAccents } from '@/lib/blog-accent';
import { proxyBlogImageUrlsInHtml } from '@/lib/blog-image-proxy';

export interface RenderBlogContentOptions {
  stripDecorativeBold?: boolean;
}

export interface RenderedBlogIntegrityReport {
  passed: boolean;
  reason?: string;
  evidence: {
    markdownImageCount: number;
    renderedImageCount: number;
    markdownHeadingCount: number;
    renderedHeadingCount: number;
    artifactCount: number;
    artifacts: string[];
  };
}

const MARKDOWN_SIGNAL_PATTERNS = [
  /(^|\n)\s{0,3}#{1,6}\s+\S/,
  /(^|\n)\s{0,3}!\[[^\]]*]\([^)]+\)/,
  /\[[^\]]+]\((?:https?:\/\/|\/)[^)]+\)/,
  /(^|\n)\s{0,3}[-*+]\s+\S/,
  /(^|\n)\s{0,3}\d+\.\s+\S/,
  /(^|\n)\s{0,3}\|.+\|\s*(?=\n|$)/,
  /(^|\n)\s{0,3}---+\s*(?=\n|$)/,
  /(^|\n):::/,
  /(^|\n)>\s+\S/,
];

const HTML_TAG_RE = /<[a-z][\s\S]*>/i;
const MARKDOWN_IMAGE_RE = /!\[[^\]]*]\([^)]+\)/g;
const MARKDOWN_HEADING_RE = /(^|\n)\s{0,3}#{1,6}\s+\S/g;
const RENDERED_IMAGE_RE = /<img\b/gi;
const RENDERED_HEADING_RE = /<h[2-4]\b/gi;
const SUPABASE_BLOG_ASSET_RE = /https?:\/\/[^"')\s]+supabase\.co\/storage\/v1\/object\/public\/blog-assets\/[^"')\s]+/gi;
const LONG_HEADING_SPLIT_KEYWORDS = [
  '가이드',
  '총정리',
  '분석',
  '추천',
  '비교',
  '선택은?',
  '정리',
  '팁',
  '질문',
  '링크',
  '리스트',
  '개요',
  '비교표',
];

function normalizeLongHeadingLine(line: string): string {
  if (!/^#{1,6}\s+\S/.test(line) || line.length < 80) return line;

  const colonSplit = line.match(/^(#{1,6}\s+[^:：]{12,100}?)[\:：]\s+(.+)$/);
  if (colonSplit && colonSplit[2].trim().length >= 20) {
    return `${colonSplit[1].trim()}\n\n${colonSplit[2].trim()}`;
  }

  for (const keyword of LONG_HEADING_SPLIT_KEYWORDS) {
    const idx = line.indexOf(keyword);
    if (idx < 0) continue;
    const splitAt = idx + keyword.length;
    const heading = line.slice(0, splitAt).trim();
    const rest = line.slice(splitAt).trim();
    if (heading.length >= 12 && rest.length >= 20) {
      return `${heading}\n\n${rest}`;
    }
  }

  return line;
}

function normalizeCollapsedBulletLines(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith('- ')) return line;
      return line.replace(/\s+-\s+(?=\S)/g, '\n- ');
    })
    .join('\n');
}

function countPipes(value: string): number {
  return (value.match(/\|/g) || []).length;
}

function nthPipeIndex(value: string, pipeCount: number): number {
  let seen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '|') continue;
    seen += 1;
    if (seen === pipeCount) return index;
  }
  return -1;
}

function normalizeTableSeparatorLine(line: string): string | null {
  const trimmed = line.replace(/<br\s*\/?>/gi, '').trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = trimmed.split('|').filter((cell) => cell.trim().length > 0);
  if (cells.length === 0) return null;
  if (!cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()))) return null;
  return `|${cells.map(() => '---').join('|')}|`;
}

function normalizeCollapsedTableRows(source: string): string {
  const withRowBoundaries = source
    .replace(/\|\s+\|(?=(?::?-{2,}:?)|[*_~]|[가-힣A-Za-z0-9$-])/g, '|\n|')
    .replace(/\|\|(?=(?::?-{2,}:?)|[*_~]|[가-힣A-Za-z0-9$-])/g, '|\n|')
    .replace(/^\|:?-{2,}:?\|:?-{20,}:?\|(.+\|)$/gm, (_match, rowPart: string) => {
      const cells = rowPart.split('|').filter((cell) => cell.trim().length > 0);
      const row = `|${cells.join('|')}|`;
      const firstCell = cells[0]?.replace(/<[^>]+>/g, '').replace(/\*/g, '').trim() || '';
      if (/^(구분|항목|월|월별|서류)$/.test(firstCell)) {
        return `${row}\n|${cells.map(() => '---').join('|')}|`;
      }
      return row;
    });

  const rawLines = withRowBoundaries.split('\n');
  const lines: string[] = [];
  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index];
    const nextLine = rawLines[index + 1]?.trim() || '';
    const firstPipe = line.indexOf('|');
    const lineStartsAsTable = line.trimStart().startsWith('|');
    const nextIsSeparator = /^\|?\s*:?-{3,}:?\s*\|/.test(nextLine);
    const firstCell = lineStartsAsTable ? line.split('|')[1]?.trim() || '' : '';

    const firstCellLooksLikeProse = firstCell.length > 12 && /[.!?。！？]|입니다|합니다|됩니다|평균|추천|여행|계절/.test(firstCell);

    if (lineStartsAsTable && nextIsSeparator && firstCellLooksLikeProse) {
      const parts = line.split('|');
      const prefix = parts[1]?.trim();
      const tableRow = `|${parts.slice(2).join('|')}`.trim();
      if (prefix) lines.push(prefix);
      if (tableRow !== '|') lines.push(tableRow);
      continue;
    }

    if (lineStartsAsTable && countPipes(line) === 1 && !nextIsSeparator) {
      lines.push(line.replace(/^\s*\|/, ''));
      continue;
    }

    if (firstPipe > 0 && !lineStartsAsTable && nextIsSeparator) {
      const prefix = line.slice(0, firstPipe).trimEnd();
      const tableRow = line.slice(firstPipe).trimStart();
      if (prefix) lines.push(prefix);
      lines.push(tableRow);
      continue;
    }

    lines.push(line);
  }

  const normalized: string[] = [];
  let expectedPipeCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\|?\s*:?-{2,}:?\s*\|/.test(trimmed)) {
      const previous = normalized[normalized.length - 1]?.trim() || '';
      const previousPipeCount = previous.startsWith('|') ? countPipes(previous) : 0;
      let separatorLine = normalizeTableSeparatorLine(line) || line;
      if (previousPipeCount > countPipes(separatorLine.trim())) {
        separatorLine = `|${Array.from({ length: previousPipeCount - 1 }, () => '---').join('|')}|`;
      }
      expectedPipeCount = countPipes(separatorLine.trim());
      normalized.push(separatorLine);
      continue;
    }

    if (expectedPipeCount > 0 && trimmed.startsWith('|') && countPipes(trimmed) >= expectedPipeCount) {
      const endIndex = nthPipeIndex(line, expectedPipeCount);
      if (endIndex >= 0) {
        const row = line.slice(0, endIndex + 1).trimEnd();
        const rest = line.slice(endIndex + 1).trim();
        normalized.push(row);
        if (rest) normalized.push(rest);
        if (rest && !rest.startsWith('|')) expectedPipeCount = 0;
        continue;
      }
    }

    if (expectedPipeCount > 0 && trimmed && !trimmed.startsWith('|')) {
      expectedPipeCount = 0;
    }
    normalized.push(line);
  }

  return normalized.join('\n');
}

export function normalizeStoredBlogMarkdownStructure(source: string): string {
  let out = source.replace(/\r\n?/g, '\n');

  // Legacy generated posts sometimes collapsed block markdown into one long line:
  // "... CTA) ## 핵심 요약 ![image](...) ... --- ## 다음 섹션".
  // Recover block boundaries before marked parses the first heading as the whole body.
  out = out.replace(/[ \t]+(?=#{2,6}\s+\S)/g, '\n\n');
  out = out.replace(/[ \t]+(?=!\[[^\]]*]\([^)]+\))/g, '\n\n');
  out = out.replace(/[ \t]+---+[ \t]+/g, '\n\n---\n\n');
  out = out.replace(/(<\/figcaption>)[ \t]+/gi, '$1\n\n');
  out = out.replace(/(<\/aside>)[ \t]+/gi, '$1\n\n');
  out = out.replace(/(<\/figcaption>)\n(?=\S)/gi, '$1\n\n');
  out = out.replace(/(<\/aside>)\n(?=\S)/gi, '$1\n\n');
  out = out.replace(/(\[[^\]]+]\((?:https?:\/\/|\/)[^)]+\))(?=[가-힣A-Za-z])/g, '$1 ');

  // Recover collapsed GFM tables where a heading and the first table row share a line,
  // or multiple table rows were squeezed together as "||".
  out = out.replace(/(^|\n)(#{2,6}\s+[^\n|]{1,100})\|/g, '$1$2\n\n|');
  out = normalizeCollapsedTableRows(out);
  out = out.replace(/(^|\n)(\|[^\n]+\|\n\|?\s*:?-{2,}:?[^\n]*\|)/g, '$1\n$2');
  out = out.replace(/(\|[^\n]+\|)\n(?=#{2,6}\s+\S)/g, '$1\n\n');
  out = out.replace(/(\|[^\n]+\|)(?=#{2,6}\s+\S)/g, '$1\n\n');
  out = out.replace(/(^|\n)(#{2,6}\s+[^\n|]{1,100})\|/g, '$1$2\n\n|');
  out = normalizeCollapsedTableRows(out);
  out = out.replace(/\n\|[^|\n]+(?:\|[^|\n]+)+\|\n\|---(?:\|---)+\|\n(?!\|)/g, '\n');
  out = normalizeCollapsedBulletLines(out);
  out = out
    .split('\n')
    .map(normalizeLongHeadingLine)
    .map((line) => line.replace(/\s+---\s*$/, '\n\n---'))
    .join('\n');

  return out.replace(/\n{4,}/g, '\n\n\n').trim();
}

function hasMarkdownSignals(source: string): boolean {
  return MARKDOWN_SIGNAL_PATTERNS.some((pattern) => pattern.test(source));
}

function shouldParseAsMarkdown(source: string): boolean {
  if (!source.trim()) return false;
  if (hasMarkdownSignals(source)) return true;
  return !HTML_TAG_RE.test(source);
}

function stripHtmlForArtifactScan(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function countMatches(value: string, pattern: RegExp): number {
  return (value.match(pattern) || []).length;
}

function renderResidualMarkdownLinks(html: string): string {
  return html.replace(/\[([^\]]+)]\(((?:https?:\/\/|\/)[^)]+)\)/g, (_match, label: string, href: string) => {
    const safeHref = href.replace(/"/g, '&quot;');
    return `<a href="${safeHref}">${label}</a>`;
  });
}

export async function renderBlogContentToHtml(
  source: string,
  options: RenderBlogContentOptions = {},
): Promise<string> {
  if (!source.trim()) return '';

  if (!shouldParseAsMarkdown(source)) {
    return proxyBlogImageUrlsInHtml(applyHtmlAccents(source));
  }

  const normalizedSource = normalizeStoredBlogMarkdownStructure(source);
  const deDecoratedSource = normalizedSource.replace(/~~([^~]{1,300}?)~~/gs, (_match, inner) => inner.replace(/\s+/g, ' ').trim());
  const markdownSource = options.stripDecorativeBold === false
    ? deDecoratedSource
    : deDecoratedSource.replace(/\*\*([^*]{1,180}?)\*\*/gs, (_m, inner) => inner.replace(/\s+/g, ' ').trim());
  const mdAccented = applyMarkdownAccents(markdownSource);
  const { marked } = await import('marked');
  const rawHtml = await marked.parse(mdAccented, { gfm: true });
  return proxyBlogImageUrlsInHtml(applyHtmlAccents(renderResidualMarkdownLinks(String(rawHtml))));
}

async function isReachableUrl(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    const head = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
    });
    if (head.ok) return true;
    if (![405, 501].includes(head.status)) return false;

    const get = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      signal: controller.signal,
      cache: 'no-store',
    });
    return get.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function removeUnreachableBlogAssetImages(html: string): Promise<string> {
  const urls = [...new Set(html.match(SUPABASE_BLOG_ASSET_RE) ?? [])];
  if (urls.length === 0) return html;

  const checks = await Promise.all(urls.map(async (url) => ({
    url,
    ok: await isReachableUrl(url),
  })));
  const brokenUrls = checks.filter((check) => !check.ok).map((check) => check.url);
  if (brokenUrls.length === 0) return html;

  let result = html;
  for (const url of brokenUrls) {
    const src = escapeRegExp(url);
    result = result.replace(
      new RegExp(`<p>\\s*<img\\b[^>]*\\bsrc=["']${src}["'][^>]*>\\s*<\\/p>\\s*(?:<figcaption[\\s\\S]*?<\\/figcaption>\\s*)?`, 'gi'),
      '',
    );
    result = result.replace(
      new RegExp(`<img\\b[^>]*\\bsrc=["']${src}["'][^>]*>\\s*(?:<figcaption[\\s\\S]*?<\\/figcaption>\\s*)?`, 'gi'),
      '',
    );
  }

  return result.replace(/<p>\s*<\/p>/g, '').replace(/\n{4,}/g, '\n\n\n');
}

export function inspectRenderedBlogIntegrity(
  sourceMarkdown: string,
  renderedHtml: string,
): RenderedBlogIntegrityReport {
  const markdownImageCount = countMatches(sourceMarkdown, MARKDOWN_IMAGE_RE);
  const renderedImageCount = countMatches(renderedHtml, RENDERED_IMAGE_RE);
  const markdownHeadingCount = countMatches(sourceMarkdown, MARKDOWN_HEADING_RE);
  const renderedHeadingCount = countMatches(renderedHtml, RENDERED_HEADING_RE);
  const renderedText = stripHtmlForArtifactScan(renderedHtml);
  const artifacts: string[] = [];

  if (/!\[[^\]]*]\([^)]+\)/.test(renderedText)) artifacts.push('literal_markdown_image');
  if (/(^|\s)#{1,6}\s+\S/.test(renderedText)) artifacts.push('literal_markdown_heading');
  if (/\[[^\]]+]\((?:https?:\/\/|\/)[^)]+\)/.test(renderedText)) artifacts.push('literal_markdown_link');
  if (/\*\*[^*]+?\*\*/.test(renderedText)) artifacts.push('literal_markdown_bold');
  if (/~~[^~]+?~~/.test(renderedText) || /<(del|s|strike)\b/i.test(renderedHtml)) artifacts.push('literal_markdown_strike');
  if (/(^|\s)\|?---+\|/.test(renderedText)) artifacts.push('literal_markdown_table_separator');
  if (markdownImageCount > 0 && renderedImageCount < markdownImageCount) artifacts.push('missing_rendered_images');
  if (markdownHeadingCount >= 2 && renderedHeadingCount < Math.min(markdownHeadingCount, 2)) {
    artifacts.push('missing_rendered_headings');
  }

  return {
    passed: artifacts.length === 0,
    reason: artifacts.length > 0 ? `렌더 결과에 마크다운 잔여물 감지: ${artifacts.join(', ')}` : undefined,
    evidence: {
      markdownImageCount,
      renderedImageCount,
      markdownHeadingCount,
      renderedHeadingCount,
      artifactCount: artifacts.length,
      artifacts,
    },
  };
}
