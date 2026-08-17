import { describe, expect, it } from 'vitest';

import { productSourceLineageHash } from './source-lineage-fingerprint';

describe('productSourceLineageHash', () => {
  it('matches formatting-only HWP/paste differences', () => {
    expect(productSourceLineageHash('출발일\t2026-04-17\n판매가 1,379,000원')).toBe(
      productSourceLineageHash('출발일  2026-04-17\r\n판매가\u00a01,379,000원'),
    );
  });

  it('does not hide a critical numeric difference', () => {
    expect(productSourceLineageHash('판매가 1,379,000원')).not.toBe(productSourceLineageHash('판매가 1,479,000원'));
  });

  it('returns null for empty presentation text', () => {
    expect(productSourceLineageHash(' \n\t')).toBeNull();
  });
});
