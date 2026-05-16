import { describe, it, expect } from 'vitest';
import { destinationLookupKeys } from '@/lib/destination-climate-lookup';

/**
 * 박제 사유 (2026-05-16):
 *   - 모바일 상세에서 "계림/양삭" 같이 시드 키와 어긋난 destination 이 들어오면
 *     날씨·시차·짐싸기 카드 3종이 통째로 사라지던 사고.
 *   - lookup 폴백이 (a) 입력 그대로, (b) 구분자 정규화, (c) 첫 토큰 까지 시도하는지
 *     박는다. 새 폴백 추가는 OK, 기존 폴백 제거는 사고 직행.
 */
describe('destinationLookupKeys', () => {
  it('always tries the raw input first', () => {
    expect(destinationLookupKeys('계림/양삭')[0]).toBe('계림/양삭');
  });

  it('falls back to the first slash-separated token', () => {
    const keys = destinationLookupKeys('계림/양삭');
    expect(keys).toContain('계림');
  });

  it('normalises comma + ㆍ + · separators to slash', () => {
    const keys = destinationLookupKeys('다낭, 호이안');
    expect(keys).toContain('다낭/호이안');
    expect(keys).toContain('다낭');
  });

  it('strips brackets so "일본 (시모노세키, 후쿠오카)" can fall back to "일본"', () => {
    const keys = destinationLookupKeys('일본 (시모노세키, 후쿠오카)');
    expect(keys.some(k => /일본/.test(k) && !/\(/.test(k))).toBe(true);
    expect(keys).toContain('일본');
  });

  it('deduplicates identical keys', () => {
    const keys = destinationLookupKeys('서안');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('survives empty / whitespace-only inputs without crashing', () => {
    expect(destinationLookupKeys('   ').length).toBeLessThanOrEqual(1);
  });
});
