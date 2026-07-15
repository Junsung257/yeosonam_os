import { describe, expect, it } from 'vitest';
import { BLOG_INFORMATION_ENGINE_V2_EVAL_FIXTURES } from './blog-informational-engine-v2-eval-fixtures';
import {
  evaluateBlogInformationEngineV2Fixtures,
  formatBlogInformationEngineV2EvalSummary,
} from './blog-informational-engine-v2-eval';

describe('informational engine v2 named evaluations', () => {
  it('covers every named M10 fixture without external calls or public mutation', async () => {
    expect(BLOG_INFORMATION_ENGINE_V2_EVAL_FIXTURES.map((fixture) => fixture.label)).toEqual([
      '삿포로 식비',
      '광저우 월별 날씨',
      '오사카 공항 이동',
      '대만 숙소 지역',
      '싱가포르 가족 예산',
      '입국·비자 고위험',
      '보험 고위험',
      '잘못된 목적지 slug',
      '동일 destination+intent 중복 생성',
      'URL 미설정 CTA',
      'URL 설정 CTA',
    ]);

    const report = await evaluateBlogInformationEngineV2Fixtures();
    expect(report).toMatchObject({
      fixtureOnly: true,
      externalCalls: 0,
      publicMutations: 0,
      total: 11,
      passed: 11,
      failed: 0,
      ok: true,
    });
    expect(report.cases.every((item) => item.checks.publishState.passed)).toBe(true);
  });

  it('prints a human-readable summary alongside the machine report', async () => {
    const summary = formatBlogInformationEngineV2EvalSummary(
      await evaluateBlogInformationEngineV2Fixtures(),
    );
    expect(summary).toContain('PASS (11/11)');
    expect(summary).toContain('운영 글을 생성·수정·발행하지 않습니다');
  });
});
