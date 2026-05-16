import { describe, it, expect } from 'vitest';
import { safeDecodeSlug } from '@/lib/decode-slug';

/**
 * 박제 사유 (2026-05-16, ERR-blog-encoded-slug):
 *   - Next.js dynamic route가 한글 slug를 URL-encoded 상태(%EC%84%9D…)로 page handler에 전달했는데
 *     getPost()는 `.eq('slug', param)`을 그대로 호출 → DB의 한글 원본과 매칭 실패 → notFound() →
 *     정보성 블로그 25건 일괄 404 (5월 1~16일 발행 전부 사망).
 *   - decode-slug는 동일 사고 재발을 막는 최소 단위. encoded와 decoded 양쪽이 같은 결과를 내야 함.
 */
describe('safeDecodeSlug', () => {
  it('decodes URL-encoded Korean slug back to its DB form', () => {
    const encoded = '%EC%84%9D%EA%B0%80%EC%9E%A5-6%EC%9B%94-%EB%82%A0%EC%94%A8%EC%99%80-%EC%98%B7%EC%B0%A8%EB%A6%BC-%EC%99%84%EB%B2%BD-%EA%B0%80%EC%9D%B4%EB%93%9C';
    expect(safeDecodeSlug(encoded)).toBe('석가장-6월-날씨와-옷차림-완벽-가이드');
  });

  it('is idempotent on already-decoded Korean slug', () => {
    const decoded = '석가장-6월-날씨와-옷차림-완벽-가이드';
    expect(safeDecodeSlug(decoded)).toBe(decoded);
  });

  it('passes ASCII slug through unchanged', () => {
    expect(safeDecodeSlug('jeju-summer-2026')).toBe('jeju-summer-2026');
  });

  it('returns input as-is for malformed percent sequences (no throw)', () => {
    // 불완전한 % 시퀀스는 URIError를 던지므로 원문 반환이어야 한다 — 페이지가 죽지 않아야 함.
    const malformed = 'broken-%E8-tail';
    expect(safeDecodeSlug(malformed)).toBe(malformed);
  });

  it('handles empty and falsy-like values gracefully', () => {
    expect(safeDecodeSlug('')).toBe('');
  });
});
