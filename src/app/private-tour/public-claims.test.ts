import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('private-tour public claims', () => {
  it('does not render mock reception activity or unsupported cumulative volume', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/private-tour/page.tsx'), 'utf8');

    for (const unsupportedClaim of [
      'MOCK_FEED',
      '120+',
      '누적 진행',
      '최근 접수 현황',
      '방금 전',
      '확정 완료',
    ]) {
      expect(page).not.toContain(unsupportedClaim);
    }
  });
});
