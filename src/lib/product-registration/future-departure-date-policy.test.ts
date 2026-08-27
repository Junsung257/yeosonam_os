import { describe, expect, it } from 'vitest';

import type { V3PriceCalendarEntry } from '@/lib/product-registration-v3/types';

import {
  applyFutureDeparturePolicyToPriceCalendar,
  resolveExplicitSourceDepartureWindow,
  resolveNearestFutureMonthDay,
  resolveNearestFutureRange,
  seoulDateFromInstant,
} from './future-departure-date-policy';

function price(input: Partial<V3PriceCalendarEntry>): V3PriceCalendarEntry {
  return {
    date: null,
    date_range: null,
    weekday: null,
    label: '출발일',
    amount: 599_000,
    currency: 'KRW',
    evidence: {
      line_start: 1,
      line_end: 1,
      char_start: 0,
      char_end: 20,
      quote: '출발일 9/20 599,000원',
    },
    ...input,
  };
}

describe('future departure date policy', () => {
  it('recognizes one explicit mixed-year departure window without treating it as a future-year guess', () => {
    expect(resolveExplicitSourceDepartureWindow([
      '\uCD9C\uBC1C\uB0A0\uC9DC',
      '2025\uB144 12\uC6D4 - 26\uB144 3\uC6D4 26\uC77C (\uB9E4\uC77C \uCD9C\uBC1C)',
    ].join('\n'))).toEqual({
      start: '2025-12-01',
      end: '2026-03-26',
      quote: '2025\uB144 12\uC6D4 - 26\uB144 3\uC6D4 26\uC77C',
    });
  });

  it('does not accept a dated legal or revision line without a departure heading', () => {
    expect(resolveExplicitSourceDepartureWindow('2025\uB144 12\uC6D4 - 26\uB144 3\uC6D4 26\uC77C \uAC1C\uC815')).toBeNull();
  });

  it('recognizes a compact fully dated departure window next to the departure heading', () => {
    expect(resolveExplicitSourceDepartureWindow([
      '\uCD9C \uBC1C \uC77C',
      '2026\uB144 4/3~5/26 (\uD654\uC694\uC77C)',
    ].join('\n'))).toEqual({
      start: '2026-04-03',
      end: '2026-05-26',
      quote: '2026\uB144 4/3~5/26',
    });
  });

  it('recognizes a commercial date window without a departure heading when the source year is independently known', () => {
    expect(resolveExplicitSourceDepartureWindow('2026년 03월 30일 ~ 05월 29일\n월,수 출발\n요금표 참조', 2026)).toEqual({
      start: '2026-03-30',
      end: '2026-05-29',
      quote: '2026년 03월 30일 ~ 05월 29일',
    });
    expect(resolveExplicitSourceDepartureWindow('2026년 03월 30일 ~ 05월 29일\n개정일', 2026)).toBeNull();
  });

  it('recognizes a compact slash date window next to an operation notice', () => {
    expect(resolveExplicitSourceDepartureWindow('4/1~5/29\n월/수 출발\n요금표 참조', 2026)).toEqual({
      start: '2026-04-01',
      end: '2026-05-29',
      quote: '4/1~5/29',
    });
  });

  it('prefers one repeated shared sale window over competing exception windows', () => {
    expect(resolveExplicitSourceDepartureWindow([
      '4/1~5/29 월/수 출발 요금표',
      '4/27~5/6 예외가',
      '4/1~5/29 금 출발 요금표',
    ].join('\n'), 2026)).toEqual({
      start: '2026-04-01',
      end: '2026-05-29',
      quote: '4/1~5/29',
    });
  });

  it('uses the Korean calendar date from the authoritative intake instant', () => {
    expect(seoulDateFromInstant('2026-08-13T15:00:00.000Z')).toBe('2026-08-14');
    expect(seoulDateFromInstant('2026-08-13T14:59:59.999Z')).toBe('2026-08-13');
  });

  it('assigns a yearless date only inside the bounded selling horizon', () => {
    expect(resolveNearestFutureMonthDay({ month: 9, day: 20, referenceDate: '2026-08-14' })).toBe('2026-09-20');
    expect(resolveNearestFutureMonthDay({ month: 1, day: 10, referenceDate: '2026-08-14' })).toBe('2027-01-10');
    expect(resolveNearestFutureMonthDay({ month: 8, day: 13, referenceDate: '2026-08-14' })).toBeNull();
    expect(resolveNearestFutureMonthDay({ month: 8, day: 14, referenceDate: '2026-08-14' })).toBe('2026-08-14');
  });

  it('removes already-past rows from a mixed yearless calendar instead of rolling them one year', () => {
    const result = applyFutureDeparturePolicyToPriceCalendar({
      entries: [
        price({ date: '2026-07-03', label: '7/3' }),
        price({ date: '2026-08-14', label: '8/14' }),
        price({ date: '2026-09-04', label: '9/4' }),
      ],
      authority: 'nearest_future_policy',
      referenceDate: '2026-08-15',
    });

    expect(result.entries.map(entry => entry.date)).toEqual(['2026-09-04']);
    expect(result.excludedPastDateCount).toBe(2);
    expect(result.disposition).toBe('past_entries_removed');
  });

  it('treats a parser-preassigned next year on a stale yearless row as a past occurrence', () => {
    const result = applyFutureDeparturePolicyToPriceCalendar({
      entries: [
        price({ date: '2027-07-03', label: '7/3' }),
        price({ date: '2026-08-21', label: '8/21' }),
      ],
      authority: 'nearest_future_policy',
      referenceDate: '2026-08-15',
    });

    expect(result.entries.map(entry => entry.date)).toEqual(['2026-08-21']);
    expect(result.excludedPastDateCount).toBe(1);
    expect(result.invalidDateCount).toBe(0);
    expect(result.blockers).toEqual([]);
    expect(result.disposition).toBe('past_entries_removed');
  });

  it('keeps only the still-sellable part of a yearless active range', () => {
    expect(resolveNearestFutureRange({
      startMonth: 7,
      startDay: 1,
      endMonth: 9,
      endDay: 30,
      referenceDate: '2026-08-14',
    })).toEqual({ start: '2026-08-14', end: '2026-09-30', clipped: true });
  });

  it('rolls a yearless December-to-January range across the year boundary', () => {
    expect(resolveNearestFutureRange({
      startMonth: 12,
      startDay: 20,
      endMonth: 1,
      endDay: 10,
      referenceDate: '2026-08-14',
    })).toEqual({ start: '2026-12-20', end: '2027-01-10', clipped: false });
    const applied = applyFutureDeparturePolicyToPriceCalendar({
      entries: [price({
        date_range: { start: '2026-12-20', end: '2026-01-10' },
        label: '12/20~1/10',
      })],
      authority: 'nearest_future_policy',
      referenceDate: '2026-08-14',
    });
    expect(applied.entries[0]?.date_range).toEqual({ start: '2026-12-20', end: '2027-01-10' });
    expect(applied.blockers).toEqual([]);
  });

  it('rolls yearless exact dates but never rolls an explicit past year', () => {
    const rolling = applyFutureDeparturePolicyToPriceCalendar({
      entries: [price({ date: '2026-01-10', label: '1/10' })],
      authority: 'nearest_future_policy',
      referenceDate: '2026-08-14',
    });
    expect(rolling.entries[0]?.date).toBe('2027-01-10');
    expect(rolling.inferredDateCount).toBe(1);

    const explicit = applyFutureDeparturePolicyToPriceCalendar({
      entries: [price({ date: '2026-01-10', label: '2026년 1월 10일' })],
      authority: 'document_text',
      referenceDate: '2026-08-14',
    });
    expect(explicit.entries).toEqual([]);
    expect(explicit.disposition).toBe('past_only_excluded');
  });

  it('excludes a yearless past occurrence when its supplied weekday matches the intake year', () => {
    const result = applyFutureDeparturePolicyToPriceCalendar({
      entries: [price({ date: '2026-04-14', weekday: 2, label: '4\uC6D4 14\uC77C (\uD654)' })],
      authority: 'nearest_future_policy',
      referenceDate: '2026-08-14',
    });

    expect(result.entries).toEqual([]);
    expect(result.blockers).toEqual([]);
    expect(result.excludedPastDateCount).toBe(1);
    expect(result.disposition).toBe('past_only_excluded');
  });

  it('keeps a future yearless occurrence only when its supplied weekday matches', () => {
    const result = applyFutureDeparturePolicyToPriceCalendar({
      entries: [price({ date: '2026-01-10', weekday: 0, label: '1\uC6D4 10\uC77C (\uC77C)' })],
      authority: 'nearest_future_policy',
      referenceDate: '2026-08-14',
    });

    expect(result.entries[0]?.date).toBe('2027-01-10');
    expect(result.entries[0]?.weekday).toBe(0);
    expect(result.blockers).toEqual([]);
  });

  it('blocks a future yearless occurrence when the supplied weekday conflicts', () => {
    const result = applyFutureDeparturePolicyToPriceCalendar({
      entries: [price({ date: '2026-01-10', weekday: 1, label: '1\uC6D4 10\uC77C (\uC6D4)' })],
      authority: 'nearest_future_policy',
      referenceDate: '2026-08-14',
    });

    expect(result.entries).toEqual([]);
    expect(result.blockers).toEqual(['PRICE_DATE_WEEKDAY_CONFLICT:0']);
    expect(result.disposition).toBe('undated_or_invalid');
  });

  it('removes only past explicit dates from a mixed calendar', () => {
    const result = applyFutureDeparturePolicyToPriceCalendar({
      entries: [
        price({ date: '2026-01-10', label: '2026년 1월 10일' }),
        price({ date: '2026-09-20', label: '2026년 9월 20일' }),
      ],
      authority: 'document_text',
      referenceDate: '2026-08-14',
    });
    expect(result.entries.map(entry => entry.date)).toEqual(['2026-09-20']);
    expect(result.excludedPastDateCount).toBe(1);
    expect(result.disposition).toBe('past_entries_removed');
  });

  it('keeps independently explicit dates when one section legitimately contains two years', () => {
    const result = applyFutureDeparturePolicyToPriceCalendar({
      entries: [
        price({ date: '2026-12-20', label: '2026년 12월 20일' }),
        price({ date: '2027-01-10', label: '2027년 1월 10일' }),
      ],
      authority: 'conflicting',
      referenceDate: '2026-08-14',
    });
    expect(result.blockers).toEqual([]);
    expect(result.entries.map(entry => entry.date)).toEqual(['2026-12-20', '2027-01-10']);
  });

  it('blocks an unbound yearless date when competing explicit years exist', () => {
    const result = applyFutureDeparturePolicyToPriceCalendar({
      entries: [price({ date: '2026-09-20', label: '9/20' })],
      authority: 'conflicting',
      referenceDate: '2026-08-14',
    });
    expect(result.entries).toEqual([]);
    expect(result.blockers).toEqual(['PRICE_DATE_YEAR_CONFLICT:0']);
  });

  it('does not roll an entry-local explicit past year under a yearless document fallback', () => {
    const result = applyFutureDeparturePolicyToPriceCalendar({
      entries: [price({
        date: '2025-09-20',
        label: '2025-09-20',
        evidence: {
          line_start: 1,
          line_end: 1,
          char_start: 0,
          char_end: 24,
          quote: '2025-09-20 799,000원',
        },
      })],
      authority: 'nearest_future_policy',
      referenceDate: '2026-08-14',
    });

    expect(result.entries).toEqual([]);
    expect(result.excludedPastDateCount).toBe(1);
    expect(result.inferredDateCount).toBe(0);
    expect(result.disposition).toBe('past_only_excluded');
  });

  it('does not infer a yearless leap day outside the bounded selling horizon', () => {
    expect(resolveNearestFutureMonthDay({ month: 2, day: 29, referenceDate: '2026-08-14' })).toBeNull();
  });
});
