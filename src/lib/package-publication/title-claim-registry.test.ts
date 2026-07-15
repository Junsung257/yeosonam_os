import { describe, expect, it } from 'vitest';

import { unsupportedTitleClaims } from './title-claim-registry';

describe('title claim registry', () => {
  it('drops no-option when paid optional tours contradict the source claim', () => {
    expect(unsupportedTitleClaims('연길·백두산 노옵션 4박5일', {
      sourceText: '선택관광: 노옵션',
      hasPaidOptionalTour: true,
    })).toEqual([{ code: 'NO_OPTION', token: '노옵션' }]);
  });

  it('rejects onsen promoted from one included service', () => {
    expect(unsupportedTitleClaims('연길 온천 4박5일', {
      sourceText: '2일차 포함 서비스 온천욕',
    })).toEqual([{ code: 'ONSEN', token: '온천' }]);
  });

  it('requires explicit full-day evidence for a free-day title', () => {
    expect(unsupportedTitleClaims('다낭 자유일정 3박5일', {
      sourceText: '오후 자유시간 2시간',
    })).toEqual([{ code: 'FREE_DAY', token: '자유일정' }]);
  });

  it('accepts a source-backed core-tour claim', () => {
    expect(unsupportedTitleClaims('연길·백두산 핵심관광 4박5일', {
      sourceText: '백두산 핵심관광 일정',
      itineraryDayCount: 5,
      attractionCount: 6,
    })).toEqual([]);
  });
});
