import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function routeSourceWithoutComments() {
  const source = readFileSync(join(process.cwd(), 'src/app/api/packages/[id]/approve/route.ts'), 'utf8');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('package approve route customer delivery gate', () => {
  it('recomputes customer render readiness before any active status update', () => {
    const source = routeSourceWithoutComments();
    const deliveryIndex = source.indexOf('const delivery = evaluateCustomerDeliveryReadiness');
    const blockIndex = source.indexOf("if (publishGate.decision === 'block')");
    const activeIndex = source.search(/status:\s*'active'/);

    expect(deliveryIndex).toBeGreaterThanOrEqual(0);
    expect(blockIndex).toBeGreaterThan(deliveryIndex);
    expect(activeIndex).toBeGreaterThan(blockIndex);
  });

  it('returns final render claim coverage when approval is blocked', () => {
    const source = routeSourceWithoutComments();
    const blockIndex = source.indexOf("if (publishGate.decision === 'block')");
    const activeIndex = source.search(/status:\s*'active'/);
    const blockBody = source.slice(blockIndex, activeIndex);

    expect(blockBody).toContain('render_claim_coverage');
    expect(blockBody).toContain('delivery.renderClaimCoverage.unsupported');
    expect(blockBody).toContain('{ status: 409 }');
    expect(blockBody).toContain('customer_deliverable: delivery.customerDeliverable');
  });
});
