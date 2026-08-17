import { describe, expect, it } from 'vitest';

import {
  parseTrustedDepartureDatesFromFilename,
  parseTrustedDepartureMonthWindowFromFilename,
  parseTrustedSingleProductTravelPeriodStart,
} from './source-departure-date-context';

describe('parseTrustedSingleProductTravelPeriodStart', () => {
  it('uses a heading travel period only when it exactly matches the product duration', () => {
    expect(parseTrustedSingleProductTravelPeriodStart({
      text: '장가계 노팁 노옵션 초특가\n8월 18일(화) ~ 8월 22일(토)\n상품가 499,000원',
      validatedYear: 2026,
      durationDays: 5,
    })).toMatchObject({ date: '2026-08-18', end: '2026-08-22', authority: 'document_text' });
  });

  it('rejects a general sale range that does not match the trip duration', () => {
    expect(parseTrustedSingleProductTravelPeriodStart({
      text: '장가계 4박5일\n출발기간 8월 18일 ~ 9월 22일\n상품가 499,000원',
      validatedYear: 2026,
      durationDays: 5,
    })).toBeNull();
  });
});

describe('parseTrustedDepartureMonthWindowFromFilename', () => {
  it('reads a future supplier month window without inventing exact departure days', () => {
    expect(parseTrustedDepartureMonthWindowFromFilename('26.6~26.11 3U \uC778\uCC9C\uC7A5\uAC00\uACC4PKG.hwp')).toEqual({
      start: '2026-06-01',
      end: '2026-11-30',
      year: 2026,
      authority: 'filename',
      sourceToken: '26.6~26.11',
    });
  });

  it('does not use a ticketing or revision month range', () => {
    expect(parseTrustedDepartureMonthWindowFromFilename('26.6~26.11 \uBC1C\uAD8C \uC218\uC815.hwp')).toBeNull();
  });
});

describe('parseTrustedDepartureDatesFromFilename', () => {
  it('extracts a compact YYMMDD departure and ignores a four-digit revision suffix', () => {
    expect(parseTrustedDepartureDatesFromFilename({
      filename: '[일정표] LJ 부산출발 푸꾸옥 260730 - 특가 (0716).hwp',
      validatedYear: 2026,
    })?.dates).toEqual(['2026-07-30']);
  });

  it('expands abbreviated days that follow one compact departure date', () => {
    expect(parseTrustedDepartureDatesFromFilename({
      filename: '[일정표] VN 나트랑 260621,28 - 3일내발권조건.hwp',
    })?.dates).toEqual(['2026-06-21', '2026-06-28']);
  });

  it('does not accept an issuance date as a departure date', () => {
    expect(parseTrustedDepartureDatesFromFilename({
      filename: '나트랑 3박5일 260827 발권.hwp',
    })).toBeNull();
  });

  it('uses an already validated year for a month-day departure token', () => {
    expect(parseTrustedDepartureDatesFromFilename({
      filename: '인도 원데이특가 9월27일.hwp',
      validatedYear: 2026,
    })?.dates).toEqual(['2026-09-27']);
  });

  it('expands compact MMDD departures after one explicit Korean year', () => {
    expect(parseTrustedDepartureDatesFromFilename({
      filename: '[BX] \uC624\uC0AC\uCE741\uBC152\uC77C PKG 26\uB144 0617. 0623 \u2605299\uD2B9\uAC00 0520.hwp',
      validatedYear: 2026,
    })?.dates).toEqual(['2026-06-17', '2026-06-23']);
  });

  it('accepts two leading MMDD departure tokens only after the year is validated elsewhere', () => {
    expect(parseTrustedDepartureDatesFromFilename({
      filename: '(\uC77C\uC815\uD45C)0815,0919\uC11C\uC548 \uB178\uB178\uD2B9\uAC00 - 0730\uC120\uBC1C.hwp',
      validatedYear: 2026,
    })?.dates).toEqual(['2026-08-15', '2026-09-19']);
    expect(parseTrustedDepartureDatesFromFilename({
      filename: '(\uC77C\uC815\uD45C)0815,0919\uC11C\uC548 \uB178\uB178\uD2B9\uAC00.hwp',
      validatedYear: null,
    })).toBeNull();
  });

  it('expands abbreviated days after one leading MMDD departure token', () => {
    expect(parseTrustedDepartureDatesFromFilename({
      filename: '[BX전세기] 0711, 18 장가계 3박4일 특가.hwp',
      validatedYear: 2026,
    })?.dates).toEqual(['2026-07-11', '2026-07-18']);
  });
});
