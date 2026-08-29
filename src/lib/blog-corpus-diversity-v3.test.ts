import { describe, expect, it } from 'vitest';
import {
  BLOG_OPENING_MAX_SIMILARITY_V3, decideBlogDuplicateDispositionV3, evaluateBlogCorpusCandidateV3, extractBlogHeadingTreeV3, minHashSignatureV3,
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

  it('uses the strict opening threshold and excludes non-accepted drafts from opening comparison', () => {
    const candidate = {
      title: '괌 숙소 지역 비교',
      body: '일정의 우선순위를 먼저 적고 확인된 근거를 기준별로 대조합니다.\n\n## 비교 기준\n조건을 나눕니다.',
      destination: '괌',
    };
    const report = evaluateBlogCorpusCandidateV3(candidate, [
      { title: '실패한 초안', body: candidate.body, source: 'draft', includeInOpeningComparison: false },
      { title: '승인된 글', body: '일정의 우선순위를 먼저 적고 확인된 근거를 기준별로 대조합니다.\n\n## 다른 기준\n조건을 나눕니다.', source: 'published' },
    ]);
    expect(report.openingEvidence.threshold).toBe(BLOG_OPENING_MAX_SIMILARITY_V3);
    expect(report.openingEvidence.comparedCount).toBe(1);
    expect(report.openingEvidence.nearestMatch?.title).toBe('승인된 글');
  });
});
