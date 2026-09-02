import { describe, expect, it } from 'vitest';
import {
  buildBlogResearchBundleFromGrounding,
  buildWmoMonthlyWeatherPayload,
} from './blog-auto-research';
import { buildBlogContentBrief } from './blog-content-brief';
import {
  buildWeatherQueueVariation,
  buildMicroAnglePrimaryKeyword,
  countPublishableQueueCandidates,
  loadQueueDemandSignalMapV3,
  MIN_PUBLISHABLE_BUFFER_DAYS,
  SCHEDULE_OCCUPYING_QUEUE_STATUSES,
} from './blog-scheduler';

function researchedTokyoWeatherMeta(
  destination = '도쿄',
  contentKey = 'tokyo-weather-packing',
) {
  const sourceUrl = 'https://worldweather.wmo.int/kr/json/183_kr.xml';
  const climateMonth = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    maxTemp: String(10 + index),
    minTemp: String(2 + index),
    raindays: String(5 + index),
    rainfall: String(30 + index),
  }));
  const pages = [{
    url: sourceUrl,
    title: 'WMO Tokyo climate',
    text: JSON.stringify({
      city: {
        cityName: destination,
        member: { memName: '일본', orgName: '일본 기상청' },
        climate: { datab: 1991, datae: 2020, climateMonth },
      },
    }),
  }];
  const payload = buildWmoMonthlyWeatherPayload(pages, destination);
  const brief = buildBlogContentBrief({
    topic: '도쿄 7월 날씨와 옷차림 준비물 체크',
    destination,
    primaryKeyword: '도쿄 날씨 옷차림 준비물',
    category: 'preparation',
    microAngle: 'weather_packing',
  });
  const result = buildBlogResearchBundleFromGrounding({
    contentKey,
    destination,
    locale: brief.plan.locale,
    brief,
    payload: payload!,
    groundingChunks: [{ web: { uri: sourceUrl, title: 'WMO Tokyo climate' } }],
    directSourceUrls: [sourceUrl],
    officialRegistry: [{
      id: 'wmo',
      hostname: 'worldweather.wmo.int',
      sourceType: 'meteorological_agency',
      authorityLevel: 'official_primary',
      allowSubdomains: false,
    }],
    now: new Date(),
  });
  if (!result.bundle) throw new Error(result.issues.join(','));
  return {
    writer_type: 'info_writer',
    gsc_impressions: 120,
    micro_angle: 'weather_packing',
    expected_slug: contentKey,
    information_research_bundle: result.bundle,
  };
}

describe('blog scheduler queue refill helpers', () => {
  it('lets skipped and failed rows release their old future slots', () => {
    expect(SCHEDULE_OCCUPYING_QUEUE_STATUSES).toEqual(['queued', 'generating']);
    expect(SCHEDULE_OCCUPYING_QUEUE_STATUSES).not.toContain('skipped');
    expect(SCHEDULE_OCCUPYING_QUEUE_STATUSES).not.toContain('failed');
  });

  it('keeps English micro-angle ids out of reader-facing keywords', () => {
    const keyword = buildMicroAnglePrimaryKeyword('발리', { keywordSuffix: '가족여행 예산' });

    expect(keyword).toBe('발리 가족여행 예산');
    expect(keyword).not.toMatch(/family budget|transport cost|hotel area budget|weather packing|local mobility/i);
  });

  it('keeps at least a three-day publishable buffer for daily automation', () => {
    expect(MIN_PUBLISHABLE_BUFFER_DAYS).toBeGreaterThanOrEqual(3);
  });

  it('assigns stable editorial variation metadata for weather refill candidates', () => {
    const first = buildWeatherQueueVariation('서울', 7);
    const second = buildWeatherQueueVariation('서울', 7);
    const other = buildWeatherQueueVariation('오사카', 7);

    expect(first).toEqual(second);
    expect(first.contract_version).toBe(3);
    expect(first.reader_scenario).toMatch(/packer|rain|walking|arrival/);
    expect(first.opening_variant).toMatch(/temperature|rain|clothing|packing/);
    expect(first.section_order_variant).toMatch(/weather|clothing|decision|packing/);
    expect(new Set([first.reader_scenario, other.reader_scenario]).size).toBeGreaterThanOrEqual(1);
  });

  it('does not collapse a destination fleet into one weather structure', () => {
    const destinations = [
      '런던',
      '쿠알라룸푸르',
      '호치민',
      '코타키나발루',
      '하노이',
      '서울',
      '오사카',
      '파리',
      '삿포로',
      '도쿄',
      '후쿠오카',
      '오키나와',
      '괌',
    ];
    const variations = destinations.map((destination) => buildWeatherQueueVariation(destination, 7));
    const countValues = (values: string[]) => [...values.reduce((counts, value) => {
      counts.set(value, (counts.get(value) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()).values()];
    const openingCounts = countValues(variations.map((item) => item.opening_variant));
    const sectionCounts = countValues(variations.map((item) => item.section_order_variant));
    const headingOrderCounts = countValues(
      variations.map((item) => `${item.heading_copy_variant}:${item.section_order_variant}`),
    );

    expect(new Set(variations.map((item) => item.opening_variant)).size).toBe(4);
    expect(new Set(variations.map((item) => item.section_order_variant)).size).toBe(4);
    expect(new Set(variations.map((item) => item.heading_copy_variant)).size).toBeGreaterThanOrEqual(7);
    expect(Math.max(...openingCounts)).toBeLessThanOrEqual(5);
    expect(Math.max(...sectionCounts)).toBeLessThanOrEqual(5);
    expect(Math.max(...headingOrderCounts)).toBeLessThanOrEqual(2);
  });

  it('counts different micro-angles for the same destination as separate publishable candidates', () => {
    const stats = countPublishableQueueCandidates({
      recentPublished: [
        { destination: '발리', angle_type: 'value', generation_meta: { micro_angle: 'budget_family' } },
      ],
      activeQueue: [
        { destination: '발리', angle_type: 'value', meta: { micro_angle: 'budget_family' } },
        { destination: '발리', angle_type: 'value', meta: { micro_angle: 'transport_cost' } },
        { destination: '발리', angle_type: 'value', meta: { micro_angle: 'transport_cost' } },
        { source: 'pillar', topic: '발리 완전 가이드', meta: { expected_slug: 'bali-complete-guide' } },
      ],
    });

    expect(stats).toEqual({
      publishableCount: 0,
      blockedRecentDuplicate: 1,
      duplicateQueued: 1,
      evidenceInsufficient: 0,
      productOpenContractBlocked: 0,
      destinationlessInfoBlocked: 0,
      candidateContractBlocked: 0,
      researchNotReady: 1,
      demandMissing: 0,
    });
  });

  it('separates writer type and product dedup keys in publishable candidate counting', () => {
    const stats = countPublishableQueueCandidates({
      recentPublished: [],
      activeQueue: [
        { destination: '발리', angle_type: 'value', meta: { micro_angle: 'budget_family', writer_type: 'info_writer' } },
        { destination: '발리', angle_type: 'value', meta: { micro_angle: 'budget_family', writer_type: 'product_consultant_writer', product_dedup_key: 'pkg|2026-07-01|5d|YSN', active_product_relation_verified: true } },
        { destination: '발리', angle_type: 'value', meta: { micro_angle: 'budget_family', writer_type: 'product_consultant_writer', product_dedup_key: 'pkg|2026-07-01|5d|YSN', active_product_relation_verified: true } },
        { destination: '발리', angle_type: 'value', meta: { micro_angle: 'transport_cost', evidence_insufficient: true } },
      ],
    });

    expect(stats).toEqual({
      publishableCount: 1,
      blockedRecentDuplicate: 0,
      duplicateQueued: 1,
      evidenceInsufficient: 1,
      productOpenContractBlocked: 0,
      destinationlessInfoBlocked: 0,
      candidateContractBlocked: 0,
      researchNotReady: 1,
      demandMissing: 0,
    });
  });

  it('excludes product rows blocked by the customer-open contract from publishable counts', () => {
    const stats = countPublishableQueueCandidates({
      recentPublished: [],
      activeQueue: [
        { product_id: 'pkg-ok', meta: { product_dedup_key: 'pkg-ok|2026-07-01|4d|YSN', active_product_relation_verified: true } },
        { product_id: 'pkg-blocked', meta: { failure_code: 'product_open_contract' } },
        { product_id: 'pkg-blocked-2', meta: { quarantine_reason: 'product_open_contract' } },
      ],
    });

    expect(stats).toEqual({
      publishableCount: 1,
      blockedRecentDuplicate: 0,
      duplicateQueued: 0,
      evidenceInsufficient: 0,
      productOpenContractBlocked: 2,
      destinationlessInfoBlocked: 0,
      candidateContractBlocked: 0,
      researchNotReady: 0,
      demandMissing: 0,
    });
  });

  it('keeps information candidates available for quota recovery when product rows are blocked', () => {
    const stats = countPublishableQueueCandidates({
      recentPublished: [],
      activeQueue: [
        { destination: '몽골', angle_type: 'value', meta: { writer_type: 'info_writer', micro_angle: 'weather_packing' } },
        { destination: '세부', angle_type: 'value', meta: { writer_type: 'info_writer', micro_angle: 'airport_arrival' } },
        { destination: '발리', angle_type: 'value', meta: { writer_type: 'info_writer', micro_angle: 'budget_family' } },
        { destination: '나트랑', angle_type: 'value', meta: { writer_type: 'info_writer', micro_angle: 'transport_cost' } },
        { product_id: 'pkg-blocked-1', meta: { failure_code: 'product_open_contract' } },
        { product_id: 'pkg-blocked-2', meta: { quarantine_reason: 'product_open_contract' } },
        { product_id: 'pkg-blocked-3', generation_meta: { failure_bucket: 'product_open_contract' } },
      ],
    });

    expect(stats.publishableCount).toBe(0);
    expect(stats.productOpenContractBlocked).toBe(3);
    expect(stats.evidenceInsufficient).toBe(0);
    expect(stats.researchNotReady).toBe(4);
    expect(stats.demandMissing).toBe(0);
  });

  it('excludes destinationless info candidates unless they are explicitly generic', () => {
    const stats = countPublishableQueueCandidates({
      recentPublished: [],
      activeQueue: [
        {
          topic: '여름 휴가철 해외여행 보험 꼭 필요한가요?',
          category: 'travel_tips',
          meta: { writer_type: 'info_writer' },
        },
        {
          topic: '여름 휴가철 해외여행 전화/데이터 로밍 vs 유심 비교',
          category: 'travel_tips',
          meta: { writer_type: 'info_writer', intentionally_generic: true },
        },
      ],
    });

    expect(stats).toEqual({
      publishableCount: 0,
      blockedRecentDuplicate: 0,
      duplicateQueued: 0,
      evidenceInsufficient: 0,
      productOpenContractBlocked: 0,
      destinationlessInfoBlocked: 1,
      candidateContractBlocked: 0,
      researchNotReady: 1,
      demandMissing: 0,
    });
  });

  it('excludes candidates that already violate title or slug readiness contracts', () => {
    const stats = countPublishableQueueCandidates({
      recentPublished: [],
      activeQueue: [
        {
          topic: '7\uC6D4 \uD638\uC8FC \uC2DC\uB4DC\uB2C8 \uC5EC\uD589, \uD55C\uAD6D\uACFC \uBC18\uB300! \uACA8\uC6B8 \uB0A0\uC528\uC640 \uC990\uAE38 \uAC70\uB9AC \u2014 \uCD1D\uC815\uB9AC',
          destination: '\uC2DC\uB4DC\uB2C8',
          meta: { writer_type: 'info_writer' },
        },
        {
          topic: '\uC2DC\uB4DC\uB2C8 \uACA8\uC6B8 \uB0A0\uC528\uC640 \uC637\uCC28\uB9BC \uCCB4\uD06C',
          destination: '\uC2DC\uB4DC\uB2C8',
          meta: { writer_type: 'info_writer', expected_slug: 'sydney-winter-weather' },
        },
      ],
    });

    expect(stats).toEqual({
      publishableCount: 0,
      blockedRecentDuplicate: 0,
      duplicateQueued: 0,
      evidenceInsufficient: 0,
      productOpenContractBlocked: 0,
      destinationlessInfoBlocked: 0,
      candidateContractBlocked: 1,
      researchNotReady: 1,
      demandMissing: 0,
    });
  });

  it('does not count an unresearched information seed as publish ready', () => {
    const stats = countPublishableQueueCandidates({
      recentPublished: [],
      activeQueue: [{
        destination: '도쿄',
        topic: '도쿄 7월 날씨와 옷차림 준비물 체크',
        category: 'preparation',
        angle_type: 'value',
        meta: {
          writer_type: 'info_writer',
          micro_angle: 'weather_packing',
          expected_slug: 'tokyo-weather-packing',
        },
      }],
    });

    expect(stats.publishableCount).toBe(0);
    expect(stats.researchNotReady).toBe(1);
    expect(stats.demandMissing).toBe(0);
  });

  it('counts an exact, current research bundle as publish ready', () => {
    const stats = countPublishableQueueCandidates({
      recentPublished: [],
      activeQueue: [{
        destination: '도쿄',
        topic: '도쿄 7월 날씨와 옷차림 준비물 체크',
        primary_keyword: '도쿄 날씨 옷차림 준비물',
        category: 'preparation',
        angle_type: 'value',
        meta: researchedTokyoWeatherMeta(),
      }],
    });

    expect(stats.publishableCount).toBe(1);
    expect(stats.researchNotReady).toBe(0);
    expect(stats.demandMissing).toBe(0);
  });

  it('quarantines an old canonical representative before a refill consumes a slot', () => {
    const stats = countPublishableQueueCandidates({
      recentPublished: [],
      activeRepresentativeKeys: new Set([
        'v1|\uB3C4\uCFC4|monthly_weather|general|ko-KR',
      ]),
      activeQueue: [{
        destination: '\uB3C4\uCFC4',
        topic: '\uB3C4\uCFC4 7\uC6D4 \uB0A0\uC528\uC640 \uC637\uCC28\uB9BC \uC900\uBE44\uBB3C \uCCB4\uD06C',
        primary_keyword: '\uB3C4\uCFC4 \uB0A0\uC528 \uC637\uCC28\uB9BC \uC900\uBE44\uBB3C',
        category: 'preparation',
        angle_type: 'value',
        meta: researchedTokyoWeatherMeta(),
      }],
    });

    expect(stats.publishableCount).toBe(0);
    expect(stats.blockedRecentDuplicate).toBe(1);
    expect(stats.researchNotReady).toBe(0);
    expect(stats.demandMissing).toBe(0);
  });

  it('recognizes the representative identity of legacy programmatic rows', () => {
    const stats = countPublishableQueueCandidates({
      recentPublished: [],
      activeRepresentativeKeys: new Set([
        'v1|세부|itinerary|couple|ko-KR',
      ]),
      activeQueue: [{
        destination: '세부',
        topic: '세부 신혼여행 추천 코스와 호텔',
        primary_keyword: '세부 신혼여행',
        category: 'travel_tips',
        angle_type: 'honeymoon',
        source: 'coverage_gap',
        meta: {
          programmatic_source_id: 'legacy-cebu-honeymoon',
          programmatic_angle: 'honeymoon',
        },
      }],
    });

    expect(stats.blockedRecentDuplicate).toBe(1);
    expect(stats.researchNotReady).toBe(0);
    expect(stats.demandMissing).toBe(0);
  });

  it('classifies ten researched coverage-gap weather rows without demand as non-publishable', () => {
    const activeQueue = Array.from({ length: 10 }, (_, index) => ({
      id: `weather-${index}`,
      destination: `도시-${index}`,
      topic: `도시-${index} 8월 날씨와 옷차림 준비물 체크`,
      primary_keyword: `도시-${index} 날씨 옷차림 준비물`,
      category: 'preparation',
      angle_type: 'value',
      source: 'coverage_gap',
      meta: {
        ...researchedTokyoWeatherMeta(`도시-${index}`, `city-${index}-weather-packing`),
        gsc_impressions: 0,
        expected_slug: `city-${index}-weather-packing`,
      },
    }));

    const stats = countPublishableQueueCandidates({ activeQueue, recentPublished: [] });

    expect(stats.publishableCount).toBe(0);
    expect(stats.demandMissing).toBe(10);
    expect(stats.researchNotReady).toBe(0);
  });

  it('consumes an exact observed query from the V3 performance repository as demand', async () => {
    const makeQuery = (table: string) => {
      const result = table === 'blog_search_performance'
        ? { data: [{ provider: 'google_search_console', query: '도쿄 날씨 옷차림 준비물', impressions: 120 }], error: null }
        : { data: [], error: null };
      const query: Record<string, any> = {
        select: () => query, in: () => query, gte: () => query, gt: () => query, limit: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return query;
    };
    const rows = [{
      id: 'queue-1',
      destination: '도쿄',
      primary_keyword: '도쿄 날씨 옷차림 준비물',
      topic: '도쿄 8월 날씨',
      meta: researchedTokyoWeatherMeta(),
    }];

    const signals = await loadQueueDemandSignalMapV3(rows, { from: makeQuery });

    expect(signals.get('queue-1')).toMatchObject({ gsc: true });
  });
});
