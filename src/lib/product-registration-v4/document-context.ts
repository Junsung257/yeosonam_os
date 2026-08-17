export type SharedDocumentContextKind =
  | 'inclusions'
  | 'exclusions'
  | 'cancellation'
  | 'booking_notice';

export type SharedDocumentContextBlock = {
  kind: SharedDocumentContextKind;
  text: string;
  start: number;
  end: number;
};

// Keep Korean tokens as Unicode escapes so Windows, Linux and Vercel parse the
// exact same source bytes even when a supplier filename or shell locale is not UTF-8.
const HEADING_PATTERNS: Array<{ kind: SharedDocumentContextKind; pattern: RegExp }> = [
  { kind: 'inclusions', pattern: /^\s*(?:\uD3EC\s*\uD568\s*(?:\uC0AC\uD56D|\uB0B4\uC6A9|\uB0B4\uC5ED)?|INCLUSIONS?)\s*(?:[:\uFF1A]\s*.+)?\s*$/iu },
  { kind: 'exclusions', pattern: /^\s*(?:(?:\uBD88\s*\uD3EC\s*\uD568|\uC81C\uC678)\s*(?:\uC0AC\uD56D|\uB0B4\uC6A9|\uB0B4\uC5ED)?|EXCLUSIONS?)\s*(?:[:\uFF1A]\s*.+)?\s*$/iu },
  { kind: 'cancellation', pattern: /^\s*(?:(?:\uCDE8\uC18C(?:\s*(?:\uBC0F|\/)?\s*\uD658\uBD88)?|\uD658\uBD88)\s*(?:\uADDC\uC815|\uC870\uAC74|\uC548\uB0B4|\uB8CC)?|CANCELLATION(?:\s*POLICY)?)\s*[:\uFF1A]?\s*$/iu },
  { kind: 'booking_notice', pattern: /^\s*(?:\uC608\uC57D\s*(?:\uC548\uB0B4|\uC2DC\s*\uC720\uC758\uC0AC\uD56D)|\uC911\uC694\s*\uC548\uB0B4|IMPORTANT\s*NOTICE)\s*[:\uFF1A]?\s*$/iu },
];

function headingKind(line: string): SharedDocumentContextKind | null {
  return HEADING_PATTERNS.find(item => item.pattern.test(line))?.kind ?? null;
}

function lineRanges(text: string): Array<{ text: string; start: number; end: number }> {
  const ranges: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (const line of text.split('\n')) {
    const end = start + line.length;
    ranges.push({ text: line, start, end });
    start = end + 1;
  }
  return ranges;
}

function lastItineraryOffset(text: string): number {
  const expression = /(?:^|\n)\s*(?:DAY\s*\d+|\uC81C\s*\d+\s*\uC77C|\d+\s*\uC77C\s*\uCC28)(?=\s|[:\uFF1A]|$)/giu;
  let last = -1;
  for (const match of text.matchAll(expression)) last = Math.max(last, match.index ?? -1);
  return last;
}

/**
 * Finds document-level commercial blocks that appear once after the final
 * itinerary. A repeated heading is deliberately not inherited because it is
 * likely product-specific. This is the fail-closed bridge between a supplier
 * catalog layout and per-product canonical revisions.
 */
export function inferSharedDocumentContext(text: string): SharedDocumentContextBlock[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = lineRanges(normalized);
  const headings = lines
    .map((line, lineIndex) => ({ ...line, lineIndex, kind: headingKind(line.text) }))
    .filter((line): line is typeof line & { kind: SharedDocumentContextKind } => Boolean(line.kind));
  if (headings.length === 0) return [];

  const occurrenceCounts = headings.reduce<Record<SharedDocumentContextKind, number>>((counts, heading) => {
    counts[heading.kind] += 1;
    return counts;
  }, { inclusions: 0, exclusions: 0, cancellation: 0, booking_notice: 0 });
  const itineraryEnd = lastItineraryOffset(normalized);
  const hasCommercialPair = occurrenceCounts.inclusions === 1 && occurrenceCounts.exclusions === 1;

  return headings.flatMap((heading, index) => {
    if (occurrenceCounts[heading.kind] !== 1) return [];
    if (heading.start < itineraryEnd) return [];
    if ((heading.kind === 'inclusions' || heading.kind === 'exclusions') && !hasCommercialPair) return [];
    const next = headings[index + 1];
    const end = next?.start ?? normalized.length;
    const blockText = normalized.slice(heading.start, end).trim();
    const firstLineBody = heading.text.split(/[:\uFF1A]/u).slice(1).join(':').trim();
    const body = [firstLineBody, ...blockText.split('\n').slice(1)].join(' ').trim();
    if (body.length < 2 || blockText.length > 12_000) return [];
    return [{ kind: heading.kind, text: blockText, start: heading.start, end }];
  });
}

export function attachSharedDocumentContext(section: string, blocks: SharedDocumentContextBlock[]): string {
  const missing = blocks.filter(block => !section.includes(block.text));
  if (missing.length === 0) return section.trim();
  return `${section.trim()}\n\n--- \uACF5\uD1B5 \uBB38\uC11C \uC870\uAC74 ---\n\n${missing.map(block => block.text).join('\n\n')}`.trim();
}
