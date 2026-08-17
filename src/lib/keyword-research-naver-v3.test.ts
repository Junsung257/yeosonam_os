import { describe, expect, it } from 'vitest';
import { extractExactNaverMonthlyVolumes } from './keyword-research';

describe('extractExactNaverMonthlyVolumes', () => {
  it('uses only exact Search Ads rows and keeps DataLab semantics separate', () => {
    const result = extractExactNaverMonthlyVolumes(['다낭 10월 날씨'], [{
      relKeyword: '다낭10월날씨', monthlyPcQcCnt: 120, monthlyMobileQcCnt: 880,
      monthlyAvePcClkCnt: 0, monthlyAveMobileClkCnt: 0, monthlyAvePcCtr: 0,
      monthlyAveMobileCtr: 0, plAvgDepth: 0, compIdx: 0, lowPrice: 0, highPrice: 0,
    }]);
    expect(result.get('다낭 10월 날씨')).toBe(1000);
  });

  it('does not invent an exact total from a provider < 10 bucket', () => {
    const result = extractExactNaverMonthlyVolumes(['세부 호텔 추천'], [{
      relKeyword: '세부호텔추천', monthlyPcQcCnt: '< 10', monthlyMobileQcCnt: 90,
      monthlyAvePcClkCnt: 0, monthlyAveMobileClkCnt: 0, monthlyAvePcCtr: 0,
      monthlyAveMobileCtr: 0, plAvgDepth: 0, compIdx: 0, lowPrice: 0, highPrice: 0,
    }]);
    expect(result.get('세부 호텔 추천')).toBeNull();
  });
});
