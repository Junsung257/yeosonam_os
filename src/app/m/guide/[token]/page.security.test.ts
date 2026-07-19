import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('mobile guide voucher scope', () => {
  it('uses the token voucher id and rechecks its booking ownership', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/m/guide/[token]/page.tsx'), 'utf8');

    expect(source).toContain('payload.voucherId');
    expect(source).toContain('await getVoucher(payload.voucherId)');
    expect(source).toContain('scopedVoucher?.booking_id === payload.bookingId');
  });
});
