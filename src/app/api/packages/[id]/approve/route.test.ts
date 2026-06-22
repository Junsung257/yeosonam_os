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
    const sourceVerifyIndex = source.indexOf('const sourceVerify = evaluateVerifyChecks');
    const deliveryIndex = source.indexOf('const delivery = evaluateCustomerDeliveryReadiness');
    const blockIndex = source.indexOf("if (publishGate.decision === 'block')");
    const activeIndex = source.indexOf("status:           'active'");

    expect(sourceVerifyIndex).toBeGreaterThanOrEqual(0);
    expect(deliveryIndex).toBeGreaterThanOrEqual(0);
    expect(deliveryIndex).toBeGreaterThan(sourceVerifyIndex);
    expect(blockIndex).toBeGreaterThan(deliveryIndex);
    expect(activeIndex).toBeGreaterThan(blockIndex);
  });

  it('blocks source audit failures before customer delivery approval', () => {
    const source = routeSourceWithoutComments();
    const sourceVerifyIndex = source.indexOf('const sourceVerify = evaluateVerifyChecks');
    const sourceRepairIndex = source.indexOf('const sourceRepairUpdates: Record<string, unknown> = {}');
    const sourceRepairBlockIndex = source.indexOf("if (sourceRepairActions.length > 0)");
    const sourceRepairReproofIndex = source.indexOf('SOURCE_REPAIR_REQUIRES_MOBILE_REPROOF', sourceRepairBlockIndex);
    const sourceBlockIndex = source.indexOf("if (sourceVerify.status === 'blocked')");
    const deliveryIndex = source.indexOf('const delivery = evaluateCustomerDeliveryReadiness');
    const activeIndex = source.indexOf("status:           'active'");

    expect(sourceRepairIndex).toBeGreaterThan(sourceVerifyIndex);
    expect(sourceRepairBlockIndex).toBeGreaterThan(sourceRepairIndex);
    expect(sourceRepairReproofIndex).toBeGreaterThan(sourceRepairBlockIndex);
    expect(sourceBlockIndex).toBeGreaterThan(sourceVerifyIndex);
    expect(sourceBlockIndex).toBeGreaterThan(sourceRepairReproofIndex);
    expect(deliveryIndex).toBeGreaterThan(sourceBlockIndex);
    expect(activeIndex).toBeGreaterThan(sourceBlockIndex);
  });

  it('returns final render claim coverage when approval is blocked', () => {
    const source = routeSourceWithoutComments();
    const blockIndex = source.indexOf("if (publishGate.decision === 'block')");
    const activeIndex = source.indexOf("status:           'active'");
    const blockBody = source.slice(blockIndex, activeIndex);

    expect(blockBody).toContain('render_claim_coverage');
    expect(blockBody).toContain('delivery.renderClaimCoverage.unsupported');
    expect(blockBody).toContain('{ status: 409 }');
    expect(blockBody).toContain('customer_deliverable: delivery.customerDeliverable');
  });

  it('requires actual packages mobile browser proof before active status update', () => {
    const source = routeSourceWithoutComments();
    const mobileProofIndex = source.indexOf('const mobileProof = evaluateCustomerMobileProof');
    const mobileProofBlockIndex = source.indexOf('if (!mobileProof.ok)');
    const publishGateBlockIndex = source.indexOf("if (publishGate.decision === 'block')");
    const activeIndex = source.indexOf("status:           'active'");

    expect(mobileProofIndex).toBeGreaterThanOrEqual(0);
    expect(mobileProofBlockIndex).toBeGreaterThan(mobileProofIndex);
    expect(publishGateBlockIndex).toBeGreaterThan(mobileProofBlockIndex);
    expect(activeIndex).toBeGreaterThan(mobileProofBlockIndex);
    expect(source.slice(mobileProofBlockIndex, activeIndex)).toContain('Actual /packages mobile browser proof is required before approval.');
  });
});
