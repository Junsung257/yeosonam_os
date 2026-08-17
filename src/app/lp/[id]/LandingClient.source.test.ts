import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('LP trust badge source contract', () => {
  it('does not publish unsupported sales or support guarantees', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/lp/[id]/LandingClient.tsx'), 'utf8');

    expect(source).not.toContain('직판<br />최저가');
    expect(source).not.toContain('24시간<br />현지 지원');
    expect(source).toContain('출발일별<br />가격 확인');
    expect(source).toContain('예약 전<br />최종 확인');
  });
});
