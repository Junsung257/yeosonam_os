import { describe, expect, it } from 'vitest';
import { keywordSimilarity, normalizeKeyword, tokenizeKeyword } from './blog-longtail-expander';

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
});
