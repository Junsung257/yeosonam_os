import { describe, expect, it } from 'vitest';
import {
  auditBlogInformationPostsDryRun,
  formatBlogInformationExistingAuditSummary,
  type BlogInformationExistingAuditInput,
} from './blog-informational-existing-audit';
import { extractBlogInformationClaims } from './blog-information-claim-validator';

const completeGeneral = [
  '# 도쿄 여행 판단 가이드',
  '',
  '먼저 핵심 답을 확인하고 일정 조건을 나눠 판단합니다.',
  '',
  '## 검색 질문에 대한 직접 답',
  '',
  '핵심 결론과 답을 먼저 확인합니다.',
  '',
  '## 상황별 판단 기준',
  '',
  '상황별 선택 기준을 확인합니다.',
  '',
  '## 실행 체크리스트',
  '',
  '출발 전에 확인할 것과 준비할 것을 정리합니다.',
  '',
  '## 변경 가능성과 주의사항',
  '',
  '운영 변경 가능성과 주의할 위험을 확인합니다.',
  '',
  '| 구분 | 확인 | 비고 |',
  '| --- | --- | --- |',
  '| 일정 | 확인 | 변경 가능 |',
  '| 예산 | 확인 | 기준일 |',
  '| 동선 | 확인 | 대안 |',
].join('\n');

function row(overrides: Partial<BlogInformationExistingAuditInput>): BlogInformationExistingAuditInput {
  return {
    id: overrides.id || 'post-1',
    slug: overrides.slug || 'tokyo-guide',
    seo_title: overrides.seo_title || '도쿄 여행 판단 가이드',
    seo_description: overrides.seo_description || '도쿄 여행의 핵심 판단 기준과 체크리스트, 주의사항을 정리합니다.',
    blog_html: overrides.blog_html ?? completeGeneral,
    destination: overrides.destination === undefined ? '도쿄' : overrides.destination,
    product_id: overrides.product_id ?? null,
    published_at: overrides.published_at || '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('informational existing-post audit dry run', () => {
  it('classifies keep, rewrite, merge, remove, and high-risk review without mutation', async () => {
    const report = await auditBlogInformationPostsDryRun([
      row({
        id: 'keep',
        slug: 'tokyo-guide',
        validated_claim_fingerprints: extractBlogInformationClaims(completeGeneral)
          .map((claim) => claim.claimFingerprint),
      }),
      row({ id: 'duplicate', slug: 'tokyo-guide-copy', published_at: '2026-02-01T00:00:00.000Z' }),
      row({ id: 'rewrite', slug: 'invalid-destination', destination: '대학생' }),
      row({ id: 'remove', slug: 'empty-body', blog_html: '준비 중' }),
      row({
        id: 'risk',
        slug: 'japan-entry',
        seo_title: '한국인 일본 입국 비자 조건',
        seo_description: '한국인 일본 입국 비자와 여권 조건을 확인합니다.',
        destination: '일본',
      }),
    ], { auditedAt: '2026-07-15T09:00:00.000Z' });

    expect(report).toMatchObject({ dryRun: true, databaseReads: 0, databaseWrites: 0, externalCalls: 0 });
    expect(Object.fromEntries(report.items.map((item) => [item.articleId, item.recommendedAction]))).toEqual({
      keep: 'KEEP',
      duplicate: 'MERGE',
      rewrite: 'REWRITE',
      remove: 'REMOVE',
      risk: 'HIGH_RISK_REVIEW',
    });
    expect(report.counts).toEqual({ KEEP: 1, REWRITE: 1, MERGE: 1, REMOVE: 1, HIGH_RISK_REVIEW: 1 });
  });

  it('rewrites an otherwise complete legacy post when factual candidates are unvalidated', async () => {
    const report = await auditBlogInformationPostsDryRun([
      row({ id: 'unvalidated', slug: 'tokyo-unvalidated-guide' }),
    ]);

    expect(report.items[0]).toMatchObject({
      recommendedAction: 'REWRITE',
      reasons: ['unsupported_claims'],
    });
    expect(report.items[0]?.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it('emits a human summary that explicitly denies writes', async () => {
    const summary = formatBlogInformationExistingAuditSummary(
      await auditBlogInformationPostsDryRun([row({})]),
    );
    expect(summary).toContain('DB 읽기/쓰기: 0/0');
    expect(summary).toContain('DB update는 실행하지 않았습니다');
  });
});
