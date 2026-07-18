import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function routeSourceWithoutComments() {
  const source = readFileSync(join(process.cwd(), 'src/app/api/packages/[id]/approve/route.ts'), 'utf8');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function atomicPublishCallIndex(source: string) {
  return source.indexOf('createPublicPackageSnapshotAndDecision', source.indexOf('let publicSnapshot'));
}

function activeRpcPatchIndex(source: string) {
  return source.indexOf("status: 'active'", source.indexOf('packagePatch', atomicPublishCallIndex(source)));
}

describe('package approve route customer delivery gate', () => {
  it('recomputes customer render readiness before atomic publication', () => {
    const source = routeSourceWithoutComments();
    const sourceVerifyIndex = source.indexOf('const sourceVerify = evaluateVerifyChecks');
    const deliveryIndex = source.indexOf('const delivery = evaluateCustomerDeliveryReadiness');
    const blockIndex = source.indexOf("if (publishGate.decision === 'block')");
    const publishIndex = atomicPublishCallIndex(source);

    expect(sourceVerifyIndex).toBeGreaterThanOrEqual(0);
    expect(deliveryIndex).toBeGreaterThanOrEqual(0);
    expect(deliveryIndex).toBeGreaterThan(sourceVerifyIndex);
    expect(blockIndex).toBeGreaterThan(deliveryIndex);
    expect(publishIndex).toBeGreaterThan(blockIndex);
  });

  it('blocks source audit failures before customer delivery approval', () => {
    const source = routeSourceWithoutComments();
    const sourceVerifyIndex = source.indexOf('const sourceVerify = evaluateVerifyChecks');
    const sourceRepairIndex = source.indexOf('const sourceRepairUpdates: Record<string, unknown> = {}');
    const sourceRepairBlockIndex = source.indexOf("if (sourceRepairActions.length > 0)");
    const sourceRepairReproofIndex = source.indexOf('SOURCE_REPAIR_REQUIRES_MOBILE_REPROOF', sourceRepairBlockIndex);
    const sourceBlockIndex = source.indexOf("if (sourceVerify.status === 'blocked')");
    const deliveryIndex = source.indexOf('const delivery = evaluateCustomerDeliveryReadiness');
    const publishIndex = atomicPublishCallIndex(source);

    expect(sourceRepairIndex).toBeGreaterThan(sourceVerifyIndex);
    expect(sourceRepairBlockIndex).toBeGreaterThan(sourceRepairIndex);
    expect(sourceRepairReproofIndex).toBeGreaterThan(sourceRepairBlockIndex);
    expect(sourceBlockIndex).toBeGreaterThan(sourceVerifyIndex);
    expect(sourceBlockIndex).toBeGreaterThan(sourceRepairReproofIndex);
    expect(deliveryIndex).toBeGreaterThan(sourceBlockIndex);
    expect(publishIndex).toBeGreaterThan(sourceBlockIndex);
  });

  it('returns final render claim coverage when approval is blocked', () => {
    const source = routeSourceWithoutComments();
    const blockIndex = source.indexOf("if (publishGate.decision === 'block')");
    const publishIndex = atomicPublishCallIndex(source);
    const blockBody = source.slice(blockIndex, publishIndex);

    expect(blockBody).toContain('render_claim_coverage');
    expect(blockBody).toContain('delivery.renderClaimCoverage.unsupported');
    expect(blockBody).toContain('{ status: 409 }');
    expect(blockBody).toContain('customer_deliverable: delivery.customerDeliverable');
  });

  it('requires actual packages and LP mobile browser proof before atomic publication', () => {
    const source = routeSourceWithoutComments();
    const snapshotPreviewIndex = source.indexOf('const finalSnapshotPreview = buildPublicPackageSnapshot');
    const mobileProofIndex = source.indexOf('const mobileProof = evaluateCustomerMobileProof');
    const mobileProofBlockIndex = source.indexOf('if (!mobileProof.ok)');
    const publishGateBlockIndex = source.indexOf("if (publishGate.decision === 'block')");
    const publishIndex = atomicPublishCallIndex(source);

    expect(snapshotPreviewIndex).toBeGreaterThanOrEqual(0);
    expect(mobileProofIndex).toBeGreaterThanOrEqual(0);
    expect(mobileProofIndex).toBeGreaterThan(snapshotPreviewIndex);
    expect(mobileProofBlockIndex).toBeGreaterThan(mobileProofIndex);
    expect(publishGateBlockIndex).toBeGreaterThan(mobileProofBlockIndex);
    expect(publishIndex).toBeGreaterThan(mobileProofBlockIndex);
    expect(source.slice(mobileProofIndex, mobileProofBlockIndex)).toContain('packageRevision: nextPackageRevision');
    expect(source.slice(mobileProofIndex, mobileProofBlockIndex)).toContain('publicSnapshotHash: finalSnapshotPreview.snapshotHash');
    expect(source.slice(mobileProofIndex, mobileProofBlockIndex)).toContain('appBuildId: finalAppBuildId');
    expect(source.slice(mobileProofBlockIndex, publishIndex)).toContain('Actual /packages and /lp mobile browser proof is required before approval.');
  });

  it('requires the unified customer-open contract before atomic publication', () => {
    const source = routeSourceWithoutComments();
    const contractIndex = source.indexOf('const customerOpenContract = evaluateCustomerOpenContract');
    const contractBlockIndex = source.indexOf('if (!customerOpenContract.ok)');
    const publishIndex = atomicPublishCallIndex(source);

    expect(contractIndex).toBeGreaterThanOrEqual(0);
    expect(contractBlockIndex).toBeGreaterThan(contractIndex);
    expect(publishIndex).toBeGreaterThan(contractBlockIndex);
    expect(source.slice(contractBlockIndex, publishIndex)).toContain('customer_open_contract');
  });

  it('returns packages to blocked draft state when final public snapshot persistence fails', () => {
    const source = routeSourceWithoutComments();
    const snapshotTryIndex = source.indexOf('try', source.indexOf('let publicSnapshot'));
    const snapshotCallIndex = source.indexOf('createPublicPackageSnapshotAndDecision', snapshotTryIndex);
    const snapshotCatchIndex = source.indexOf('} catch (error)', snapshotCallIndex);
    const successResponseIndex = source.indexOf('return NextResponse.json({', snapshotCatchIndex);
    const failureBlock = source.slice(snapshotCatchIndex, successResponseIndex);

    expect(snapshotCallIndex).toBeGreaterThan(snapshotTryIndex);
    expect(failureBlock).toContain("status: 'draft'");
    expect(failureBlock).toContain("publication_state: 'blocked'");
    expect(failureBlock).toContain("audit_status: 'blocked'");
    expect(failureBlock).toContain('public_snapshot_error');
    expect(failureBlock).toContain('PUBLIC_SNAPSHOT_SAVE_FAILED');
  });

  it('passes the final active package patch only to the atomic publication RPC wrapper', () => {
    const source = routeSourceWithoutComments();
    const snapshotCallIndex = atomicPublishCallIndex(source);
    const packagePatchIndex = source.indexOf('packagePatch', snapshotCallIndex);
    const activeIndex = activeRpcPatchIndex(source);

    expect(snapshotCallIndex).toBeGreaterThanOrEqual(0);
    expect(packagePatchIndex).toBeGreaterThan(snapshotCallIndex);
    expect(activeIndex).toBeGreaterThan(packagePatchIndex);
    expect(source).not.toContain("status:           'draft'");
    expect(source).not.toContain("publication_state: 'needs_review'");
    expect(source).not.toContain('const { error: finalPkgError }');
    expect(source).not.toContain('FINAL_PUBLICATION_UPDATE_FAILED');
  });
});
