import { describe, expect, it } from 'vitest';
import {
  buildLongtailTopic,
  cleanCandidateKeyword,
  isObservedDemandSourceKind,
  isTravelRelevantKeyword,
  keywordSimilarity,
  normalizeKeyword,
  resolveObservedLongtailDisposition,
  tokenizeKeyword,
} from './blog-longtail-expander';

const osaka = '\uC624\uC0AC\uCE74';
const june = '6\uC6D4';
const weather = '\uB0A0\uC528';
const guide = '\uAC00\uC774\uB4DC';
const danang = '\uB2E4\uB0AD';
const exchange = '\uD658\uC804';
const tip = '\uD301';

describe('blog longtail keyword helpers', () => {
  it('normalizes Korean keywords without deleting Hangul', () => {
    expect(normalizeKeyword(`${osaka} ${june} ${weather} 2026!`)).toBe(`${osaka} ${june} ${weather}`);
  });

  it('tokenizes useful Korean terms and drops generic stop words', () => {
    expect(tokenizeKeyword(`${osaka} ${june} ${weather} ${guide}`)).toEqual([osaka, june, weather]);
  });

  it('detects reordered near-duplicate keywords', () => {
    expect(keywordSimilarity(`${osaka} ${june} ${weather}`, `${june} ${osaka} ${weather}`)).toBe(1);
  });

  it('does not merge unrelated destination keywords', () => {
    expect(keywordSimilarity(`${osaka} ${june} ${weather}`, `${danang} ${exchange} ${tip}`)).toBe(0);
  });

  it('rejects destinationless non-travel search terms before queue insertion', () => {
    expect(isTravelRelevantKeyword('의학정보', '의학정보 검색 의도 완전 정리', null)).toBe(false);
    expect(isTravelRelevantKeyword(`${osaka} ${weather}`, `${osaka} 날씨`, null)).toBe(true);
    expect(isTravelRelevantKeyword('의학정보', '의학정보 검색 의도 완전 정리', '서울')).toBe(true);
  });

  it('normalizes decomposed Hangul before a query enters the queue', () => {
    const decomposed = '몽골 여행 준비물 체크 리스트'.normalize('NFD');
    expect(cleanCandidateKeyword(decomposed)).toBe('몽골 여행 준비물 체크 리스트');
    expect(normalizeKeyword(decomposed)).toBe('몽골 여행 준비물 체크 리스트');
  });

  it('keeps the observed query as the topic instead of inventing a headline', () => {
    expect(buildLongtailTopic('시드니 날씨')).toBe('시드니 날씨');
    expect(buildLongtailTopic('몽골 여행 준비물 체크 리스트')).toBe('몽골 여행 준비물 체크 리스트');
    expect(buildLongtailTopic('다낭 10월 날씨')).not.toMatch(/가이드|완전|총정리|질문|체크포인트/);
  });

  it('auto-queues only an exact observed query, not title tokens or synthetic modifiers', () => {
    expect(isObservedDemandSourceKind('winner_query')).toBe(true);
    expect(isObservedDemandSourceKind('related_query')).toBe(false);
    expect(isObservedDemandSourceKind('modifier_variant')).toBe(false);
  });

  it('routes a winner query on its existing URL to material refresh instead of a new URL', () => {
    expect(resolveObservedLongtailDisposition({
      sourceKind: 'winner_query',
      seedSlug: 'mongolia-july-weather-clothes-checklist-2026',
    })).toBe('refresh_existing');
    expect(resolveObservedLongtailDisposition({
      sourceKind: 'winner_query',
      seedSlug: null,
    })).toBe('queue_supporting');
    expect(resolveObservedLongtailDisposition({
      sourceKind: 'modifier_variant',
      seedSlug: null,
    })).toBe('reject_unverified');
  });
});
