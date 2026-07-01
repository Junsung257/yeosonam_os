import { describe, expect, it } from 'vitest';
import { normalizeBlogTitle } from './blog-quality-normalizer';

describe('blog quality normalizer', () => {
  it('collapses adjacent duplicate title tokens', () => {
    expect(normalizeBlogTitle('여행 준비 여행 여행 가이드 2026')).toBe('여행 준비 여행 가이드 2026');
    expect(normalizeBlogTitle('나가사키 나가사키 여행 가이드')).toBe('나가사키 여행 가이드');
  });
});
