import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowSource = fs.readFileSync(
  path.join(process.cwd(), 'src/workflows/product-registration-v6.ts'),
  'utf8',
);
const canonicalWorkerSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/product-registration-v4/canonical-worker.ts'),
  'utf8',
);

describe('V6 analysis recovery workflow boundary', () => {
  it('places the preview-only analysis branch before revision normalization', () => {
    const workflowEntry = workflowSource.indexOf('export async function productRegistrationV6Workflow');
    const entrySource = workflowSource.slice(workflowEntry);
    const previewGate = entrySource.indexOf('analysisRecoveryPreviewEnabledStep()');
    const analysis = entrySource.indexOf('analyzeUnpublishedStep(input, preflight, supplierProfile)');
    const revisionNormalization = entrySource.indexOf('normalizeStep(input, preflight, supplierProfile)');

    expect(workflowEntry).toBeGreaterThan(0);
    expect(previewGate).toBeGreaterThan(0);
    expect(analysis).toBeGreaterThan(previewGate);
    expect(revisionNormalization).toBeGreaterThan(analysis);
    expect(entrySource.slice(analysis, revisionNormalization)).toContain('return await terminalStep');
  });

  it('suppresses review and correction side effects in the PR-V6-01 preview terminal', () => {
    expect(workflowSource).toContain('{ enqueueReviewAlert: false, finalizeCorrection: false }');
  });

  it('guards immutable revision commits behind the explicit execution policy', () => {
    const commitCall = canonicalWorkerSource.indexOf('commitCanonicalRevisionAtomic({');
    const policyGuard = canonicalWorkerSource.lastIndexOf(
      'if (executionPolicy.commitRevisions && (',
      commitCall,
    );

    expect(commitCall).toBeGreaterThan(0);
    expect(policyGuard).toBeGreaterThan(0);
    expect(policyGuard).toBeLessThan(commitCall);
    expect(canonicalWorkerSource.slice(policyGuard, commitCall)).not.toContain('analysis_only');
  });
});
