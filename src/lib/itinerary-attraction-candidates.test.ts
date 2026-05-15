import { describe, expect, it } from 'vitest';
import { extractAttractionCandidates } from './itinerary-attraction-candidates';

describe('extractAttractionCandidates', () => {
  it('이동/관광 혼합 라인에서 관광지 키만 분리', () => {
    const c = extractAttractionCandidates(
      '▶도이인타논으로 이동 [1시간 소요]',
      '태국에서 가장 높은 해발 2656미터의 히말라야의 관문 도이인타논 산',
    );
    expect(c.some(x => x.includes('도이인타논'))).toBe(true);
  });

  it('복수 명소 구분자를 분리', () => {
    const c = extractAttractionCandidates('▶베치라탄 폭포 및 앙카트레일, 몽족시장관광');
    expect(c).toEqual(expect.arrayContaining(['베치라탄 폭포', '앙카트레일', '몽족시장']));
  });

  it('식사/투숙 라인은 제외', () => {
    const c = extractAttractionCandidates('석식 후 호텔 투숙 및 휴식');
    expect(c.length).toBe(0);
  });

  it('괄호 안 별칭도 별도 후보로 추출', () => {
    const c = extractAttractionCandidates('▶린푸억사원(달랏 핑크 사원) 관광');
    expect(c).toEqual(expect.arrayContaining(['린푸억사원', '달랏 핑크 사원']));
  });

  it('60자 까지 긴 정식 명칭 흡수', () => {
    const c = extractAttractionCandidates('▶도멘 드 마리 성당 (Domaine de Marie Catholic Church)');
    expect(c.some(x => x.includes('도멘 드 마리 성당'))).toBe(true);
  });
});
