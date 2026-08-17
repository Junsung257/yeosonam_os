import { describe, expect, it } from 'vitest';

import {
  mergeProductSourceUploadMetadata,
  parseProductSourceDepartureYearContext,
  resolveProductSourceDepartureYearEvidence,
  resolveProductSourceDepartureYearEvidenceAtReference,
} from './source-departure-year-context';

describe('parseProductSourceDepartureYearContext', () => {
  it('keeps an omitted upload-envelope year absent', () => {
    expect(parseProductSourceDepartureYearContext('')).toEqual({ ok: true, value: null });
  });

  it('accepts only an explicitly confirmed four-digit year', () => {
    expect(parseProductSourceDepartureYearContext('2026')).toEqual({
      ok: true,
      value: {
        year: 2026,
        authority: 'authenticated_admin',
        version: 'source-departure-year-context-1',
      },
    });
  });

  it('rejects shorthand, timestamps, and out-of-range values', () => {
    expect(parseProductSourceDepartureYearContext('26').ok).toBe(false);
    expect(parseProductSourceDepartureYearContext('2026-08-14').ok).toBe(false);
    expect(parseProductSourceDepartureYearContext(2101).ok).toBe(false);
    expect(parseProductSourceDepartureYearContext({
      year: 2026,
      authority: 'untrusted_client',
      version: 'source-departure-year-context-1',
    }).ok).toBe(false);
  });
});

describe('mergeProductSourceUploadMetadata', () => {
  it('preserves stored commercial metadata while a retry carries its job-bound year', () => {
    expect(mergeProductSourceUploadMetadata({
      sourceMetadata: {
        uploadSourceMetadata: { landOperator: 'supplier-a', commissionRate: 10 },
        sourceDepartureYearContext: {
          year: 2025,
          authority: 'authenticated_admin',
          version: 'source-departure-year-context-1',
        },
      },
      requestMetadata: {
        sourceDepartureYearContext: {
          year: 2026,
          authority: 'authenticated_admin',
          version: 'source-departure-year-context-1',
        },
      },
    })).toEqual({
      landOperator: 'supplier-a',
      commissionRate: 10,
      sourceDepartureYearContext: {
        year: 2026,
        authority: 'authenticated_admin',
        version: 'source-departure-year-context-1',
      },
    });
  });
});

describe('resolveProductSourceDepartureYearEvidence', () => {
  it('uses a future filename sale window when the conflicting itinerary window is explicitly stale', () => {
    expect(resolveProductSourceDepartureYearEvidenceAtReference({
      text: [
        '\uCD9C\uBC1C\uC77C 5/2~11/30 \uC0C1\uD488\uAC00 1,409,000\uC6D0',
        '\uCD9C\uBC1C\uC77C',
        '2025\uB144 3\uC6D4 1\uC77C ~ 2026\uB144 4\uC6D4 29\uC77C',
      ].join('\n'),
      filename: '26.6~26.11 3U \uC778\uCC9C\uC7A5\uAC00\uACC4PKG.hwp',
      referenceDate: '2026-08-14',
    })).toEqual({
      validated: true,
      year: 2026,
      source: 'filename',
      superseded_source_window: { start: '2025-03-01', end: '2026-04-29' },
      filename_month_window: { start: '2026-06-01', end: '2026-11-30' },
    });
  });

  it('keeps two overlapping active year schedules conflicting', () => {
    expect(resolveProductSourceDepartureYearEvidenceAtReference({
      text: '\uCD9C\uBC1C\uC77C 2026\uB144 9\uC6D4 1\uC77C ~ 2027\uB144 1\uC6D4 31\uC77C',
      filename: '26.9~27.2 \uC2E0\uC0C1\uD488.hwp',
      referenceDate: '2026-08-14',
    }).source).toBe('conflicting');
  });

  it('uses the departure-period year and ignores a regulatory notice year', () => {
    expect(resolveProductSourceDepartureYearEvidence({
      text: '출발날짜 26년 3월 ~ 6월 출발. 25년 1월 1일부터 전자담배 반입 금지.',
      filename: '[0325발권] 3월~6월 다낭 패키지.hwp',
    })).toEqual({ validated: true, year: 2026, source: 'document_text' });
  });

  it('accepts one matching departure year from text and filename', () => {
    expect(resolveProductSourceDepartureYearEvidence({
      text: '2026년 9월 출발 패키지 요금',
      filename: '26년 9월 출발 상품.hwp',
    })).toEqual({ validated: true, year: 2026, source: 'document_text' });
  });

  it('uses a compact departure date from a filename', () => {
    expect(resolveProductSourceDepartureYearEvidence({
      text: '푸꾸옥 3박 5일 출발일 8월 13일',
      filename: '푸꾸옥 새일정 260813 - 여소남.hwp',
    })).toEqual({ validated: true, year: 2026, source: 'filename' });
  });

  it('does not use a compact revision date as a departure year', () => {
    expect(resolveProductSourceDepartureYearEvidence({
      text: '푸꾸옥 3박 5일 9월 출발',
      filename: '푸꾸옥 일정표 수정 260813.hwp',
    })).toEqual({ validated: false, year: null, source: 'missing' });
  });

  it('keeps genuinely different departure years blocked', () => {
    expect(resolveProductSourceDepartureYearEvidence({
      text: '2026년 12월 출발, 2027년 1월 출발',
      filename: '동계 패키지.hwp',
    })).toEqual({ validated: false, year: null, source: 'conflicting' });
  });

  it('uses the start year of one explicit cross-year product period when the filename is undated', () => {
    expect(resolveProductSourceDepartureYearEvidence({
      text: '행사날짜 | 2026년 8월 ~ 2027년 3월 | 출발인원 2명',
      filename: '나리타 골프 3박4일.hwp',
    })).toEqual({ validated: true, year: 2026, source: 'document_text' });
  });

  it('uses a table value cross-year period when its label was extracted into another cell', () => {
    expect(resolveProductSourceDepartureYearEvidence({
      text: '행사 날짜\n2026년 8월 ~ 2027년 3월',
      filename: '나리타 골프 요금표.hwp',
    })).toEqual({
      validated: true,
      year: 2026,
      source: 'document_text',
    });
  });

  it('does not mistake an informational year for a product year', () => {
    expect(resolveProductSourceDepartureYearEvidence({
      text: '9월 출발. 25년 1월부터 전자담배 반입 금지.',
      filename: '다낭 9월 패키지.hwp',
    })).toEqual({ validated: false, year: null, source: 'missing' });
  });

  it('does not let a following itinerary table turn a regulatory year into a conflict', () => {
    expect(resolveProductSourceDepartureYearEvidence({
      text: [
        '1인 1,199,000원→1,039,000원',
        '● 베트남 전자담배 반입 금지입니다. (25년 1월 1일부)',
        '일 자',
        '지 역',
        '항공편',
        '일 정',
      ].join('\n'),
      filename: '[일정표] LJ 부산출발 푸꾸옥 260730 - 특가 (0716).hwp',
    })).toEqual({ validated: true, year: 2026, source: 'filename' });
  });

  it('does not mistake an attraction opening year for the departure year', () => {
    expect(resolveProductSourceDepartureYearEvidence({
      text: [
        '4/25 649,000원',
        "2022년 4월 25일에 오픈한 종합쇼핑몰 관광",
      ].join('\n'),
      filename: '★ 투어폰 26년 4월~7월 2박3일 일정표.hwp',
    })).toEqual({ validated: true, year: 2026, source: 'filename' });
  });

  it('does not treat a visa-free entry period as a competing departure year', () => {
    expect(resolveProductSourceDepartureYearEvidence({
      text: [
        '출 발 일 자',
        '26년 4월 10일 ~ 5월 29일 (화)',
        '2024년 11월 8일부터 2026년 12월 31일까지 중국 입국 관광객은 무비자 체류 가능합니다.',
      ].join('\n'),
      filename: '260410-260529 황산전세기 4,5일 일정표.hwp',
    })).toEqual({ validated: true, year: 2026, source: 'document_text' });
  });
});
