import { describe, expect, it } from 'vitest';
import {
  decideBlogDuplicateDispositionV3, evaluateBlogCorpusCandidateV3, extractBlogHeadingTreeV3, minHashSignatureV3,
  minHashSimilarityV3, normalizeBlogTitleSkeletonV3,
} from './blog-corpus-diversity-v3';

describe('blog corpus diversity v3', () => {
  const entities = { cities: ['베를린', '취리히'], airports: ['인천공항'] };
  it('masks destinations, dates, currency, time and distance', () => {
    expect(normalizeBlogTitleSkeletonV3('베를린 2026년 8월 12일 10:30 20유로 3km', entities))
      .toContain('{city}');
  });
  it('normalizes an H2/H3 tree', () => {
    expect(extractBlogHeadingTreeV3('## 베를린 교통\n### 20유로 예산', entities)).toEqual([
      '2:{city} 교통', '3:{number} 예산',
    ]);
  });
  it('detects paragraph reordering through MinHash shingles', () => {
    const body = '하나 둘 셋 넷 다섯 여섯 일곱 여덟 아홉 열 열하나 열둘';
    expect(minHashSimilarityV3(minHashSignatureV3(body), minHashSignatureV3(body))).toBe(1);
  });
  it('blocks exact and saturated skeleton duplicates', () => {
    expect(decideBlogDuplicateDispositionV3({ exactTitle: true, normalizedTitleCanaryCount: 1, headingSimilarity: 0, bodySimilarity: 0 }).disposition).toBe('queue_reject');
    expect(decideBlogDuplicateDispositionV3({ exactTitle: false, normalizedTitleCanaryCount: 3, headingSimilarity: 0, bodySimilarity: 0 }).disposition).toBe('queue_reject');
  });
  it('compares the supplied whole corpus and returns failure evidence', () => {
    const candidate = { title: '오사카 숙소 위치 선택', body: '먼저 난바와 우메다를 비교합니다.\n\n## 이동 기준\n공항 이동을 확인합니다.', destination: '오사카' };
    const report = evaluateBlogCorpusCandidateV3(candidate, [
      { ...candidate, source: 'draft' },
      { title: '도쿄 숙소 위치 선택', body: candidate.body, destination: '도쿄', source: 'queued' },
    ]);
    expect(report.comparedCount).toBe(2);
    expect(report.disposition).toBe('queue_reject');
    expect(report.evidence.some((item) => item.metric === 'exact_title')).toBe(true);
  });
  it('compares first prose paragraphs instead of H1 headings', () => {
    const report = evaluateBlogCorpusCandidateV3({
      title: '괌 식비 예산 시나리오',
      body: '<!-- prompt_version: v2 -->\n# 괌 식비 예산 시나리오\n\n식당 근거를 먼저 고르고 식사 유형을 비교하세요.',
      destination: '괌',
    }, [{
      title: '삿포로 식비 예산 시나리오',
      body: '# 삿포로 식비 예산 시나리오\n\n숙소 위치를 먼저 정하고 교통 동선을 확인하세요.',
      destination: '삿포로',
      source: 'draft',
    }]);

    expect(report.maxOpeningSimilarity).toBeLessThan(0.25);
  });
});
