import { createHash } from 'node:crypto';

type PriceDateLike = {
  date?: unknown;
};

export type SourceTicketingConditionStatus =
  | 'open'
  | 'expired'
  | 'conditional'
  | 'conflicting';

export type SourceTicketingCondition = {
  kind: 'fixed_deadline' | 'relative_condition' | 'multiple_deadlines';
  status: SourceTicketingConditionStatus;
  deadline: string | null;
  relativeDays: number | null;
  customerNotice: string;
  consultationOnly: boolean;
  marketingEligible: boolean;
  sourceText: string;
  conditionHash: string;
  evidence: {
    line_start: number;
    line_end: number;
    char_start: number;
    char_end: number;
    quote: string;
    extraction_method: 'text_line';
  };
};

type SourceLine = {
  number: number;
  start: number;
  end: number;
  text: string;
};

type DateCandidate = {
  year: number | null;
  month: number;
  day: number;
  distanceFromTicketingWord: number;
  line: SourceLine;
};

function isValidIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidIsoDate(iso) ? iso : null;
}

function kstToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function yearFromToday(today?: string | null): number | null {
  const year = Number(String(today ?? '').match(/^(\d{4})-/)?.[1]);
  return Number.isInteger(year) && year >= 2000 ? year : null;
}

function sourceLines(rawText: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let offset = 0;
  rawText.split(/\r?\n/).forEach((line, index) => {
    const start = offset;
    const end = start + line.length;
    lines.push({ number: index + 1, start, end, text: line });
    offset = end + 1;
  });
  return lines;
}

function departureDates(priceDates: unknown): string[] {
  if (!Array.isArray(priceDates)) return [];
  return [...new Set((priceDates as PriceDateLike[])
    .map(row => typeof row?.date === 'string' ? row.date.slice(0, 10) : '')
    .filter(isValidIsoDate))].sort();
}

export function inferTicketingDeadlineYear(input: {
  priceDates?: unknown;
  yearHint?: number | null;
  today?: string | null;
  month?: number | null;
  day?: number | null;
}): number {
  const dates = departureDates(input.priceDates);
  const referenceDate = typeof input.today === 'string' && isValidIsoDate(input.today)
    ? input.today
    : null;
  // Supplier sheets often retain departures that have already passed. A
  // deadline can be later than those stale rows while still belonging to the
  // same year as the next sellable departure. Prefer the first departure on
  // or after the operational reference date; use historical rows only when
  // there is no active/future departure evidence.
  const firstDeparture = (
    referenceDate ? dates.find(date => date >= referenceDate) : null
  ) ?? dates[0] ?? null;
  if (firstDeparture) {
    const departureYear = Number(firstDeparture.slice(0, 4));
    const candidate = input.month && input.day
      ? toIsoDate(departureYear, input.month, input.day)
      : null;
    // A December ticketing deadline for a January departure belongs to the
    // previous year. A ticketing deadline must never be moved after the
    // departure merely to make it look current.
    if (candidate && candidate > firstDeparture) return departureYear - 1;
    return departureYear;
  }

  if (typeof input.yearHint === 'number' && Number.isInteger(input.yearHint) && input.yearHint >= 2000) {
    return input.yearHint;
  }
  return yearFromToday(input.today) ?? yearFromToday(kstToday()) ?? new Date().getFullYear();
}

function dateCandidates(line: SourceLine, options: {
  priceDates?: unknown;
  yearHint?: number | null;
  today?: string | null;
}): Array<DateCandidate & { iso: string }> {
  const normalized = line.text.normalize('NFKC');
  const ticketingIndexes = [...normalized.matchAll(/발권/gu)].map(match => match.index ?? 0);
  if (ticketingIndexes.length === 0) return [];
  const candidates: DateCandidate[] = [];
  const datePattern = /(?:(20\d{2})\s*[년./-]\s*)?(\d{1,2})\s*(?:월|[./-])\s*(\d{1,2})(?:\s*일)?/gu;
  for (const match of normalized.matchAll(datePattern)) {
    const dateIndex = match.index ?? 0;
    const distanceFromTicketingWord = Math.min(...ticketingIndexes.map(index => Math.abs(index - dateIndex)));
    if (distanceFromTicketingWord > 60) continue;
    candidates.push({
      year: match[1] ? Number(match[1]) : null,
      month: Number(match[2]),
      day: Number(match[3]),
      distanceFromTicketingWord,
      line,
    });
  }
  if (candidates.length === 0) return [];
  const nearestDistance = Math.min(...candidates.map(candidate => candidate.distanceFromTicketingWord));
  return candidates
    .filter(candidate => candidate.distanceFromTicketingWord === nearestDistance)
    .map(candidate => {
      const year = candidate.year ?? inferTicketingDeadlineYear({
        ...options,
        month: candidate.month,
        day: candidate.day,
      });
      const iso = toIsoDate(year, candidate.month, candidate.day);
      return iso ? { ...candidate, iso } : null;
    })
    .filter((candidate): candidate is DateCandidate & { iso: string } => Boolean(candidate));
}

function evidenceFromLine(line: SourceLine): SourceTicketingCondition['evidence'] {
  return {
    line_start: line.number,
    line_end: line.number,
    char_start: line.start,
    char_end: line.end,
    quote: line.text.trim(),
    extraction_method: 'text_line',
  };
}

function conditionHash(value: Omit<SourceTicketingCondition, 'conditionHash'>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildCondition(value: Omit<SourceTicketingCondition, 'conditionHash'>): SourceTicketingCondition {
  return { ...value, conditionHash: conditionHash(value) };
}

export function extractSourceTicketingCondition(rawText: string | null | undefined, options: {
  priceDates?: unknown;
  yearHint?: number | null;
  today?: string | null;
} = {}): SourceTicketingCondition | null {
  const text = String(rawText ?? '');
  if (!/발권/u.test(text)) return null;
  const today = options.today && isValidIsoDate(options.today) ? options.today : kstToday();
  const lines = sourceLines(text);
  const fixedCandidates = lines.flatMap(line => dateCandidates(line, { ...options, today }));
  const uniqueFixed = [...new Map(fixedCandidates.map(candidate => [candidate.iso, candidate])).values()]
    .sort((left, right) => left.iso.localeCompare(right.iso));

  if (uniqueFixed.length === 1) {
    const candidate = uniqueFixed[0]!;
    const expired = candidate.iso < today;
    const value: Omit<SourceTicketingCondition, 'conditionHash'> = {
      kind: 'fixed_deadline',
      status: expired ? 'expired' : 'open',
      deadline: candidate.iso,
      relativeDays: null,
      customerNotice: expired
        ? '발권기한 경과 · 현재 좌석과 요금 상담 확인'
        : `${candidate.iso.replace(/-/g, '.')}까지 발권 조건`,
      consultationOnly: expired,
      marketingEligible: !expired,
      sourceText: candidate.line.text.trim(),
      evidence: evidenceFromLine(candidate.line),
    };
    return buildCondition(value);
  }

  if (uniqueFixed.length > 1) {
    const first = uniqueFixed[0]!;
    const value: Omit<SourceTicketingCondition, 'conditionHash'> = {
      kind: 'multiple_deadlines',
      status: 'conflicting',
      deadline: null,
      relativeDays: null,
      customerNotice: '출발일별 발권기한이 다를 수 있어 상담 시 최종 확인',
      consultationOnly: true,
      marketingEligible: false,
      sourceText: uniqueFixed.map(candidate => candidate.line.text.trim()).join('\n'),
      evidence: evidenceFromLine(first.line),
    };
    return buildCondition(value);
  }

  const relativeLine = lines.find(line => /(?:출발\s*)?\d{1,2}\s*일\s*(?:전(?:까지)?|이내|내)\s*발권|발권\s*(?:조건)?\s*\d{1,2}\s*일\s*(?:전|이내|내)/u.test(line.text.normalize('NFKC')));
  if (!relativeLine) return null;
  const relativeDays = Number(relativeLine.text.normalize('NFKC').match(/(\d{1,2})\s*일/u)?.[1] ?? NaN);
  const safeDays = Number.isInteger(relativeDays) && relativeDays >= 0 && relativeDays <= 90 ? relativeDays : null;
  const value: Omit<SourceTicketingCondition, 'conditionHash'> = {
    kind: 'relative_condition',
    status: 'conditional',
    deadline: null,
    relativeDays: safeDays,
    customerNotice: safeDays == null ? '발권 조건은 상담 시 최종 확인' : `${safeDays}일 이내 발권 조건`,
    consultationOnly: false,
    marketingEligible: true,
    sourceText: relativeLine.text.trim(),
    evidence: evidenceFromLine(relativeLine),
  };
  return buildCondition(value);
}

export function extractSourceTicketingDeadline(rawText: string | null | undefined, options: {
  priceDates?: unknown;
  yearHint?: number | null;
  today?: string | null;
} = {}): string | null {
  return extractSourceTicketingCondition(rawText, options)?.deadline ?? null;
}
