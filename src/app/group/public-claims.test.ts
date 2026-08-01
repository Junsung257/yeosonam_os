import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('group public claims', () => {
  it('does not render mock reception activity or unsupported volume and response claims', () => {
    const groupSources = [
      readFileSync(join(process.cwd(), 'src/app/group/page.tsx'), 'utf8'),
      readFileSync(join(process.cwd(), 'src/app/group/GroupLandingClient.tsx'), 'utf8'),
    ].join('\n');

    for (const unsupportedClaim of [
      'MOCK_FEED',
      '120+',
      '누적 단체 진행',
      '최근 접수 현황',
      '방금 전',
      '확정 완료',
      '당일 내',
      '당일 견적',
    ]) {
      expect(groupSources).not.toContain(unsupportedClaim);
    }
  });
});
