import { describe, expect, it } from 'vitest';
import {
  buildProgrammaticQueueMeta,
  evaluateProgrammaticPromotionReadiness,
  getBlogProgrammaticContract,
  readProgrammaticAudience,
  readProgrammaticExpectedSlug,
  readProgrammaticMicroAngle,
} from './blog-programmatic-contract';

const registry = [{ id: 'wmo', source_type: 'meteorological_agency' as const, status: 'active' }];
const cebuClimate = [{
  official_source_registry_id: 'wmo',
  source_url: 'https://worldweather.wmo.int/cebu',
  intents: ['monthly_weather'],
  destinations: ['세부'],
  status: 'active',
}];

function weatherReadiness(overrides: Partial<Parameters<typeof evaluateProgrammaticPromotionReadiness>[0]> = {}) {
  const topic = '세부 9월 날씨와 옷차림 완벽 가이드';
  const meta = buildProgrammaticQueueMeta({
    sourceId: 'pseo-cebu-weather',
    angle: 'weather',
    topic,
    month: 9,
  })!;
  return evaluateProgrammaticPromotionReadiness({
    topic,
    destination: '세부',
    primaryKeyword: '세부 9월 날씨',
    category: 'preparation',
    source: 'coverage_gap',
    angleType: 'weather',
    meta,
    activeRepresentativeKeys: new Set(),
    registries: registry,
    officialDocuments: cebuClimate,
    reputableSources: [],
    ...overrides,
  });
}

describe('programmatic blog promotion contract', () => {
  it('maps supported matrix angles to explicit intent and audience metadata', () => {
    expect(getBlogProgrammaticContract('weather')).toMatchObject({
      microAngle: 'weather_packing',
      audience: 'general',
    });
    expect(getBlogProgrammaticContract('honeymoon')).toMatchObject({
      microAngle: 'itinerary',
      audience: 'couple',
    });
    expect(getBlogProgrammaticContract('filial')).toMatchObject({
      microAngle: 'itinerary',
      audience: 'senior',
    });
    expect(getBlogProgrammaticContract('budget')).toBeNull();
  });

  it('enriches new and legacy programmatic rows with one deterministic contract', () => {
    const topic = '세부 신혼여행 추천 코스와 호텔';
    const meta = buildProgrammaticQueueMeta({
      sourceId: 'pseo-cebu-honeymoon',
      angle: 'honeymoon',
      topic,
    });

    expect(meta).toMatchObject({
      programmatic_angle: 'honeymoon',
      micro_angle: 'itinerary',
      audience: 'couple',
      expected_slug: 'cebu-itinerary',
    });
    const legacyMeta = { programmatic_source_id: 'legacy', programmatic_angle: 'honeymoon' };
    expect(readProgrammaticMicroAngle({ meta: legacyMeta })).toBe('itinerary');
    expect(readProgrammaticAudience({ meta: legacyMeta })).toBe('couple');
    expect(readProgrammaticExpectedSlug({ meta: legacyMeta, topic })).toBe('cebu-itinerary');
  });

  it('allows only source-covered candidates without an active representative', () => {
    expect(weatherReadiness()).toEqual({
      passed: true,
      reason: null,
      representativeKey: 'v1|세부|monthly_weather|general|ko-KR',
    });
    expect(weatherReadiness({ officialDocuments: [] })).toMatchObject({
      passed: false,
      reason: 'research_coverage_missing',
    });
    expect(weatherReadiness({
      activeRepresentativeKeys: new Set(['v1|세부|monthly_weather|general|ko-KR']),
    })).toMatchObject({
      passed: false,
      reason: 'active_representative_exists',
    });
  });

  it('keeps high-risk visa topics out of unattended promotion', () => {
    const topic = '일본 비자·입국 서류 필요 여부 정리';
    const meta = buildProgrammaticQueueMeta({
      sourceId: 'pseo-japan-visa',
      angle: 'visa',
      topic,
      existing: { traveler_nationality: 'KR' },
    })!;
    const result = evaluateProgrammaticPromotionReadiness({
      topic,
      destination: '일본',
      primaryKeyword: '일본 비자',
      category: 'entry_requirements',
      source: 'coverage_gap',
      angleType: 'visa',
      meta,
      activeRepresentativeKeys: new Set(),
      registries: [],
      officialDocuments: [],
      reputableSources: [],
    });

    expect(result).toMatchObject({ passed: false, reason: 'human_review_required' });
  });
});
