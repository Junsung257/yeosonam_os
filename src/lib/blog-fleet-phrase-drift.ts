import { stripMarkup } from './blog-text-utils';

export type BlogFleetPhraseDriftSeverity = 'warn' | 'block';

export interface BlogFleetPhraseDriftPost {
  id?: string | null;
  slug?: string | null;
  title?: string | null;
  blog_html?: string | null;
  writer_type?: string | null;
}

export interface BlogFleetPhraseDriftIssue {
  code:
    | 'repeated_opening_signature'
    | 'repeated_heading_order'
    | 'repeated_cta_sentence'
    | 'generic_opening_formula';
  severity: BlogFleetPhraseDriftSeverity;
  count: number;
  signature: string;
  samples: Array<{ id: string | null; slug: string | null; title: string | null }>;
}

export interface BlogFleetPhraseDriftReport {
  status: 'pass' | 'warn' | 'block';
  checked_count: number;
  issue_count: number;
  issues: BlogFleetPhraseDriftIssue[];
  summary: string;
  next_action: string;
}

function postLabel(post: BlogFleetPhraseDriftPost) {
  return {
    id: post.id ?? null,
    slug: post.slug ?? null,
    title: post.title ?? null,
  };
}

function cleanText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/!\[[^\]\n]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]\n]+]\([^)]+\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[|*_`>#()[\]{}"'~!@#$%^&+=\\/.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstParagraph(markdown: string): string {
  for (const chunk of markdown.split(/\n{2,}/)) {
    const withoutHeading = chunk
      .replace(/^#{1,6}\s+.*$/gm, ' ')
      .replace(/^\s*\|.*\|\s*$/gm, ' ')
      .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, ' ');
    const plain = cleanText(stripMarkup(withoutHeading));
    if (plain.length >= 35) return plain;
  }
  return '';
}

function normalizeSignature(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, '{year}')
    .replace(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g, '{num}')
    .replace(/\b(?:krw|usd|jpy|vnd|thb|eur)\b/g, '{money}')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110);
}

function openingSignature(markdown: string): string | null {
  const first = firstParagraph(markdown);
  if (first.length < 35) return null;
  return normalizeSignature(first);
}

function headingSignature(markdown: string): string | null {
  const headings = markdown
    .split('\n')
    .map((line) => line.match(/^##\s+(.+?)\s*$/)?.[1])
    .filter((heading): heading is string => Boolean(heading))
    .map(normalizeSignature)
    .filter(Boolean)
    .slice(0, 5);
  return headings.length >= 4 ? headings.join(' > ') : null;
}

function ctaSignature(markdown: string): string | null {
  const linkLabels = [...markdown.matchAll(/\[([^\]\n]+)]\((?:https?:\/\/|\/)[^)]+\)/g)]
    .map((match) => cleanText(match[1] ?? ''))
    .filter((label) =>
      /(상담|문의|상품|패키지|일정|가능 여부|출발일|인원|비교|확인)/.test(label)
      && !/(외교부|IATA|공식|출처|매거진|가이드)/i.test(label)
      && label.length >= 8
      && label.length <= 80
    );
  if (linkLabels.length > 0) {
    return normalizeSignature(linkLabels[linkLabels.length - 1] ?? '');
  }

  const plain = stripMarkup(markdown)
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/!\[[^\]\n]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]\n]+]\([^)]+\)/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  const sentences = plain
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map(cleanText)
    .filter(Boolean);
  const cta = [...sentences].reverse().find((sentence) =>
    /(상담|문의|상품|패키지|일정 기준|가능 여부|출발일|인원)/.test(sentence)
    && sentence.length >= 20
    && sentence.length <= 180
  );
  return cta ? normalizeSignature(cta) : null;
}

function genericOpeningFormula(opening: string): string | null {
  const raw = cleanText(opening);
  if (/여행 전 먼저 볼 것은 예산 범위 이동 순서 현지 확인 사항/.test(raw)) {
    return 'generic:travel-first-budget-movement-local-check';
  }
  if (/가격만 보지 말고 .*출발.*포함.*일정/.test(raw)) {
    return 'generic:price-departure-included-itinerary-check';
  }
  if (/답부터 말하면 .*기준/.test(raw)) {
    return 'generic:answer-first-date-standard';
  }
  const normalized = normalizeSignature(opening);
  const formulas = [
    /먼저 볼 것은 .*예산.*이동.*확인/,
    /가격만 보지 말고 .*출발.*포함.*일정/,
    /기준으로 보면 .*일정.*비용.*이동/,
    /답부터 말하면 .*기준/,
    /여행 전 .*먼저 확인해야/,
  ];
  return formulas.find((pattern) => pattern.test(normalized)) ? normalized : null;
}

function groupedIssues(
  rows: Array<{ post: BlogFleetPhraseDriftPost; signature: string }>,
  code: BlogFleetPhraseDriftIssue['code'],
  severity: BlogFleetPhraseDriftSeverity,
  minCount: number,
): BlogFleetPhraseDriftIssue[] {
  const groups = new Map<string, BlogFleetPhraseDriftPost[]>();
  for (const row of rows) {
    if (!row.signature || row.signature.length < 25) continue;
    const list = groups.get(row.signature) ?? [];
    list.push(row.post);
    groups.set(row.signature, list);
  }
  return [...groups.entries()]
    .filter(([, posts]) => posts.length >= minCount)
    .map(([signature, posts]) => ({
      code,
      severity,
      count: posts.length,
      signature,
      samples: posts.slice(0, 5).map(postLabel),
    }));
}

export function inspectBlogFleetPhraseDrift(posts: BlogFleetPhraseDriftPost[]): BlogFleetPhraseDriftReport {
  const checked = posts.filter((post) => typeof post.blog_html === 'string' && post.blog_html.trim().length > 0);
  const openingRows = checked
    .map((post) => ({ post, signature: openingSignature(post.blog_html ?? '') }))
    .filter((row): row is { post: BlogFleetPhraseDriftPost; signature: string } => Boolean(row.signature));
  const headingRows = checked
    .map((post) => ({ post, signature: headingSignature(post.blog_html ?? '') }))
    .filter((row): row is { post: BlogFleetPhraseDriftPost; signature: string } => Boolean(row.signature));
  const ctaRows = checked
    .map((post) => ({ post, signature: ctaSignature(post.blog_html ?? '') }))
    .filter((row): row is { post: BlogFleetPhraseDriftPost; signature: string } => Boolean(row.signature));
  const genericRows = checked
    .map((post) => ({ post, signature: genericOpeningFormula(firstParagraph(post.blog_html ?? '')) }))
    .filter((row): row is { post: BlogFleetPhraseDriftPost; signature: string } => Boolean(row.signature));

  const issues = [
    ...groupedIssues(openingRows, 'repeated_opening_signature', 'warn', 2),
    ...groupedIssues(headingRows, 'repeated_heading_order', 'warn', 3),
    ...groupedIssues(ctaRows, 'repeated_cta_sentence', 'warn', 3),
    ...groupedIssues(genericRows, 'generic_opening_formula', 'block', 2),
  ];
  const status = issues.some((issue) => issue.severity === 'block') ? 'block' : issues.length > 0 ? 'warn' : 'pass';

  return {
    status,
    checked_count: checked.length,
    issue_count: issues.length,
    issues,
    summary: status === 'pass'
      ? 'Fleet phrase drift clean: recent posts do not share obvious repeated openings, heading orders, or CTA formulas.'
      : `Fleet phrase drift ${status}: ${issues.map((issue) => `${issue.code}:${issue.count}`).join(', ')}`,
    next_action: status === 'pass'
      ? 'Keep rotating reader scenarios and writer openings.'
      : status === 'block'
        ? 'Rewrite or regenerate the repeated opening formula before expanding automatic publishing.'
        : 'Add prompt variation or repair rules for repeated openings, heading order, and CTA wording.',
  };
}
