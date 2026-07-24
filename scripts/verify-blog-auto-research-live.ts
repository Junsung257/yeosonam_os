#!/usr/bin/env tsx

import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

type Fixture = {
  intent: string;
  topic: string;
  category: string;
  microAngle?: string;
  travelerNationality?: string;
};

const FIXTURES: Fixture[] = [
  {
    intent: 'food_budget',
    topic: '괌 식비 예산과 끼니별 실제 가격 2026',
    category: 'food',
    microAngle: 'food_budget',
  },
  {
    intent: 'monthly_weather',
    topic: '괌 7월 날씨 기온 강수량 옷차림',
    category: 'weather',
    microAngle: 'weather_packing',
  },
  {
    intent: 'airport_transport',
    topic: '괌 공항에서 투몬까지 택시 셔틀 렌터카 요금과 시간',
    category: 'transport',
    microAngle: 'airport_arrival',
  },
  {
    intent: 'hotel_areas',
    topic: '괌 호텔 위치별 1박 예산과 숙소 지역 비교',
    category: 'hotel',
    microAngle: 'hotel_area',
  },
  {
    intent: 'family_budget',
    topic: '괌 성인 2명 아이 2명 4박 5일 가족여행 경비',
    category: 'family',
    microAngle: 'budget_family',
  },
  {
    intent: 'itinerary',
    topic: '괌 아이 동반 4박 5일 일정과 이동시간',
    category: 'itinerary',
    microAngle: 'kid_friendly',
  },
  {
    intent: 'shopping_souvenirs',
    topic: '괌 기념품 품목별 가격과 구매 매장',
    category: 'shopping',
    microAngle: 'shopping_budget',
  },
  {
    intent: 'currency_payment',
    topic: '괌 달러 환전 카드 현금 결제 수수료',
    category: 'currency',
  },
  {
    intent: 'entry_requirements',
    topic: '대한민국 여권 괌 관광 입국 비자 전자신고 세관 조건',
    category: 'entry',
    travelerNationality: '대한민국',
  },
  {
    intent: 'travel_insurance',
    topic: '괌 여행보험 의료비 항공지연 수하물 면책 청구서류',
    category: 'insurance',
  },
];

function argValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(name);
}

async function runWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await task(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

async function main(): Promise<void> {
  const destination = argValue('--destination', '괌');
  const locale = argValue('--locale', 'ko-KR');
  const concurrency = Math.max(1, Math.min(3, Number(argValue('--concurrency', '2')) || 2));
  const selected = argValue('--intent', '');
  const fixtures = selected
    ? FIXTURES.filter((fixture) => fixture.intent === selected)
    : FIXTURES;
  if (fixtures.length === 0) throw new Error(`Unknown --intent: ${selected}`);

  const [
    { buildBlogContentBrief },
    { researchBlogInformationAutomatically },
    {
      BLOG_INFORMATION_RESEARCH_META_KEY,
      evaluateBlogGenerationResearchReadiness,
    },
  ] = await Promise.all([
    import('../src/lib/blog-content-brief'),
    import('../src/lib/blog-auto-research'),
    import('../src/lib/blog-generation-research'),
  ]);

  const startedAt = new Date();
  const rows = await runWithConcurrency(fixtures, concurrency, async (fixture, index) => {
    const brief = buildBlogContentBrief({
      topic: fixture.topic,
      destination,
      primaryKeyword: fixture.topic,
      category: fixture.category,
      source: 'live_research_verification',
      microAngle: fixture.microAngle,
      locale,
      travelerNationality: fixture.travelerNationality,
    });
    const contentKey = `live-research-${fixture.intent}-${startedAt.toISOString().slice(0, 10)}-${index + 1}`;
    const researched = brief.intentType === fixture.intent && brief.passed
      ? await researchBlogInformationAutomatically({
          contentKey,
          destination,
          locale,
          brief,
          now: startedAt,
        })
      : null;
    const readiness = researched?.bundle
      ? evaluateBlogGenerationResearchReadiness({
          meta: { [BLOG_INFORMATION_RESEARCH_META_KEY]: researched.bundle },
          expectedContentKey: contentKey,
          destination,
          intent: brief.intentType,
          locale,
          sourcePolicy: brief.sourcePolicy,
          now: startedAt,
        })
      : null;
    return {
      expectedIntent: fixture.intent,
      inferredIntent: brief.intentType,
      briefPassed: brief.passed,
      requiresHumanReview: brief.requiresHumanReview,
      researchPassed: researched?.passed ?? false,
      readinessPassed: readiness?.passed ?? false,
      sourceCount: readiness?.summary.sourceCount ?? 0,
      evidenceCount: readiness?.summary.evidenceCount ?? 0,
      claimCount: readiness?.summary.claimCount ?? 0,
      claimSourceCoverage: readiness?.summary.claimSourceCoverage ?? 0,
      distinctNormalizedValueCount: readiness?.summary.distinctNormalizedValueCount ?? 0,
      groundingSourceCount: researched?.groundingSourceCount ?? 0,
      directSourceCount: researched?.directSourceCount ?? 0,
      directSourceFailures: researched?.directSourceFailures ?? [],
      searchQueryCount: researched?.searchQueries.length ?? 0,
      observedSourceTypes: researched?.observedSourceTypes ?? [],
      observedGroundingChunkIndexes: researched?.observedGroundingChunkIndexes ?? [],
      observedSources: researched?.observedSources ?? [],
      finishReason: researched?.finishReason ?? null,
      responseTextLength: researched?.responseTextLength ?? 0,
      sourceUrls: researched?.bundle?.sources.map((source) => source.sourceUrl).filter(Boolean) ?? [],
      claimTypeCounts: Object.fromEntries(
        [...new Set((researched?.bundle?.claims ?? []).map((claim) => claim.claimType))]
          .map((claimType) => [
            claimType,
            researched?.bundle?.claims.filter((claim) => claim.claimType === claimType).length ?? 0,
          ]),
      ),
      claimSamples: (researched?.bundle?.claims ?? []).slice(0, 12).map((claim) => ({
        claimType: claim.claimType,
        claimText: claim.claimText,
        normalizedValue: claim.extractedValue?.normalizedValue ?? null,
      })),
      issues: [
        ...brief.issues,
        ...(researched?.issues ?? []),
        ...(readiness?.issues ?? []),
      ].filter((value, issueIndex, all) => all.indexOf(value) === issueIndex),
    };
  });

  const passed = rows.filter((row) => row.readinessPassed).length;
  const report = {
    checkedAt: startedAt.toISOString(),
    destination,
    locale,
    total: rows.length,
    passed,
    failed: rows.length - passed,
    rows,
  };
  console.log(JSON.stringify(report, null, 2));
  if (hasFlag('--strict') && passed !== rows.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
