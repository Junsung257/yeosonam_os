import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readScript(name: string): string {
  return readFileSync(join(process.cwd(), 'scripts', name), 'utf8');
}

describe('upload batch commercial metadata boundary', () => {
  it('allows registration from the raw inbox script only for one single-product source', () => {
    const script = readScript('register-upload-inbox.ts');

    expect(script).toContain("from '@/lib/product-registration/catalog-split-recovery'");
    expect(script).toContain('registrationCandidates.length !== 1');
    expect(script).toContain('candidate.products !== 1');
    expect(script).toContain('여러 파일 또는 다중상품 HWP 배치 등록은 금지');
  });

  it('allows report replay registration only for one eligible single-product source', () => {
    const script = readScript('register-upload-inbox-from-report.ts');

    expect(script).toContain('registrationCandidates.length > 1');
    expect(script).toContain('row.productCount !== 1');
    expect(script).toContain('여러 파일 또는 다중상품 HWP 배치 등록은 금지');
  });
});
