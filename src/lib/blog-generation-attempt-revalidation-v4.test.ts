import { describe, expect, it } from 'vitest';
import { isEligibleBlogGenerationAttemptRevalidationV4 } from './blog-generation-run-v4';

const output = {
  title: '괌 식비 예산',
  description: '근거 기반 식비 비교',
  slug: 'guam-daily-food-budget',
  markdown: '# 괌 식비 예산\n\n식당 근거를 확인하세요.',
  audit: {
    claim_validation: { passed: true },
    publish_quality: { passed: true },
    quality_evaluation_v3: {
      passed: false,
      failureReasons: [{ code: 'opening_too_similar' }],
    },
  },
};

describe('deterministic blog generation attempt revalidation v4', () => {
  it('allows only an unchanged, grounded attempt blocked solely by opening similarity', () => {
    expect(isEligibleBlogGenerationAttemptRevalidationV4({
      snapshot: {
        attemptNumber: 5,
        status: 'completed',
        route: 'quarantine',
        qualityScore: 96.52,
        hardBlockers: [],
        failureReasons: ['opening_too_similar'],
        output,
      },
      expectedAttemptNumber: 5,
      output,
    })).toBe(true);
  });

  it('rejects content changes and any additional failure', () => {
    expect(isEligibleBlogGenerationAttemptRevalidationV4({
      snapshot: {
        attemptNumber: 5,
        status: 'completed',
        route: 'quarantine',
        qualityScore: 96.52,
        hardBlockers: [],
        failureReasons: ['opening_too_similar', 'unsupported_number_present'],
        output,
      },
      expectedAttemptNumber: 5,
      output: { ...output, markdown: `${output.markdown}\n\n새 문장` },
    })).toBe(false);
  });

  it('allows only the exact third-attempt route-template failure to receive a deterministic repair', () => {
    const routeOutput = {
      ...output,
      title: '괌 공항 택시 카운터 미터요금 GRTA 요금: GRTA·택시 요금과 공항 택시 승차·수하물 안내',
      slug: 'guam-airport-taxi-counter-grta-fares',
      markdown: '<!-- blog_decision_artifact:route_decision:v1 -->\n# 기존 제목\n\n기존 표',
      audit: {
        claim_validation: { passed: true },
        publish_quality: { passed: false },
        quality_evaluation_v3: { passed: true, failureReasons: [] },
      },
    };
    const repairedOutput = {
      ...routeOutput,
      title: '괌 공항 교통: 택시 위치·미터요금과 GRTA 요금 비교',
      markdown: [
        '<!-- blog_decision_artifact:route_decision:v1 -->',
        '# 새 제목',
        '기본 호출 2.40 USD, 최초 1마일 4.00 USD, 0.25마일마다 0.80 USD',
        '일반 1회 탑승 요금은 1.50 USD, 일반 1일권 요금은 4.00 USD',
        '서쪽 도착 터미널 건물 밖',
      ].join('\n\n'),
    };
    const failureReasons = [
      'publish_gate:ai_readability',
      'editorial_harness_v5:deterministic_internal_label_leak',
      'editorial_harness_v5:semantic_judge_missing',
    ];
    const eligible = (reasons = failureReasons, attemptNumber = 4) =>
      isEligibleBlogGenerationAttemptRevalidationV4({
        snapshot: {
          attemptNumber,
          status: 'completed',
          route: 'quarantine',
          qualityScore: 0,
          hardBlockers: [],
          failureReasons: reasons,
          output: routeOutput,
        },
        expectedAttemptNumber: attemptNumber,
        output: repairedOutput,
        reason: 'route_template_dedup_v2',
      });

    expect(eligible()).toBe(true);
    expect(eligible([...failureReasons, 'unsupported_number_present'])).toBe(false);
    expect(eligible(failureReasons, 3)).toBe(false);
    expect(isEligibleBlogGenerationAttemptRevalidationV4({
      snapshot: {
        attemptNumber: 4,
        status: 'completed',
        route: 'quarantine',
        qualityScore: 0,
        hardBlockers: [],
        failureReasons,
        output: routeOutput,
      },
      expectedAttemptNumber: 4,
      output: { ...repairedOutput, markdown: '<!-- blog_decision_artifact:route_decision:v1 -->\n임의 변경' },
      reason: 'route_template_dedup_v2',
    })).toBe(false);
  });
});
