import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function routeSourceWithoutComments() {
  const source = readFileSync(join(process.cwd(), 'src/app/api/packages/route.ts'), 'utf8');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function sourceWithoutComments(path: string) {
  const source = readFileSync(join(process.cwd(), path), 'utf8');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('packages bulk/customer publication gate', () => {
  it('serves customer package API responses only from the promoted pointer views', () => {
    const source = routeSourceWithoutComments();
    const detailIndex = source.indexOf('if (id) {');
    const detailSnapshotIndex = source.indexOf('getPublishedPackageDetail', detailIndex);
    const detailMissingIndex = source.indexOf('if (!isAdmin && !publicSnapshotPackage)', detailSnapshotIndex);
    const responsePkgIndex = source.indexOf('const responsePkg: Record<string, unknown> = isAdmin', detailMissingIndex);
    const listIndex = source.indexOf('const visibleRows = isAdmin', responsePkgIndex);
    const listSnapshotIndex = source.indexOf('getPublishedPackageCards', listIndex);
    const aggregateIndex = source.indexOf("if (aggregate === 'destination')");
    const aggregateSnapshotIndex = source.indexOf('getPublishedPackageCards', aggregateIndex);

    expect(source).not.toContain('function isCustomerPublicSnapshotCandidate');
    expect(detailSnapshotIndex).toBeGreaterThan(detailIndex);
    expect(detailMissingIndex).toBeGreaterThan(detailSnapshotIndex);
    expect(responsePkgIndex).toBeGreaterThan(detailMissingIndex);
    expect(listSnapshotIndex).toBeGreaterThan(listIndex);
    expect(aggregateSnapshotIndex).toBeGreaterThan(aggregateIndex);
  });

  it('blocks publication when source repair changes customer-visible data before mobile re-proof', () => {
    const source = routeSourceWithoutComments();
    const proofImportIndex = source.indexOf('extractCustomerMobileProof');
    const proofExtractIndex = source.indexOf('const existingMobileProof = extractCustomerMobileProof');
    const repairBlockIndex = source.indexOf("if (repair.status === 'repaired')", proofExtractIndex);
    const reproofCodeIndex = source.indexOf('SOURCE_REPAIR_REQUIRES_MOBILE_REPROOF', repairBlockIndex);
    const mobileProofIndex = source.indexOf('const mobileProof = evaluateCustomerMobileProof', repairBlockIndex);
    const approveUpdateIndex = source.indexOf("status: 'approved'", mobileProofIndex);

    expect(proofImportIndex).toBeGreaterThanOrEqual(0);
    expect(proofExtractIndex).toBeGreaterThanOrEqual(0);
    expect(repairBlockIndex).toBeGreaterThan(proofExtractIndex);
    expect(reproofCodeIndex).toBeGreaterThan(repairBlockIndex);
    expect(mobileProofIndex).toBeGreaterThan(reproofCodeIndex);
    expect(approveUpdateIndex).toBeGreaterThan(mobileProofIndex);
  });

  it('checks source audit and v3 gate before bulk public status update', () => {
    const source = routeSourceWithoutComments();
    const bulkIndex = source.indexOf("if (action === 'bulk_approve')");
    const sourceGateIndex = source.indexOf('const sourceAuditBlock = await assertPackageSourceAuditAllowsPublication(id)');
    const v3GateIndex = source.indexOf('const gate = evaluateV3CustomerNoticeGate(id, latestDraft)');
    const mobileProofIndex = source.indexOf('const mobileProofBlocks = packageIds', v3GateIndex);
    const mobileProofGateIndex = source.indexOf('MOBILE_BROWSER_PROOF_REQUIRED_FOR_BULK_APPROVAL', mobileProofIndex);
    const sourceAuditHelperIndex = source.indexOf('async function assertPackageSourceAuditAllowsPublication');
    const customerOpenContractIndex = source.indexOf('CUSTOMER_OPEN_CONTRACT_BLOCKED', sourceAuditHelperIndex);
    const updateIndex = source.indexOf("status: 'approved'", mobileProofGateIndex);

    expect(bulkIndex).toBeGreaterThanOrEqual(0);
    expect(sourceGateIndex).toBeGreaterThan(bulkIndex);
    expect(v3GateIndex).toBeGreaterThan(sourceGateIndex);
    expect(mobileProofIndex).toBeGreaterThan(v3GateIndex);
    expect(mobileProofGateIndex).toBeGreaterThan(mobileProofIndex);
    expect(customerOpenContractIndex).toBeGreaterThan(sourceAuditHelperIndex);
    expect(updateIndex).toBeGreaterThan(mobileProofGateIndex);
  });

  it('keeps legacy approvals blocked from customer publication without atomic public snapshots', () => {
    const source = routeSourceWithoutComments();
    const dbHelper = sourceWithoutComments('src/lib/db/packages.ts');
    const bulkIndex = source.indexOf("if (action === 'bulk_approve')");
    const bulkUpdateIndex = source.indexOf("status: 'approved'", bulkIndex);
    const bulkBlockedIndex = source.indexOf("publication_state: 'blocked'", bulkUpdateIndex);
    const approveIndex = source.indexOf("if (action === 'approve')");
    const approvePackageIndex = source.indexOf('approvePackage(packageId)', approveIndex);
    const helperIndex = dbHelper.indexOf('export async function approvePackage');
    const helperApprovedIndex = dbHelper.indexOf("status: 'approved'", helperIndex);
    const helperBlockedIndex = dbHelper.indexOf("publication_state: 'blocked'", helperApprovedIndex);

    expect(bulkBlockedIndex).toBeGreaterThan(bulkUpdateIndex);
    expect(approvePackageIndex).toBeGreaterThan(approveIndex);
    expect(source).toContain("publication_state: 'blocked'");
    expect(helperBlockedIndex).toBeGreaterThan(helperApprovedIndex);
  });

  it('invalidates public snapshots when generic PATCH changes customer-visible fields', () => {
    const source = routeSourceWithoutComments();
    const helperIndex = source.indexOf('const CUSTOMER_PUBLIC_REAUDIT_FIELDS = new Set');
    const keysIndex = source.indexOf('const publicReauditKeys = customerPublicReauditKeys(sanitized)');
    const beforeRowIndex = source.indexOf('trackedKeysChanged.length > 0 || publicReauditKeys.length > 0');
    const revisionIndex = source.indexOf('sanitized.package_revision = nextRevision', beforeRowIndex);
    const auditIndex = source.indexOf("sanitized.audit_status = 'blocked'", revisionIndex);
    const needsReauditIndex = source.indexOf("'needs_reaudit'", auditIndex);
    const updateIndex = source.indexOf('.update(sanitized)', needsReauditIndex);

    expect(helperIndex).toBeGreaterThanOrEqual(0);
    expect(keysIndex).toBeGreaterThan(helperIndex);
    expect(beforeRowIndex).toBeGreaterThan(keysIndex);
    expect(revisionIndex).toBeGreaterThan(beforeRowIndex);
    expect(auditIndex).toBeGreaterThan(revisionIndex);
    expect(needsReauditIndex).toBeGreaterThan(auditIndex);
    expect(updateIndex).toBeGreaterThan(needsReauditIndex);
    expect(source).toContain("'title'");
    expect(source).toContain("'optional_tours'");
    expect(source).toContain("'itinerary_data'");
    expect(source).toContain("'price_dates'");
  });
});
