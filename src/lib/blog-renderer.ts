import { applyHtmlAccents, applyMarkdownAccents } from '@/lib/blog-accent';
import { proxyBlogImageUrlsInHtml } from '@/lib/blog-image-proxy';
import { ensureRequiredBlogDecisionBlocksHtml } from '@/lib/blog-required-structure';

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
    markdownTableRowCount: number;
    renderedTableCount: number;
    artifactCount: number;
    artifacts: string[];
    artifactSamples?: string[];
  };
}

export interface BlogAssetReachabilityOptions {
  validateRemote?: boolean;
  timeoutMs?: number;
  maxUrls?: number;
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
const MARKDOWN_TABLE_ROW_RE = /(^|\n)\s{0,3}\|.+\|\s*(?=\n|$)/g;
const LONG_PLAIN_PARAGRAPH_RE = /<p\b[^>]*>([^<]{520,})<\/p>/g;
const RENDERED_IMAGE_RE = /<img\b/gi;
const RENDERED_HEADING_RE = /<h[2-4]\b/gi;
const RENDERED_TABLE_RE = /<table\b/gi;
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
  if (!/^#{1,6}\s+\S/.test(line)) return line;

  const faqQuestionSplit = line.match(/^(#{1,6}\s+자주\s*묻는\s*질문)\s+(Q\d+[.)]?\s+.+)$/i);
  if (faqQuestionSplit) {
    return `${faqQuestionSplit[1].trim()}\n\n### ${faqQuestionSplit[2].trim()}`;
  }

  const numberedSectionSplit = line.match(/^(#{1,6}\s+[^#\n]{4,60}?)\s+(\d+\.\s+\S.+)$/);
  if (numberedSectionSplit) {
    return `${numberedSectionSplit[1].trim()}\n\n${numberedSectionSplit[2].trim()}`;
  }

  if (line.length < 80) return line;

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
      return line
        .replace(/\s+-\s+(?=\S)/g, '\n- ')
        .replace(/\s+(\d+\.\s+\S)/g, '\n$1')
        .replace(/\s+체크리스트\s+-\s+/g, '\n\n### 체크리스트\n- ');
    })
    .join('\n');
}

function removeDuplicateCoreHeadings(source: string): string {
  const seen = new Set<string>();
  return source
    .split('\n')
    .filter((line) => {
      const match = line.trim().match(/^#{2,3}\s+(핵심\s*요약|자주\s*묻는\s*질문|FAQ|Q&A)\s*$/i);
      if (!match) return true;
      const key = match[1].replace(/\s+/g, ' ').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
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

function isMarkdownTableRowLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && countPipes(trimmed) >= 2;
}

function isMarkdownTableSeparatorLine(line: string): boolean {
  return /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?$/.test(line.trim());
}

function tableSeparatorFor(row: string): string {
  const cellCount = row.split('|').filter((cell) => cell.trim().length > 0).length;
  return `|${Array.from({ length: Math.max(2, cellCount) }, () => '---').join('|')}|`;
}

function normalizeLooseMarkdownTables(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!isMarkdownTableRowLine(lines[index])) {
      out.push(lines[index]);
      index += 1;
      continue;
    }

    const block: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      const next = lines[index + 1] ?? '';
      if (isMarkdownTableRowLine(current)) {
        block.push(current.trim());
        index += 1;
        continue;
      }
      if (current.trim() === '' && isMarkdownTableRowLine(next)) {
        index += 1;
        continue;
      }
      break;
    }

    if (block.length >= 2 && !isMarkdownTableSeparatorLine(block[1])) {
      out.push(block[0], tableSeparatorFor(block[0]), ...block.slice(1));
    } else {
      out.push(...block);
    }
  }

  return out.join('\n');
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
  out = out.replace(/!\[([^\]]*)]\(\s+([^)]+?)\s+\)/g, '![$1]($2)');

  // Recover collapsed GFM tables where a heading and the first table row share a line,
  // or multiple table rows were squeezed together as "||".
  out = out.replace(/(^|\n)(#{2,6}\s+[^\n|]{1,100})\|/g, '$1$2\n\n|');
  out = normalizeCollapsedTableRows(out);
  out = out.replace(/(^|\n)(\|[^\n]+\|\n\|?\s*:?-{2,}:?[^\n]*\|)/g, '$1\n$2');
  out = out.replace(/(\|[^\n]+\|)\n(?=#{2,6}\s+\S)/g, '$1\n\n');
  out = out.replace(/(\|[^\n]+\|)(?=#{2,6}\s+\S)/g, '$1\n\n');
  out = out.replace(/(^|\n)(#{2,6}\s+[^\n|]{1,100})\|/g, '$1$2\n\n|');
  out = normalizeCollapsedTableRows(out);
  out = normalizeLooseMarkdownTables(out);
  out = out.replace(/\n\|[^|\n]+(?:\|[^|\n]+)+\|\n\|---(?:\|---)+\|\n(?!\|)/g, '\n');
  out = normalizeCollapsedBulletLines(out);
  out = out
    .split('\n')
    .map(normalizeLongHeadingLine)
    .map((line) => line.replace(/\s+---\s*$/, '\n\n---'))
    .join('\n');
  out = removeDuplicateCoreHeadings(out);

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
  return html.replace(/\[([\s\S]*?)]\(((?:https?:\/\/|\/)[^)]+)\)/g, (_match, label: string, href: string) => {
    const cleanLabel = label.replace(/\s+/g, ' ').trim();
    const safeHref = href.replace(/"/g, '&quot;');
    return `<a href="${safeHref}">${cleanLabel}</a>`;
  });
}

function renderResidualMarkdownImages(html: string): string {
  return html
    .replace(
      /!\[([^\]]*)]\(\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>\s*\)/gi,
      (_match, alt: string, src: string) => {
        const safeAlt = alt.replace(/"/g, '&quot;').trim();
        const safeSrc = src.replace(/"/g, '&quot;').trim();
        return `<img src="${safeSrc}" alt="${safeAlt}" loading="lazy">`;
      },
    )
    .replace(/!\[([^\]]*)]\(\s*(https?:\/\/[^)\s]+[^)]*?)\s*\)/g, (_match, alt: string, src: string) => {
      const safeAlt = alt.replace(/"/g, '&quot;').trim();
      const safeSrc = src.replace(/"/g, '&quot;').trim();
      return `<img src="${safeSrc}" alt="${safeAlt}" loading="lazy">`;
    });
}

function normalizeAnchorTextWhitespace(html: string): string {
  return html.replace(/(<a\b[^>]*>)([\s\S]*?)(<\/a>)/gi, (_match, open: string, label: string, close: string) => {
    const cleanLabel = label.replace(/\s+/g, ' ').trim();
    return `${open}${cleanLabel}${close}`;
  });
}

function splitPlainTextIntoReadableParagraphs(text: string, maxLength = 420): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return [normalized];

  const sentences = normalized
    .split(/(?<=[.!?。！？])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const source = sentences.length > 1 ? sentences : normalized.split(/(?<=,|，|;|；)\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of source) {
    if (!current) {
      current = sentence;
      continue;
    }
    if ((current + ' ' + sentence).length > maxLength) {
      chunks.push(current);
      current = sentence;
    } else {
      current = `${current} ${sentence}`;
    }
  }
  if (current) chunks.push(current);

  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxLength * 1.25) return [chunk];
    const fallback: string[] = [];
    let rest = chunk;
    while (rest.length > maxLength) {
      const slice = rest.slice(0, maxLength);
      const cut = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf(','));
      const end = cut > 160 ? cut : maxLength;
      fallback.push(rest.slice(0, end).trim());
      rest = rest.slice(end).trim();
    }
    if (rest) fallback.push(rest);
    return fallback;
  });
}

function splitLongPlainHtmlParagraphs(html: string): string {
  return html.replace(LONG_PLAIN_PARAGRAPH_RE, (_match, body) => {
    const parts = splitPlainTextIntoReadableParagraphs(body);
    if (parts.length <= 1) return `<p>${body}</p>`;
    return parts.map((part) => `<p>${part}</p>`).join('\n');
  });
}

function promoteLongNumberedParagraphsToLists(html: string): string {
  return html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (match, body: string) => {
    if (/<(?:p|div|ul|ol|li|table|h[1-6]|blockquote)\b/i.test(body)) return match;

    const textOnly = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (textOnly.length < 520 || !/\s1[.)]\s*\S/.test(` ${textOnly}`)) return match;

    const parts = body
      .split(/\s+(?=\d+[.)]\s*[^<\n:：]{1,60}[:：])/g)
      .map((part) => part.trim())
      .filter(Boolean);
    const numbered = parts.filter((part) => /^\d+[.)]\s*\S/.test(part));
    if (numbered.length < 3) return match;

    const intro = parts[0] && !/^\d+[.)]\s*\S/.test(parts[0]) ? `<p>${parts[0]}</p>\n` : '';
    const listItems = parts
      .filter((part) => /^\d+[.)]\s*\S/.test(part))
      .map((part) => `<li>${part.replace(/^\d+[.)]\s*/, '')}</li>`)
      .join('');

    return `${intro}<ul>${listItems}</ul>`;
  });
}

function unwrapDecorativeStrongParagraphs(html: string): string {
  return html.replace(/<p\b[^>]*>\s*<strong>([\s\S]*?)<\/strong>([\s\S]*?)<\/p>/gi, (match, body: string, tail: string) => {
    const textOnly = `${body} ${tail}`.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/##\s+\S/.test(body) && textOnly.length < 360) return match;
    return `<p>${body}${tail}</p>`;
  });
}

function splitProseLikeRenderedHeadings(html: string): string {
  return html.replace(/<h([2-4])([^>]*)>\s*([^<]+?)\s*<\/h\1>/gi, (match, level: string, attrs: string, rawText: string) => {
    const text = rawText.replace(/\s+/g, ' ').trim();
    if (text.length < 80) return match;

    const questionAnswer = text.match(/^(.{8,100}?[?？])\s+(답부터\s*말하면[,\s].{20,})$/);
    if (questionAnswer) {
      return `<h${level}${attrs}>${questionAnswer[1].trim()}</h${level}>\n<p>${questionAnswer[2].trim()}</p>`;
    }

    const looksLikeBodyCopy =
      /답부터\s*말하면|같이\s*보면|함께\s*확인|도움이\s*됩니다|줄이는\s*데\s*도움/i.test(text) &&
      /[.?!。？！]\s+\S/.test(text);
    if (!looksLikeBodyCopy) return match;

    const sentenceEnd = text.search(/[.?!。？！]\s+/);
    if (sentenceEnd < 16) return `<p>${text}</p>`;

    const heading = text.slice(0, sentenceEnd + 1).trim();
    const rest = text.slice(sentenceEnd + 1).trim();
    if (!rest || heading.length > 100) return `<p>${text}</p>`;
    return `<h${level}${attrs}>${heading}</h${level}>\n<p>${rest}</p>`;
  });
}

function splitInlineMarkdownHeadingsInParagraphs(html: string): string {
  return html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/g, (match, body) => {
    if (!/##\s+\S/.test(body) || /<(?:p|div|ul|ol|li|table|h[1-6]|blockquote)\b/i.test(body)) return match;

    const segments = body.split(/\s*##\s+/);
    const first = segments.shift()?.trim();
    const out: string[] = [];
    if (first) out.push(`<p>${first}</p>`);

    for (const segment of segments) {
      const text = segment.trim();
      if (!text) continue;
      const punctuation = text.slice(0, 140).search(/[.!?。！？]/);
      const headingEnd = punctuation >= 8 ? punctuation + 1 : Math.min(text.length, 80);
      const heading = text.slice(0, headingEnd).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const rest = text.slice(headingEnd).trim();
      if (heading) out.push(`<h2>${heading}</h2>`);
      if (rest) out.push(`<p>${rest}</p>`);
    }

    return out.length > 0 ? out.join('\n') : match;
  });
}

function normalizeRenderedHeadingArtifacts(html: string): string {
  const seenCore = new Set<string>();
  return splitProseLikeRenderedHeadings(unwrapDecorativeStrongParagraphs(html))
    .replace(/<p\b[^>]*>([\s\S]*?##\s+[\s\S]*?)<\/p>/gi, (match) => splitInlineMarkdownHeadingsInParagraphs(match))
    .replace(
      /<h([23])([^>]*)>\s*([^<]*?)\s*<strong>\s*(Q\d+[.:)]?\s*[^<]+?)<\/strong>\s*<\/h\1>/gi,
      (_full, level, attrs, prefix, question) => {
        const heading = String(prefix || '').trim() || 'FAQ';
        return `<h${level}${attrs}>${heading}</h${level}>\n<h3>${String(question).trim()}</h3>`;
      },
    )
    .replace(/<h([23])([^>]*)>\s*([^<]{0,60}?)(Q\d+[.)]?\s+[^<]{20,}?)\s*<\/h\1>/gi, (_full, level, attrs, prefix, qaText) => {
      const heading = String(prefix || '').trim() || 'FAQ';
      const qa = String(qaText || '').trim();
      const answerSplit = qa.match(/^(Q\d+[.)]?\s+.*?)(\s+A\d?[:.]?\s+.*)$/i);
      if (answerSplit) {
        return `<h${level}${attrs}>${heading}</h${level}>\n<h3>${answerSplit[1].trim()}</h3>\n<p>${answerSplit[2].trim()}</p>`;
      }
      return `<h${level}${attrs}>${heading}</h${level}>\n<h3>${qa}</h3>`;
    })
    .replace(
      /<h([23])([^>]*)>\s*(자주\s*묻는\s*질문)\s+(Q\d+[.)]?\s+[^<]+?)\s*<\/h\1>/gi,
      '<h2$2>$3</h2>\n<h3>$4</h3>',
    )
    .replace(
      /<h2([^>]*)>\s*([^<]{4,60}?)\s+(\d+\.\s+[^<]+?)\s*<\/h2>/gi,
      '<h2$1>$2</h2>\n<p>$3</p>',
    )
    .replace(
      /<h([2-4])([^>]*)>\s*(\d+\.\s+[^<.]{8,100}\.)\s+[-*]\s+([^<]{40,}?)\s*<\/h\1>/gi,
      '<h$1$2>$3</h$1>\n<p>$4</p>',
    )
    .replace(
      /<h([2-4])([^>]*)>\s*([^<]{10,100}?)\s+[-*]\s+([^<]{40,}?)\s*<\/h\1>/gi,
      '<h$1$2>$3</h$1>\n<p>$4</p>',
    )
    .replace(
      /<h([23])([^>]*)>\s*([^<]*(?:체크리스트|요약표)[^<]*(?:서류|필수|비고|상의|추천|주의사항|아이템)[^<]*)\s*<\/h\1>/gi,
      '<p>$3</p>',
    )
    .replace(/<h([23])([^>]*)>\s*(핵심\s*요약|자주\s*묻는\s*질문|FAQ|Q&amp;A|Q&A)\s*<\/h\1>/gi, (full, level, attrs, text) => {
      const key = String(text).replace(/\s+/g, ' ').toLowerCase();
      if (seenCore.has(key)) return '';
      seenCore.add(key);
      return `<h${level}${attrs}>${text}</h${level}>`;
    });
}

export async function renderBlogContentToHtml(
  source: string,
  options: RenderBlogContentOptions = {},
): Promise<string> {
  if (!source.trim()) return '';

  if (!shouldParseAsMarkdown(source)) {
    const normalizedHtml = normalizeRenderedHeadingArtifacts(
      normalizeAnchorTextWhitespace(renderResidualMarkdownLinks(renderResidualMarkdownImages(source))),
    );
    const readableHtml = splitLongPlainHtmlParagraphs(promoteLongNumberedParagraphsToLists(normalizedHtml));
    return proxyBlogImageUrlsInHtml(applyHtmlAccents(ensureRequiredBlogDecisionBlocksHtml(readableHtml)));
  }

  const normalizedSource = normalizeStoredBlogMarkdownStructure(source);
  const deDecoratedSource = normalizedSource.replace(/~~([^~]{1,300}?)~~/gs, (_match, inner) => inner.replace(/\s+/g, ' ').trim());
  const markdownSource = options.stripDecorativeBold === false
    ? deDecoratedSource
    : deDecoratedSource.replace(/\*\*([^*]{1,180}?)\*\*/gs, (_m, inner) => inner.replace(/\s+/g, ' ').trim());
  const mdAccented = applyMarkdownAccents(markdownSource);
  const { marked } = await import('marked');
  const rawHtml = await marked.parse(mdAccented, { gfm: true });
  const normalizedHtml = normalizeRenderedHeadingArtifacts(
    normalizeAnchorTextWhitespace(renderResidualMarkdownLinks(renderResidualMarkdownImages(String(rawHtml)))),
  );
  return proxyBlogImageUrlsInHtml(applyHtmlAccents(splitLongPlainHtmlParagraphs(promoteLongNumberedParagraphsToLists(normalizedHtml))));
}

async function isReachableUrl(url: string, timeoutMs = 1200): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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

export async function removeUnreachableBlogAssetImages(
  html: string,
  options: BlogAssetReachabilityOptions = {},
): Promise<string> {
  const shouldValidateRemote = options.validateRemote ?? process.env.BLOG_ASSET_REACHABILITY_CHECKS === '1';
  if (!shouldValidateRemote) return html;

  const urls = [...new Set(html.match(SUPABASE_BLOG_ASSET_RE) ?? [])].slice(0, options.maxUrls ?? 8);
  if (urls.length === 0) return html;

  const checks = await Promise.all(urls.map(async (url) => ({
    url,
    ok: await isReachableUrl(url, options.timeoutMs),
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
  const markdownTableRowCount = countMatches(sourceMarkdown, MARKDOWN_TABLE_ROW_RE);
  const renderedTableCount = countMatches(renderedHtml, RENDERED_TABLE_RE);
  const renderedText = stripHtmlForArtifactScan(renderedHtml);
  const artifacts: string[] = [];
  const artifactSamples: string[] = [];

  const literalImage = renderedText.match(/.{0,40}!\[[^\]]*]\([^)]+\).{0,40}/);
  if (literalImage) {
    artifacts.push('literal_markdown_image');
    artifactSamples.push(literalImage[0]);
  }
  const literalHeading =
    renderedHtml.match(/<p>\s*#{1,6}\s+[^<]+<\/p>/i) ||
    renderedHtml.match(/<[^>]+>\s*#{2,6}\s+[^<]+<\/[^>]+>/i) ||
    renderedText.match(/.{0,40}(?:^|\s)#{2,6}\s+\S.{0,40}/);
  if (literalHeading) {
    artifacts.push('literal_markdown_heading');
    artifactSamples.push(literalHeading[0]);
  }
  const literalLink = renderedText.match(/.{0,40}\[[^\]]+]\((?:https?:\/\/|\/)[^)]+\).{0,40}/);
  if (literalLink) {
    artifacts.push('literal_markdown_link');
    artifactSamples.push(literalLink[0]);
  }
  const literalBold = renderedText.match(/.{0,40}\*\*[^*]+?\*\*.{0,40}/);
  if (literalBold) {
    artifacts.push('literal_markdown_bold');
    artifactSamples.push(literalBold[0]);
  }
  const literalStrike = renderedText.match(/.{0,40}~~[^~]+?~~.{0,40}/);
  if (literalStrike || /<(del|s|strike)\b/i.test(renderedHtml)) {
    artifacts.push('literal_markdown_strike');
    if (literalStrike) artifactSamples.push(literalStrike[0]);
  }
  const literalSeparator = renderedText.match(/.{0,40}(?:^|\s)\|?---+\|.{0,40}/);
  if (literalSeparator) {
    artifacts.push('literal_markdown_table_separator');
    artifactSamples.push(literalSeparator[0]);
  }
  if (markdownImageCount > 0 && renderedImageCount < markdownImageCount) artifacts.push('missing_rendered_images');
  if (markdownHeadingCount >= 2 && renderedHeadingCount < Math.min(markdownHeadingCount, 2)) {
    artifacts.push('missing_rendered_headings');
  }
  if (markdownTableRowCount >= 2 && renderedTableCount === 0) {
    artifacts.push('missing_rendered_table');
  }

  return {
    passed: artifacts.length === 0,
    reason: artifacts.length > 0 ? `렌더 결과에 마크다운 잔여물 감지: ${artifacts.join(', ')}` : undefined,
    evidence: {
      markdownImageCount,
      renderedImageCount,
      markdownHeadingCount,
      renderedHeadingCount,
      markdownTableRowCount,
      renderedTableCount,
      artifactCount: artifacts.length,
      artifacts,
      artifactSamples,
    },
  };
}
