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

  it('never invents 김해 or 직항 when the source does not provide those facts', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/packages/[id]/DetailClient.tsx'), 'utf8');

    expect(source).not.toContain("pkg.departure_airport || '김해'");
    expect(source).not.toContain('>직항</span>');
    expect(source).toContain("|| pkg.departure_airport");
    expect(source).toContain("|| '출발공항'");
  });

  it('renders parsed customer notices directly on the detail surface', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/packages/[id]/DetailClient.tsx'), 'utf8');

    expect(source).toContain('extractCustomerNoticeCards(pkg.notices_parsed)');
    expect(source).toContain('<CustomerNoticeCards');
  });
});
