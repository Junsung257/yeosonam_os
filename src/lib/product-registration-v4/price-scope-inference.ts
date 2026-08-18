import { sha256Hex } from './document-ir';
import type { V3LedgerVariant } from '@/lib/product-registration-v3/types';

type Variant = {
  price_calendar: V3LedgerVariant['price_calendar'];
  evidence_coverage?: { price?: boolean; [key: string]: unknown };
};

type Scope = {
  start: string;
  end: string;
  weekday: number;
  sourceLineIndex: number;
  sourceLine: string;
};

const DOW: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

function iso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthEnd(year: number, month: number): string | null {
  if (!Number.isInteger(year) || year < 2000 || month < 1 || month > 12) return null;
  const date = new Date(Date.UTC(year, month, 0));
  return `${year}-${String(month).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function normalizeLine(line: string): string {
  return line.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function scopeFromLine(line: string, year: number, sourceLineIndex: number): Scope | null {
  const value = normalizeLine(line);
  if (!/(?:출발|출발일|출발기준)/u.test(value)) return null;

  // `4월10일~5월29일 매주 화 출발`, `4/10~5/29 매주 화요일 출발`.
  const explicitRange = value.match(
    /(?:^|[^\d])(?<sm>\d{1,2})\s*(?:월|[./])\s*(?<sd>\d{1,2})\s*일?\s*[~\-–—]\s*(?:(?<em>\d{1,2})\s*(?:월|[./])\s*)?(?<ed>\d{1,2})\s*일?\s*(?:매주\s*)?(?<dow>[일월화수목금토])(?:요일)?\s*(?:출발|출발일|출발기준)/u,
  );
  if (explicitRange?.groups) {
    const start = iso(year, Number(explicitRange.groups.sm), Number(explicitRange.groups.sd));
    const end = iso(
      year,
      Number(explicitRange.groups.em ?? explicitRange.groups.sm),
      Number(explicitRange.groups.ed),
    );
    const weekday = DOW[explicitRange.groups.dow ?? ''];
    if (start && end && start <= end && weekday != null) {
      return { start, end, weekday, sourceLineIndex, sourceLine: value };
    }
  }

  // `5월 일요일 출발`, `5월 매주 일요일 출발`.
  const monthWeekday = value.match(
    /(?:^|[^\d])(?<month>\d{1,2})\s*월\s*(?:매주\s*)?(?<dow>[일월화수목금토])(?:요일)?\s*(?:출발|출발일|출발기준)/u,
  );
  if (monthWeekday?.groups) {
    const month = Number(monthWeekday.groups.month);
    const start = iso(year, month, 1);
    const end = monthEnd(year, month);
    const weekday = DOW[monthWeekday.groups.dow ?? ''];
    if (start && end && weekday != null) {
      return { start, end, weekday, sourceLineIndex, sourceLine: value };
    }
  }

  return null;
}

function sameScope(left: Scope, right: Scope): boolean {
  return left.start === right.start && left.end === right.end && left.weekday === right.weekday;
}

function nearbyScope(lines: string[], entry: V3LedgerVariant['price_calendar'][number], year: number): Scope | null {
  const lineStart = Number(entry.evidence.line_start);
  const anchor = Number.isInteger(lineStart) && lineStart > 0 ? lineStart - 1 : 0;
  const nearby: Scope[] = [];
  for (let offset = -8; offset <= 8; offset += 1) {
    const index = anchor + offset;
    if (index < 0 || index >= lines.length) continue;
    const scope = scopeFromLine(lines[index]!, year, index);
    if (scope && !nearby.some(existing => sameScope(existing, scope))) nearby.push(scope);
  }
  // A table extractor can attach the price evidence to a flattened cell line.
  // If the local window did not contain a scope, use a single unambiguous
  // schedule phrase in the section. Conflicting phrases remain unresolved.
  if (nearby.length === 0) {
    lines.forEach((line, index) => {
      const scope = scopeFromLine(line, year, index);
      if (scope && !nearby.some(existing => sameScope(existing, scope))) nearby.push(scope);
    });
  }
  return nearby.length === 1 ? nearby[0]! : null;
}

/**
 * Connects an undated selling price to a unique, nearby source schedule.
 *
 * This is intentionally narrow: it only accepts an explicit month/weekday
 * departure rule, requires one unambiguous scope, and never fills a deposit,
 * surcharge, option, or passenger-specific row. The original price evidence
 * and the schedule evidence are both retained in the resulting quote.
 */
export function inferUndatedPriceScopesFromSchedule(input: {
  rawText: string;
  variants: Variant[];
  year: number | null | undefined;
}): { applied: number; ambiguous: number } {
  if (!Number.isInteger(input.year) || Number(input.year) < 2000) return { applied: 0, ambiguous: 0 };
  const lines = input.rawText.split(/\r?\n/u);
  let applied = 0;
  let ambiguous = 0;
  const forbidden = /(?:예약금|계약금|deposit|커미션|commission|수수료|유류할증|현지비|가이드비|선택관광|옵션)/iu;

  for (const variant of input.variants) {
    for (const entry of variant.price_calendar) {
      if (entry.date || entry.date_range?.start || entry.weekday != null) continue;
      if (!Number.isFinite(entry.amount) || Number(entry.amount) <= 0) continue;
      const originalQuote = String(entry.evidence.quote ?? entry.label ?? '');
      if (forbidden.test(originalQuote)) continue;
      const scope = nearbyScope(lines, entry, Number(input.year));
      if (!scope) {
        const hasAnySchedule = lines.some(line => scopeFromLine(line, Number(input.year), 0));
        if (hasAnySchedule) ambiguous += 1;
        continue;
      }
      const scopeQuote = scope.sourceLine;
      const combinedQuote = [originalQuote, scopeQuote]
        .filter(Boolean)
        .filter((quote, index, all) => all.indexOf(quote) === index)
        .join(' | ');
      entry.date = null;
      entry.date_range = { start: scope.start, end: scope.end };
      entry.weekday = scope.weekday;
      entry.label = `${entry.label ?? `${entry.amount}원`} [원문 출발요일 적용]`;
      entry.evidence = {
        ...entry.evidence,
        line_start: Math.min(
          Number.isInteger(Number(entry.evidence.line_start)) && Number(entry.evidence.line_start) > 0
            ? Number(entry.evidence.line_start)
            : scope.sourceLineIndex + 1,
          scope.sourceLineIndex + 1,
        ),
        line_end: Math.max(
          Number.isInteger(Number(entry.evidence.line_end)) && Number(entry.evidence.line_end) > 0
            ? Number(entry.evidence.line_end)
            : scope.sourceLineIndex + 1,
          scope.sourceLineIndex + 1,
        ),
        char_start: 0,
        char_end: combinedQuote.length,
        quote: combinedQuote,
        quote_hash: sha256Hex(combinedQuote),
      };
      applied += 1;
    }
  }
  return { applied, ambiguous };
}
