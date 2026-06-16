import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('packages DetailClient flight rendering', () => {
  it('does not hide detailed itinerary flight cards just because a top flight header exists', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/packages/[id]/DetailClient.tsx'), 'utf8');

    expect(source).toContain("if (item.type === 'flight' && isFirstOrLastDay && !isArrivalOnlyFlight)");
    expect(source).toContain("const isArrivalOnlyFlight =");
    expect(source).not.toContain("hasCanonicalFlightHeader && item.type === 'flight'");
  });
});
