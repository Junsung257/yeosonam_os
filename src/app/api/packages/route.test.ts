import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function routeSourceWithoutComments() {
  const source = readFileSync(join(process.cwd(), 'src/app/api/packages/route.ts'), 'utf8');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('packages bulk/customer publication gate', () => {
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
    const updateIndex = source.indexOf("status: 'approved'", mobileProofGateIndex);

    expect(bulkIndex).toBeGreaterThanOrEqual(0);
    expect(sourceGateIndex).toBeGreaterThan(bulkIndex);
    expect(v3GateIndex).toBeGreaterThan(sourceGateIndex);
    expect(mobileProofIndex).toBeGreaterThan(v3GateIndex);
    expect(mobileProofGateIndex).toBeGreaterThan(mobileProofIndex);
    expect(updateIndex).toBeGreaterThan(mobileProofGateIndex);
  });
});
