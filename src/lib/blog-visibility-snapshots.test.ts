import { describe, expect, it } from 'vitest';

import { googleInspectionToIndexStatus } from './blog-visibility-snapshots';

describe('googleInspectionToIndexStatus', () => {
  it('classifies a positive PASS inspection as indexed', () => {
    expect(googleInspectionToIndexStatus({
      verdict: 'PASS',
      coverage_state: 'Submitted and indexed',
      page_fetch_state: 'SUCCESSFUL',
    })).toBe('indexed');
  });

  it('does not treat the Korean not-indexed phrase as indexed', () => {
    expect(googleInspectionToIndexStatus({
      verdict: 'NEUTRAL',
      coverage_state: '발견됨 - 현재 색인이 생성되지 않음',
      page_fetch_state: 'UNKNOWN',
    })).toBe('not_indexed');
  });

  it('fails a contradictory PASS verdict closed when coverage is negative', () => {
    expect(googleInspectionToIndexStatus({
      verdict: 'PASS',
      coverage_state: '발견됨 - 현재 색인이 생성되지 않음',
    })).toBe('not_indexed');
  });

  it.each([
    ['FAIL', 'Crawled - currently not indexed', 'not_indexed'],
    ['NEUTRAL', 'URL is unknown to Google', 'not_indexed'],
    ['NEUTRAL', 'Blocked by robots.txt', 'blocked'],
    ['PASS', 'Submitted and indexed', 'indexed'],
  ])('classifies English %s/%s as %s', (verdict, coverageState, expected) => {
    expect(googleInspectionToIndexStatus({
      verdict,
      coverage_state: coverageState,
    })).toBe(expected);
  });
});
