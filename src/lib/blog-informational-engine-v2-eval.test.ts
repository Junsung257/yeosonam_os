import { describe, expect, it } from 'vitest';
import { BLOG_INFORMATION_ENGINE_V2_EVAL_FIXTURES } from './blog-informational-engine-v2-eval-fixtures';
import {
  evaluateBlogInformationEngineV2Fixtures,
  formatBlogInformationEngineV2EvalSummary,
} from './blog-informational-engine-v2-eval';

describe('informational engine v2 R14 real-path safety evaluation', () => {
  it('proves all eleven required adversarial topics through production validators', async () => {
    expect(BLOG_INFORMATION_ENGINE_V2_EVAL_FIXTURES.map((fixture) => fixture.label)).toEqual([
      '삿포로 식비',
      '광저우 월별 날씨',
      '오사카 공항 이동',
      '캐나다 로키 현지 교통',
      '대만 숙소 지역',
      '싱가포르 가족 예산',
      '세부 쇼핑·기념품',
      '석가장 환전·결제',
      '다낭 여행 일정',
      '일본 입국·비자',
      '해외여행 보험',
    ]);

    const report = await evaluateBlogInformationEngineV2Fixtures();
    expect(report).toMatchObject({
      schemaVersion: 2,
      fixtureOnly: true,
      realPathModules: true,
      externalCalls: 0,
      publicMutations: 0,
      total: 11,
      passed: 11,
      failed: 0,
      ok: true,
    });
    expect(report.cases.every((item) => item.checks.labelOnlyBlocked.status === 'EXPECTED_BLOCK')).toBe(true);
    expect(report.cases.every((item) => item.checks.structuredContent.passed)).toBe(true);
    expect(report.cases.every((item) => item.checks.unsupportedNumbersBlocked.status === 'EXPECTED_BLOCK')).toBe(true);
    expect(report.cases.filter((item) => item.expectedPublishState === 'pending_review')).toHaveLength(2);
    expect(report.cases.every((item) => item.checks.publishState.passed)).toBe(true);
  });

  it('prints a human-readable evidence summary without claiming database verification', async () => {
    const summary = formatBlogInformationEngineV2EvalSummary(
      await evaluateBlogInformationEngineV2Fixtures(),
    );
    expect(summary).toContain('PASS (11/11)');
    expect(summary).toContain('실제 운영 모듈을 호출하되');
    expect(summary).toContain('운영 글·원격 DB·외부 API는 변경하거나 호출하지 않습니다');
  });
});
