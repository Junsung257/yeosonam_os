import { describe, expect, it } from 'vitest';
import {
  buildArticleBrief,
  buildInfoEvidencePack,
  buildProductFactPack,
  buildTravelOfficialSourceCandidates,
  formatInfoEvidencePromptBlock,
  generateArticleContract,
  mergeFactIntegrityResults,
  renderArticleMarkdown,
  validateArticleContract,
  validateRenderedArticleFacts,
} from './blog-engine-v2';

const product = {
  id: 'pkg_123456',
  title: '다낭 3박 5일 패키지',
  destination: '다낭',
  duration: 5,
  nights: 3,
  price: 899000,
  price_dates: [
    { date: '2026-07-01', price: 899000, confirmed: true },
    { date: '2026-07-08', price: 929000, confirmed: false },
  ],
  confirmed_dates: ['2026-07-01'],
  departure_days: '수',
  seats_confirmed: 12,
  airline: '대한항공',
  departure_airport: '인천',
  inclusions: ['왕복 항공권', '호텔 숙박', '일정표 내 식사'],
  excludes: ['개인 경비', '여행자 보험'],
  product_highlights: ['바나힐 포함', '호이안 야경 일정'],
  itinerary: ['1일차 인천 출발', '2일차 바나힐 관광', '3일차 호이안 야경', '4일차 자유시간', '5일차 인천 도착'],
  optional_tours: ['마사지 선택관광'],
  notices_parsed: [{ items: ['출발일별 가격 변동 가능'] }],
};

describe('blog-engine-v2 product pipeline', () => {
  it('builds a product fact pack from travel_packages data', () => {
    const pack = buildProductFactPack(product);

    expect(pack.blockers).toEqual([]);
    expect(pack.productId).toBe('pkg_123456');
    expect(pack.priceLabel).toBe('899,000원~');
    expect(pack.durationLabel).toBe('3박 5일');
    expect(pack.departureSummary.availableDateCount).toBeGreaterThanOrEqual(2);
    expect(pack.departureSummary.confirmedDateCount).toBeGreaterThanOrEqual(1);
    expect(pack.departureSummary.nextDepartureDate).toBe('2026-07-01');
    expect(pack.departureSummary.nextConfirmedDepartureDate).toBe('2026-07-01');
    expect(pack.departureSummary.lowestPriceDateLabels[0]).toContain('2026-07-01');
    expect(pack.departureSummary.departureDaysLabel).toBe('수');
    expect(pack.departureSummary.seatsConfirmed).toBe(12);
    expect(pack.facts.some((fact) => fact.id === 'travel_packages.price')).toBe(true);
    expect(pack.facts.some((fact) => fact.id === 'travel_packages.departure_summary')).toBe(true);
  });

  it('blocks product generation when required commerce facts are missing', () => {
    const pack = buildProductFactPack({ ...product, price: null, price_dates: [] });

    expect(pack.blockers).toContain('missing_price');
  });

  it('renders a canonical product article without unsupported price claims', () => {
    const pack = buildProductFactPack(product);
    const brief = buildArticleBrief(pack, { kind: 'product_article', angleType: 'value' });
    const article = generateArticleContract(brief);
    const markdown = renderArticleMarkdown(article, pack);
    const integrity = mergeFactIntegrityResults(
      validateArticleContract(article, pack),
      validateRenderedArticleFacts(markdown, pack),
    );

    expect(markdown).toContain('/packages/pkg_123456');
    expect(markdown).toContain('출발 계산');
    expect(markdown).toContain('2026-07-01');
    expect(markdown).toContain('포함사항');
    expect(markdown).toContain('불포함사항');
    expect(markdown).not.toContain('숨은 비용 없음');
    expect(integrity.passed).toBe(true);
  });

  it('renders answer-first sections for AEO extraction', () => {
    const pack = buildProductFactPack(product);
    const brief = buildArticleBrief(pack, { kind: 'product_article', angleType: 'value' });
    const article = generateArticleContract(brief);
    const markdown = renderArticleMarkdown(article, pack);

    expect(markdown).toContain('## 핵심 답변');
    expect(markdown).toContain('**답변:**');
    expect(markdown).toMatch(/^## .+\?$/m);
    expect(markdown.indexOf('## 핵심 답변')).toBeLessThan(markdown.indexOf('## 한눈에'));
  });

  it('fails fact integrity for unsupported money claims', () => {
    const pack = buildProductFactPack(product);
    const result = validateRenderedArticleFacts('이 상품은 1,500,000원 절약 가능합니다.', pack);

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('unsupported_money_claim');
    expect(result.issues.map((issue) => issue.code)).toContain('unsupported_product_claim');
  });
});

describe('blog-engine-v2 info source evidence', () => {
  it('builds official source candidates for fresh travel topics', () => {
    const sources = buildTravelOfficialSourceCandidates({
      topic: '다낭 8월 날씨와 입국 준비',
      destination: '다낭',
      freshnessTopics: ['weather', 'visa_entry'],
      sourceRequirements: ['공식 출처 확인 필요'],
    });

    expect(sources.some((source) => source.url.includes('0404.go.kr'))).toBe(true);
    expect(sources.some((source) => source.url.includes('weather.go.kr'))).toBe(true);
  });

  it('formats source evidence prompt and blocks missing trusted sources', () => {
    const pack = buildInfoEvidencePack('다낭 입국 준비', [
      {
        title: '외교부 해외안전여행',
        url: 'https://www.0404.go.kr/',
        summary: '국가별 안전과 입국 유의사항',
        official: true,
      },
    ]);
    const prompt = formatInfoEvidencePromptBlock(pack);

    expect(pack.blockers).toEqual([]);
    expect(prompt).toContain('Source Evidence');
    expect(prompt).toContain('https://www.0404.go.kr/');
  });
});
