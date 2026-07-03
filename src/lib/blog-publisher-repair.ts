import { inspectBlogSlugQuality } from './blog-slug-quality';
import { checkHook } from './blog-quality-gate';
import { romanize, slugifyTopic } from './slug-utils';

export interface PublisherRepairQueueItem {
  id?: string | null;
  topic?: string | null;
  destination?: string | null;
  category?: string | null;
  slug_hint?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface PublisherSlugRepairResult {
  slug: string;
  changed: boolean;
  reason: string | null;
}

const MONTH_SLUGS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

const DESTINATION_TERM_SLUGS: Array<[RegExp, string]> = [
  [/\uD638\uC8FC/i, 'australia'],
  [/\uC2DC\uB4DC\uB2C8/i, 'sydney'],
  [/\uB098\uD2B8\uB791/i, 'nhatrang'],
  [/\uB2EC\uB78F/i, 'dalat'],
  [/\uBC1C\uB9AC/i, 'bali'],
  [/\uAD0C/i, 'guam'],
  [/\uB9C8\uB2D0\uB77C/i, 'manila'],
  [/\uB2E4\uB0AD/i, 'danang'],
  [/\uC624\uC0AC\uCE74/i, 'osaka'],
  [/\uB3C4\uCFC4/i, 'tokyo'],
  [/\uC11C\uC548/i, 'xian'],
  [/\uAD11\uC800\uC6B0/i, 'guangzhou'],
];

const INTENT_TERM_SLUGS: Array<[RegExp, string[]]> = [
  [/(weather|\uB0A0\uC528|\uC637\uCC28\uB9BC|\uAE30\uC628|\uC6B0\uAE30|\uAC74\uAE30)/i, ['weather']],
  [/(family|\uAC00\uC871|\uC544\uC774|\uC790\uB140|\uC5EC\uB984\uBC29\uD559)/i, ['family']],
  [/(summer|\uC5EC\uB984\uBC29\uD559)/i, ['summer', 'vacation']],
  [/(safe|\uC548\uC804|\uD734\uC591\uC9C0)/i, ['safe', 'resort']],
  [/(recommend|best|\uCD94\uCC9C|\uBCA0\uC2A4\uD2B8|\uC21C\uC704)/i, ['recommendation']],
  [/(budget|cost|price|\uC608\uC0B0|\uACBD\uBE44|\uBE44\uC6A9|\uAC00\uACA9)/i, ['budget']],
  [/(checklist|packing|preparation|\uCCB4\uD06C\uB9AC\uC2A4\uD2B8|\uC900\uBE44\uBB3C|\uC900\uBE44)/i, ['checklist']],
  [/(transport|transfer|airport|\uAD50\uD1B5|\uC774\uB3D9|\uACF5\uD56D)/i, ['transport']],
  [/(itinerary|course|route|\uC77C\uC815|\uCF54\uC2A4|\uB3D9\uC120)/i, ['itinerary']],
  [/(visa|passport|\uBE44\uC790|\uC785\uAD6D|\uC5EC\uAD8C|\uC11C\uB958)/i, ['entry']],
];

function uniqueParts(parts: string[]): string[] {
  const seen = new Set<string>();
  return parts
    .map((part) => part.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter((part) => part.length >= 2)
    .filter((part) => {
      if (seen.has(part)) return false;
      seen.add(part);
      return true;
    });
}

function destinationParts(item: PublisherRepairQueueItem, haystack: string): string[] {
  const rawDestination = item.destination?.trim();
  const romanized = rawDestination ? romanize(rawDestination) : '';
  const parts = romanized ? romanized.split('-') : [];

  for (const [pattern, slug] of DESTINATION_TERM_SLUGS) {
    if (pattern.test(`${rawDestination || ''} ${haystack}`)) {
      parts.push(...slug.split('-'));
    }
  }

  return uniqueParts(parts);
}

function temporalParts(haystack: string): string[] {
  const parts: string[] = [];
  const month = haystack.match(/(?:^|[^\d])([1-9]|1[0-2])\s*\uC6D4/);
  if (month?.[1]) {
    parts.push(MONTH_SLUGS[Number(month[1]) - 1]);
  }
  const year = haystack.match(/\b(20[2-9]\d)\b/);
  if (year?.[1]) {
    parts.push(year[1]);
  }
  return parts;
}

function intentParts(haystack: string): string[] {
  const parts: string[] = [];
  for (const [pattern, slugs] of INTENT_TERM_SLUGS) {
    if (pattern.test(haystack)) parts.push(...slugs);
  }
  if (parts.length === 0 && /travel|\uC5EC\uD589/i.test(haystack)) {
    parts.push('travel', 'tips');
  }
  return uniqueParts(parts);
}

function isPublishableAsciiSlug(slug: string): boolean {
  return /^[a-z][a-z0-9-]{7,89}$/.test(slug)
    && slug.includes('-')
    && !slug.endsWith('-')
    && !/^(?:post|draft|test|guide|travel-guide)(?:-|$)/.test(slug)
    && !/(?:^|-)q[0-9a-f]{6,10}$/i.test(slug)
    && !/-[0-9a-f]{6,10}$/i.test(slug);
}

function compactSlug(parts: string[]): string {
  const slug = uniqueParts(parts).join('-').replace(/-+/g, '-').slice(0, 90).replace(/-+$/g, '');
  return slug;
}

function fallbackTopicSlug(haystack: string): string {
  const raw = slugifyTopic(haystack);
  const topicSlug = raw.replace(/^(?:\d+[a-z]*-*)+/, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (isPublishableAsciiSlug(topicSlug)) return topicSlug;

  const safeSeed = haystack
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return isPublishableAsciiSlug(safeSeed) ? safeSeed : 'reader-travel-decision-guide';
}

export function repairPublisherSeoSlug(input: {
  currentSlug?: string | null;
  item: PublisherRepairQueueItem;
  primaryKeyword?: string | null;
}): PublisherSlugRepairResult {
  const currentSlug = input.currentSlug?.trim().toLowerCase() || '';
  const currentQuality = inspectBlogSlugQuality({
    slug: currentSlug,
    primaryKeyword: input.primaryKeyword,
    destination: input.item.destination,
  });
  if (currentQuality.passed && isPublishableAsciiSlug(currentSlug)) {
    return { slug: currentSlug, changed: false, reason: null };
  }

  const expected = typeof input.item.meta?.expected_slug === 'string'
    ? input.item.meta.expected_slug
    : typeof input.item.meta?.spun_slug === 'string'
      ? input.item.meta.spun_slug
      : input.item.slug_hint;
  const haystack = [
    input.item.destination,
    input.primaryKeyword,
    input.item.topic,
    input.item.category,
    expected,
  ].filter(Boolean).join(' ');

  const destination = destinationParts(input.item, haystack);
  const intents = intentParts(haystack);
  const temporal = temporalParts(haystack);
  const topicFallback = fallbackTopicSlug(haystack);

  const candidates = [
    compactSlug([...destination, ...intents, ...temporal]),
    compactSlug([...destination, ...temporal, ...intents]),
    topicFallback,
  ].filter(Boolean);

  const slug = candidates.find(isPublishableAsciiSlug) || 'reader-travel-decision-guide';
  return {
    slug,
    changed: slug !== currentSlug,
    reason: currentQuality.issues.map((issue) => issue.code).join(', ') || 'slug_quality_repair',
  };
}

function firstContentParagraphRange(lines: string[], startIndex: number): { start: number; end: number } | null {
  let start = startIndex;
  while (start < lines.length) {
    const trimmed = lines[start].trim();
    if (!trimmed || /^!\[[^\]]*]\([^)]+\)/.test(trimmed)) {
      start += 1;
      continue;
    }
    break;
  }
  if (start >= lines.length || /^#{1,6}\s+/.test(lines[start].trim()) || /^\|/.test(lines[start].trim())) {
    return null;
  }

  let end = start;
  while (end < lines.length) {
    const trimmed = lines[end].trim();
    if (!trimmed || /^#{1,6}\s+/.test(trimmed) || /^!\[[^\]]*]\([^)]+\)/.test(trimmed) || /^\|/.test(trimmed)) {
      break;
    }
    end += 1;
  }

  return end > start ? { start, end } : null;
}

export function strengthenPublisherIntroHook(
  markdown: string,
  item: PublisherRepairQueueItem,
  primaryKeyword?: string | null,
  now = new Date(),
): string {
  if (checkHook(markdown).passed) return markdown;

  const lines = markdown.split('\n');
  let h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  const keyword = primaryKeyword || item.destination || item.topic || '\uC774\uBC88 \uC5EC\uD589';
  if (h1Index < 0) {
    lines.unshift(`# ${keyword}`, '');
    h1Index = 0;
  }

  const hook = `${now.getFullYear()}\uB144 ${now.getMonth() + 1}\uC6D4 \uAE30\uC900, ${keyword}\uC740 \uBA3C\uC800 \uBB34\uC5C7\uC744 \uBE44\uAD50\uD574\uC57C \uD560\uAE4C\uC694? \uBE44\uC6A9, \uC774\uB3D9 \uC2DC\uAC04, \uB0A0\uC528 \uBCC0\uC218\uB97C \uBA3C\uC800 \uBD10\uC57C \uD604\uC9C0\uC5D0\uC11C 1~2\uC2DC\uAC04\uC744 \uC544\uB07C\uACE0 \uC608\uC0B0 \uC624\uCC28\uB97C \uC904\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4.`;
  const range = firstContentParagraphRange(lines, h1Index + 1);
  if (range) {
    const firstParagraph = lines.slice(range.start, range.end).join(' ');
    const firstPlain = firstParagraph.replace(/[#*_`[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (firstPlain.length < 260 && !/[?]/.test(firstPlain)) {
      lines.splice(range.start, range.end - range.start, hook);
    } else {
      lines.splice(range.start, 0, hook, '');
    }
  } else {
    lines.splice(h1Index + 1, 0, '', hook);
  }

  const repaired = lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
  return checkHook(repaired).passed ? repaired : `${lines.slice(0, h1Index + 1).join('\n')}\n\n${hook}\n\n${lines.slice(h1Index + 1).join('\n')}`;
}
