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
});
