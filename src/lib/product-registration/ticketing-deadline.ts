type PriceDateLike = {
  date?: unknown;
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

function yearFromToday(today?: string): number | null {
  const year = Number(String(today ?? '').match(/^(\d{4})-/)?.[1]);
  return Number.isInteger(year) && year >= 2000 ? year : null;
}

export function inferTicketingDeadlineYear(input: {
  priceDates?: unknown;
  yearHint?: number | null;
  today?: string | null;
}): number {
  if (typeof input.yearHint === 'number' && Number.isInteger(input.yearHint) && input.yearHint >= 2000) {
    return input.yearHint;
  }

  if (Array.isArray(input.priceDates)) {
    for (const row of input.priceDates as PriceDateLike[]) {
      const year = Number(typeof row?.date === 'string' ? row.date.slice(0, 4) : NaN);
      if (Number.isInteger(year) && year >= 2000) return year;
    }
  }

  return yearFromToday(input.today ?? undefined) ?? new Date().getFullYear();
}

export function extractSourceTicketingDeadline(rawText: string | null | undefined, options: {
  priceDates?: unknown;
  yearHint?: number | null;
  today?: string | null;
} = {}): string | null {
  const text = String(rawText ?? '');
  if (!/발권/.test(text)) return null;

  const year = inferTicketingDeadlineYear(options);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !/발권/.test(line)) continue;

    const explicit = line.match(/(20\d{2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})[^\n]{0,30}발권|발권[^\n]{0,30}(20\d{2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})/);
    if (explicit) {
      const candidate = explicit[1]
        ? toIsoDate(Number(explicit[1]), Number(explicit[2]), Number(explicit[3]))
        : toIsoDate(Number(explicit[4]), Number(explicit[5]), Number(explicit[6]));
      if (candidate) return candidate;
    }

    const korean = line.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일[^\n]{0,30}발권|발권[^\n]{0,30}(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (korean) {
      const candidate = korean[1]
        ? toIsoDate(year, Number(korean[1]), Number(korean[2]))
        : toIsoDate(year, Number(korean[3]), Number(korean[4]));
      if (candidate) return candidate;
    }

    const slash = line.match(/(\d{1,2})\s*[./-]\s*(\d{1,2})(?:\s*\([^)]*\))?\s*(?:까지|이내|까지\s*항공권|이내\s*항공권)?[^\n]{0,30}발권|발권[^\n]{0,30}(\d{1,2})\s*[./-]\s*(\d{1,2})(?:\s*\([^)]*\))?\s*(?:까지|이내)?/);
    if (slash) {
      const candidate = slash[1]
        ? toIsoDate(year, Number(slash[1]), Number(slash[2]))
        : toIsoDate(year, Number(slash[3]), Number(slash[4]));
      if (candidate) return candidate;
    }
  }

  return null;
}
