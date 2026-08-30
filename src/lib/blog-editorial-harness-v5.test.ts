import { describe, expect, it } from 'vitest';
import {
  applyBlogDecisionArtifactToWriterOutputV1,
  buildBlogDecisionArtifactV1,
  buildBlogPromptTraceV1,
  inspectBlogEditorialDeterministicallyV1,
  parseBlogEditorialJudgeReportV1,
  restrictBlogDecisionArtifactFactsV1,
  resolveBlogPublicSourceLabelV1,
  withBlogDecisionArtifactClaimsV1,
} from './blog-editorial-harness-v5';
import {
  createBlogInformationClaimFingerprint,
  validateBlogInformationResearchBundle,
  type BlogInformationResearchBundle,
} from './blog-information-evidence';

const NOW = '2026-08-29T12:00:00.000Z';

function foodBundle(): BlogInformationResearchBundle {
  const definitions = [
    ['coffee', 'House of Chin Fe 괌의 커피는 확인일 기준 2.50 USD이다.', '2.5', 'official_operator', 'official_secondary', 'House of Chin Fe', 'https://chinfe.menuguam.com/menu'],
    ['breakfast', 'House of Chin Fe 괌의 콘비프 볶음밥 조식은 14.50 USD이다.', '14.5', 'official_operator', 'official_secondary', 'House of Chin Fe', 'https://chinfe.menuguam.com/menu'],
    ['fast', '맥도날드 콤보 식사 가격은 15.00 USD이다.', '15', 'reputable_price_source', 'editorial_secondary', 'Numbeo', 'https://www.numbeo.com/cost-of-living/in/Guam'],
    ['ordinary', '저렴한 레스토랑 한 끼 가격은 25.00 USD이다.', '25', 'reputable_price_source', 'editorial_secondary', 'Numbeo', 'https://www.numbeo.com/cost-of-living/in/Guam'],
    ['buffet', '토요일 점심 인터내셔널 뷔페 성인 가격은 43.00 USD이다.', '43', 'official_operator', 'official_secondary', 'Rootz Hill’s Grillhouse', 'https://rootzguam.com/menu'],
  ] as const;
  return {
    contentKey: 'guam-daily-food-budget',
    sources: definitions.map(([key, , , sourceType, authorityLevel, publisher, sourceUrl]) => ({
      sourceKey: `s-${key}`,
      sourceType,
      authorityLevel,
      sourceUrl,
      publisher,
      retrievedAt: NOW,
      snapshotContent: `snapshot-${key}`,
      contentHash: key.padEnd(64, '0'),
      destination: '괌',
      country: 'GU',
      claimTypes: ['price'],
      riskLevel: 'MEDIUM',
    })),
    evidence: definitions.map(([key, text, value]) => ({
      evidenceKey: `e-${key}`,
      sourceKey: `s-${key}`,
      excerpt: text,
      spanStart: 0,
      spanEnd: text.length,
      claimType: 'price',
      riskLevel: 'MEDIUM',
      observedAt: NOW,
      scope: {
        country: 'GU',
        destination: '괌',
        applicableTo: '한국인 여행자',
        locale: 'ko-KR',
        claimType: 'price',
        normalizedValue: value,
        unit: '1회',
        currency: 'USD',
        conditions: [],
      },
    })),
    claims: definitions.map(([key, text, value]) => ({
      claimFingerprint: createBlogInformationClaimFingerprint(text),
      claimText: text,
      claimType: 'price',
      riskLevel: 'MEDIUM',
      extractedValue: { normalizedValue: value, unit: '1회', currency: 'USD' },
      requiresEvidence: true,
      evidenceKeys: [`e-${key}`],
    })),
  };
}

function decisionArtifact() {
  return buildBlogDecisionArtifactV1({
    title: '괌 여행 식비 예산: 여행 방식별 예산 시나리오',
    question: '괌 여행 식비 예산',
    primaryDecision: '하루 식비를 여행 방식별로 비교한다.',
    intentType: 'food_budget',
    bundle: foodBundle(),
  });
}

describe('blog editorial harness v5', () => {
  it('builds three deterministic daily food calculations with honest source labels', () => {
    const artifact = decisionArtifact();
    expect(artifact.promiseType).toBe('daily_budget_scenarios');
    expect(artifact.calculations.map((row) => row.result)).toEqual([57, 67, 85]);
    expect(artifact.calculations[0]?.formula).toBe('14.50 + 15 + 25 + 2.50 = 57 USD');
    expect(artifact.publicFacts.find((fact) => fact.claimText.includes('맥도날드'))?.citationLabel)
      .toBe('가격 조사 자료 · Numbeo');
    expect(resolveBlogPublicSourceLabelV1({
      sourceType: 'official_operator',
      authorityLevel: 'official_secondary',
    })).toBe('운영사 공식 안내');
  });

  it('persists arithmetic provenance as derived price claims', () => {
    const bundle = foodBundle();
    const artifact = decisionArtifact();
    const enriched = withBlogDecisionArtifactClaimsV1(bundle, artifact);
    expect(enriched.claims).toHaveLength(bundle.claims.length + 3);
    const derived = enriched.claims.find((claim) => claim.claimFingerprint === artifact.calculations[0]?.publicClaimFingerprint);
    expect(derived?.extractedValue?.derivation).toMatchObject({
      version: 'blog-claim-derivation-v1',
      operation: 'sum',
      operandValues: ['14.5', '15', '25', '2.5'],
    });
    expect(validateBlogInformationResearchBundle(enriched).issues
      .filter((issue) => issue.includes('invalid_derivation'))).toEqual([]);
  });

  it('rejects the exact production failure pattern as unanswered, misleading source stitching', () => {
    const markdown = `# 괌 여행 식비 예산: 여행 방식별 예산 시나리오

괌 여행 식비 예산 기준을 세우려면 chinfe.menuguam.com·numbeo.com·rootzguam.com 근거 링크부터 확인하고, 실제로 먹을 항목만 고르세요. 고른 항목을 절약형·일반형·여유형 중 자신의 식사 계획에 맞는 기준으로 비교하세요.

## 포함 범위를 정하는 기준

[절약형 하루 예산] [간식] House of Chin Fe 괌의 커피는 확인일 기준 2.50 USD이다. [공식 근거](https://chinfe.menuguam.com/menu)

[아침] House of Chin Fe 괌의 콘비프 볶음밥 조식은 14.50 USD이다. [공식 근거](https://chinfe.menuguam.com/menu)

맥도날드 콤보 식사 가격은 15.00 USD입니다. [공식 근거](https://www.numbeo.com/cost-of-living/in/Guam)

이 세 항목을 후보로 두고 비교하세요. 무엇을 포함할지 확인하세요. 한 끼 기준인지 결정하세요. 음료를 넣을지 선택하세요. 다시 확인하세요.

## 일반형 시나리오의 근거 비교

저렴한 레스토랑 한 끼는 25.00 USD입니다. [공식 근거](https://www.numbeo.com/cost-of-living/in/Guam)

## 여유형 시나리오의 근거 비교

뷔페 성인 가격은 43.00 USD입니다. [공식 근거](https://rootzguam.com/menu)`;
    const report = inspectBlogEditorialDeterministicallyV1({
      title: '괌 여행 식비 예산: 여행 방식별 예산 시나리오',
      markdown,
      intentType: 'food_budget',
      artifact: decisionArtifact(),
    });
    expect(report.passed).toBe(false);
    expect(report.failureReasons).toEqual(expect.arrayContaining([
      'internal_label_leak',
      'source_label_misleading',
      'reader_task_unanswered',
      'commodity_source_stitching',
      'decision_artifact_missing',
    ]));
  });

  it('inserts the deterministic answer table and passes the hard reader-answer contract', () => {
    const artifact = decisionArtifact();
    const output = applyBlogDecisionArtifactToWriterOutputV1({
      artifact,
      output: {
        markdown: `# ${artifact.resolvedTitle}

기존의 모호한 도입부입니다.

## 가격 근거

메뉴 가격은 각 링크에서 확인할 수 있습니다.`,
        claimLedger: [],
        ledgerIssues: [],
      },
    });
    const report = inspectBlogEditorialDeterministicallyV1({
      title: artifact.resolvedTitle,
      markdown: output.markdown,
      intentType: 'food_budget',
      artifact,
    });
    expect(report.passed).toBe(true);
    expect(output.markdown).toContain('14.50 + 15 + 25 + 2.50 = 57 USD');
    expect(output.claimLedger).toHaveLength(3);
  });

  it('hashes the exact prompt and rejects inconsistent semantic judge JSON', () => {
    const base = buildBlogPromptTraceV1({
      prompt: 'rendered prompt A',
      templateVersion: 'writer-v5',
      brief: { title: '괌 식비' },
      claimPacket: ['c1'],
      model: 'deepseek-v4-pro',
      temperature: 0,
      stage: 'rewrite_pro_high',
      gitCommitSha: 'abc123',
    });
    const changed = buildBlogPromptTraceV1({
      prompt: 'rendered prompt B',
      templateVersion: 'writer-v5',
      brief: { title: '괌 식비' },
      claimPacket: ['c1'],
      model: 'deepseek-v4-pro',
      temperature: 0,
      stage: 'rewrite_pro_high',
      gitCommitSha: 'abc123',
    });
    expect(base.renderedPromptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(changed.renderedPromptHash).not.toBe(base.renderedPromptHash);
    expect(() => parseBlogEditorialJudgeReportV1(JSON.stringify({
      passed: true,
      dimensions: Object.fromEntries([
        'usefulness', 'naturalKorean', 'completeness', 'originality', 'sourceHonesty',
      ].map((key) => [key, { passed: key !== 'usefulness', reason: '판정 근거' }])),
      failureReasons: [],
    }))).toThrow('blog_editorial_judge_inconsistent_pass');
  });

  it('builds and deterministically inserts an answer-first airport route decision', () => {
    const bundle = foodBundle();
    bundle.claims = [
      { ...bundle.claims[0]!, claimText: 'GRTA Route 14의 1회 승차 요금은 1.50 USD입니다.', claimType: 'price' },
      { ...bundle.claims[1]!, claimText: '카카오 T 괌택시는 24kg 캐리어 3~4개 적재를 안내합니다.', claimType: 'factual' },
      { ...bundle.claims[2]!, claimText: '카카오 T 괌택시는 비행편명을 입력하면 항공 지연 때 도착 시간을 확인합니다.', claimType: 'factual' },
    ];
    const artifact = buildBlogDecisionArtifactV1({
      title: '괌 공항에서 투몬까지 이동수단',
      question: '괌 공항 투몬 교통',
      primaryDecision: '지금 어떤 이동수단을 고르는가?',
      intentType: 'airport_transport',
      bundle,
    });
    const output = applyBlogDecisionArtifactToWriterOutputV1({
      artifact,
      output: {
        markdown: '# 괌 공항에서 투몬까지 이동수단\n\n무엇을 확인할지 먼저 고르세요.\n\n## 승차 전\n\n공식 안내를 확인합니다.',
        claimLedger: [],
        ledgerIssues: [],
      },
    });

    expect(artifact.promiseType).toBe('route_decision');
    expect(artifact.directAnswer).toContain('GRTA');
    expect(artifact.directAnswer).toContain('카카오 T 괌택시');
    expect(artifact.directAnswer).not.toContain('Route 14');
    expect(artifact.resolvedTitle).toBe('괌 공항 투몬 교통: GRTA 요금·운행 근거와 괌택시 수하물·지연 대응');
    expect(output.markdown).not.toContain('무엇을 확인할지 먼저 고르세요.');
    expect(output.markdown).toContain(artifact.directAnswer);
    expect(artifact.gaps).toEqual(expect.arrayContaining([
      expect.stringContaining('택시 기본요금'),
      expect.stringContaining('실제 소요시간'),
    ]));
  });

  it('restricts rewrite decision facts to the approved subset', () => {
    const artifact = decisionArtifact();
    const restricted = restrictBlogDecisionArtifactFactsV1(artifact, [{
      claimText: artifact.publicFacts[0]!.claimText,
    }]);

    expect(restricted.publicFacts).toEqual([artifact.publicFacts[0]]);
    expect(restricted.directAnswer).toBe(artifact.directAnswer);
  });
});
