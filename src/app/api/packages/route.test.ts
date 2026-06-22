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
  it('preserves existing mobile browser proof when source audit refreshes audit_report', () => {
    const source = routeSourceWithoutComments();
    const proofImportIndex = source.indexOf('extractCustomerMobileProof');
    const proofExtractIndex = source.indexOf('const existingMobileProof = extractCustomerMobileProof');
    const updateIndex = source.indexOf('audit_report: {');
    const proofPreserveIndex = source.indexOf('...(existingMobileProof ? { mobile_browser_proof: existingMobileProof } : {})');
    const mobileProofIndex = source.indexOf('const mobileProof = evaluateCustomerMobileProof');

    expect(proofImportIndex).toBeGreaterThanOrEqual(0);
    expect(proofExtractIndex).toBeGreaterThanOrEqual(0);
    expect(updateIndex).toBeGreaterThan(proofExtractIndex);
    expect(proofPreserveIndex).toBeGreaterThan(updateIndex);
    expect(mobileProofIndex).toBeGreaterThan(proofPreserveIndex);
  });

  it('checks source audit and v3 gate before bulk public status update', () => {
    const source = routeSourceWithoutComments();
    const bulkIndex = source.indexOf("if (action === 'bulk_approve')");
    const sourceGateIndex = source.indexOf('const sourceAuditBlock = await assertPackageSourceAuditAllowsPublication(id)');
    const v3GateIndex = source.indexOf('const gate = evaluateV3CustomerNoticeGate(id, latestDraft)');
    const updateIndex = source.indexOf("status: 'approved'", v3GateIndex);

    expect(bulkIndex).toBeGreaterThanOrEqual(0);
    expect(sourceGateIndex).toBeGreaterThan(bulkIndex);
    expect(v3GateIndex).toBeGreaterThan(sourceGateIndex);
    expect(updateIndex).toBeGreaterThan(v3GateIndex);
  });
});
