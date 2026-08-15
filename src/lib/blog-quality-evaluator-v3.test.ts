import { describe, expect, it } from 'vitest';
import { evaluateBlogQualityV3 } from './blog-quality-evaluator-v3';

const base = {
  title: '오사카 숙소 위치를 고르는 세 가지 기준',
  body: '오사카 숙소 위치를 고르는 기준입니다. 난바역 도보권은 밤 이동이 짧습니다. 우메다는 교토 이동 환승이 적습니다. 덴노지는 공항 노선 선택지가 다릅니다.',
  destination: '오사카', primaryDecision: '오사카 숙소 위치',
  supportedClaimCount: 3, factualClaimCount: 3, destinationSpecificDetailCount: 3,
  informationGainScore: 0.8, userActionability: 0.8,
};

describe('explainable blog quality evaluator v3', () => {
  it('keeps evidence and failure reason per dimension', () => {
    const report = evaluateBlogQualityV3(base);
    expect(report.dimensions.destination_specificity.evidence).not.toHaveLength(0);
    expect(report.version).toBe('blog-quality-v3');
  });

  it('uses the measured decision-completion score instead of requiring prompt text verbatim', () => {
    const report = evaluateBlogQualityV3({
      ...base,
      primaryDecision: '여행자 유형과 이동 부담에 따라 장소를 고른다',
      intentCompletionScore: 0.9,
    });

    expect(report.dimensions.intent_completion).toMatchObject({
      value: 0.9,
      passed: true,
    });
  });

  it.each([
    '고민을에서 덜어드리겠습니다.에서 엄선한', '여 여소남 에디터', '낮춝니다',
    '어렵편입니다', '여행 준비 여행', '쉥겐 협약국 2-6개국',
  ])('fails broken Korean: %s', (body) => {
    expect(evaluateBlogQualityV3({ ...base, body }).hardBlockers).toContain('korean_language_integrity');
  });

  it('fails unsupported experience and stale ETIAS claims', () => {
    expect(evaluateBlogQualityV3({ ...base, body: '운영팀 검증 결과입니다.' }).hardBlockers).toContain('unsupported_first_party_claim');
    expect(evaluateBlogQualityV3({ ...base, title: 'ETIAS 안내', body: 'ETIAS는 2025년 상반기부터 7유로입니다.' }).hardBlockers).toContain('stale_etias_2025_or_7_euro');
  });

  it('fails part suffix, generic checklist and destination-swapped weather saturation', () => {
    expect(evaluateBlogQualityV3({ ...base, title: '오사카 숙소 위치 (2편)' }).hardBlockers).toContain('numeric_part_title_suffix');
    expect(evaluateBlogQualityV3({ ...base, body: '이곳 준비물입니다. 이곳 체크리스트입니다. 이곳에서 확인하세요.', destinationSpecificDetailCount: 0 }).passed).toBe(false);
    expect(evaluateBlogQualityV3({ ...base, templateSaturation: true }).hardBlockers).toContain('template_saturation');
  });
});
