import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const verifier = readFileSync(join(
  process.cwd(),
  'scripts/verify-blog-production-readiness-v3.ts',
), 'utf8');

describe('blog production readiness script contract', () => {
  it('requires every runtime and medication-policy migration before live mode', () => {
    for (const version of [
      '20260606115000',
      '20260811132017',
      '20260811132023',
      '20260811132031',
      '20260811132037',
      '20260811210920',
      '20260814001600',
      '20260814011000',
      '20260814012500',
      '20260814033000',
      '20260815093943',
    ]) {
      expect(verifier).toContain(`'${version}'`);
    }
  });
});
