import {
  BLOG_SAFE_INFORMATION_INTENTS_V4,
  buildBlogQualityRegressionReportV4,
  evaluateBlogProductDecisionBriefV4,
  type BlogQualityRegressionCaseV4,
} from '../src/lib/blog-quality-improvement-v4';
import {
  evaluateBlogInformationEngineV2Fixtures,
} from '../src/lib/blog-informational-engine-v2-eval';
import { BLOG_INFORMATION_ENGINE_V2_EVAL_FIXTURES } from '../src/lib/blog-informational-engine-v2-eval-fixtures';

async function main(): Promise<void> {
  const existingEngineReport = await evaluateBlogInformationEngineV2Fixtures();
  const safeIntents = new Set<string>(BLOG_SAFE_INFORMATION_INTENTS_V4);
  const cases: BlogQualityRegressionCaseV4[] = existingEngineReport.cases.map(item => {
    const fixture = BLOG_INFORMATION_ENGINE_V2_EVAL_FIXTURES.find(candidate => candidate.id === item.id);
    const intent = fixture?.expectedIntent;
    const blockers = Object.entries(item.checks)
      .filter(([, check]) => !check.passed)
      .map(([checkName]) => checkName);
    return {
      id: item.id,
      intent: (intent && safeIntents.has(intent) ? intent : 'contract') as BlogQualityRegressionCaseV4['intent'],
      passed: item.passed,
      blockers,
      details: {
        evaluator: 'existing-blog-information-engine-v2',
        expectedPublishState: item.expectedPublishState,
        actualPublishState: item.actualPublishState,
        expectedHighRiskPending: intent ? !safeIntents.has(intent) : true,
      },
    };
  });
  const productFixture = evaluateBlogProductDecisionBriefV4({
    productId: 'product-fixture-1',
    contentVersion: 'product-content-v1',
    productSnapshotHash: 'snapshot-fixture-1',
    title: '괌 가족 패키지 fixture',
    destination: '괌',
    price: { amount: 1290000, currency: 'KRW', basis: '확인일 기준, 2인 1실', checkedAt: '2026-08-25' },
    inclusions: ['항공'],
    exclusions: ['개인경비'],
    travelerFit: ['가족'],
    bookingChannel: 'official-product-detail',
  });
  cases.push({
    id: 'product-decision-brief',
    intent: 'contract' as const,
    passed: productFixture.passed,
    blockers: productFixture.blockers,
    details: { evaluator: 'product-decision-brief-v4', priceBasis: productFixture.priceBasis },
  });
  const report = buildBlogQualityRegressionReportV4(cases);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

void main();
