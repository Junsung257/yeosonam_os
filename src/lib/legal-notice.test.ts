import { describe, it, expect } from 'vitest';
import {
  extractLegalNoticeLines,
  extractLegalNoticeLinesFromPkg,
  getLegalNoticeLinesOrDefault,
} from './legal-notice';

describe('extractLegalNoticeLines', () => {
  it('법무 키워드 포함 라인만 남긴다', () => {
    const lines = [
      '전 일정 관광 포함',
      '출발 30일 전 취소 시 수수료 10%',
      '현지 사정으로 일정 변경 가능',
      '쇼핑 2회 진행',
    ];
    expect(extractLegalNoticeLines(lines, 3)).toEqual([
      '출발 30일 전 취소 시 수수료 10%',
      '현지 사정으로 일정 변경 가능',
    ]);
  });

  it('최대 줄 수를 넘기면 잘라낸다', () => {
    const lines = [
      '취소 규정 A',
      '환불 규정 B',
      '약관 규정 C',
      '면책 규정 D',
    ];
    expect(extractLegalNoticeLines(lines, 3)).toEqual([
      '취소 규정 A',
      '환불 규정 B',
      '약관 규정 C',
    ]);
  });
});

describe('extractLegalNoticeLinesFromPkg', () => {
  it('itinerary_data.highlights.remarks 에서만 추출한다', () => {
    const pkg = {
      itinerary_data: {
        highlights: {
          remarks: ['일정 안내', '환불 불가 구간 있음', '출발일 변경 시 수수료 발생'],
        },
      },
    } as Record<string, unknown>;
    expect(extractLegalNoticeLinesFromPkg(pkg, 3)).toEqual([
      '환불 불가 구간 있음',
      '출발일 변경 시 수수료 발생',
    ]);
  });
});

describe('getLegalNoticeLinesOrDefault', () => {
  it('추출 결과가 없으면 기본 문구를 반환한다', () => {
    const lines = ['맛집 투어', '전 일정 포함'];
    const out = getLegalNoticeLinesOrDefault(lines, 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain('예약 확정 후 취소');
  });
});
