import { describe, expect, it } from 'vitest';
import { normalizeUploadTitle, shouldReplaceUploadTitle } from './title-normalization';

describe('upload title normalization', () => {
  it('replaces cash receipt notice titles with deterministic product titles', () => {
    expect(shouldReplaceUploadTitle(
      '현금영수증 발급 안내 드립니다',
      'BX후쿠오카 파라다이스 골프 패키지 54H 초석 2박3일',
    )).toBe(true);

    expect(normalizeUploadTitle(
      '현금영수증 발급 안내 드립니다',
      'BX후쿠오카 파라다이스 골프 패키지 54H 초석 2박3일',
    )).toBe('BX후쿠오카 파라다이스 골프 패키지 54H 초석 2박3일');
  });

  it('keeps valid product titles unchanged', () => {
    expect(normalizeUploadTitle(
      'BX후쿠오카 파라다이스 골프 패키지 54H 초석 2박3일',
      '다른 후보',
    )).toBe('BX후쿠오카 파라다이스 골프 패키지 54H 초석 2박3일');
  });

  it('prefers the document product title over a dated HWP source label', () => {
    expect(normalizeUploadTitle(
      '[0813] VJ 멜리아빈펄 5일_0626',
      '[에어텔] 멜리아 빈펄 푸꾸옥 (북부) 3박 5일 [비엣젯항공]',
    )).toBe('[에어텔] 멜리아 빈펄 푸꾸옥 (북부) 3박 5일 [비엣젯항공]');
  });

  it('prefers the document product title over a sale-ticketing source label', () => {
    expect(normalizeUploadTitle(
      '[★LJ-599특가] 다낭 7~8월 599 스팟특가-0626발권',
      '[LJ] 다낭/호이안 3박5일 노팁노옵션',
    )).toBe('[LJ] 다낭/호이안 3박5일 노팁노옵션');
  });
});
