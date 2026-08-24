import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function source(file: string): string {
  return readFileSync(join(process.cwd(), file), 'utf8');
}

const migration = source('supabase/migrations/20260824103000_product_registration_publication_workflow.sql');
const registrationWorkflow = source('src/workflows/product-registration-v6.ts');
const publicationWorkflow = source('src/workflows/product-registration-publication.ts');
const requestRoute = source('src/app/api/admin/product-registration/products/[catalogProductId]/publication-requests/route.ts');
const outboxWorker = source('src/lib/product-registration-v4/outbox-worker.ts');

describe('product registration publication workflow contract', () => {
  it('recovers stranded publication requests through the existing convergence cron slot', () => {
    const vercel = source('vercel.json');
    const convergence = source('src/app/api/cron/product-registration-v5-convergence/route.ts');

    expect(vercel).not.toContain('"path": "/api/cron/product-registration-publication-requests"');
    expect(convergence).toContain('dispatchProductRegistrationPublicationRequests');
  });

  it('stops registration at a candidate snapshot and requires a separate publication request', () => {
    const orchestration = registrationWorkflow.slice(registrationWorkflow.indexOf('export async function productRegistrationV6Workflow'));
    const snapshotIndex = orchestration.indexOf('buildSnapshotsStep');
    const terminalIndex = orchestration.indexOf('PUBLICATION_REQUEST_REQUIRED', snapshotIndex);
    expect(snapshotIndex).toBeGreaterThan(0);
    expect(terminalIndex).toBeGreaterThan(snapshotIndex);
    expect(orchestration.slice(snapshotIndex, terminalIndex)).not.toContain('proveSnapshotsStep');
    expect(orchestration.slice(snapshotIndex, terminalIndex)).not.toContain('publishSnapshotsStep');
  });

  it('runs exact proof, atomic bundle publication, convergence and live Chrome canary in order', () => {
    const claim = publicationWorkflow.indexOf('await claimStep');
    const proof = publicationWorkflow.indexOf('await proveStep', claim);
    const publish = publicationWorkflow.indexOf('await publishStep', proof);
    const convergence = publicationWorkflow.indexOf('await convergenceStep', publish);
    const canary = publicationWorkflow.indexOf('await liveCanaryStep', convergence);
    const complete = publicationWorkflow.indexOf('await completeStep', canary);
    expect(claim).toBeGreaterThan(0);
    expect(proof).toBeGreaterThan(claim);
    expect(publish).toBeGreaterThan(proof);
    expect(convergence).toBeGreaterThan(publish);
    expect(canary).toBeGreaterThan(convergence);
    expect(complete).toBeGreaterThan(canary);
    expect(publicationWorkflow).toContain('publishProductRegistrationSnapshotBundle');
    expect(publicationWorkflow).toContain('markProductRegistrationConvergenceFailed');
  });

  it('leases and fences publication attempts and recovers a stranded committed pointer fail closed', () => {
    expect(migration).toContain("workflow_attempt_count between 0 and 3");
    expect(migration).toContain("lease_expires_at = now() + interval '15 minutes'");
    expect(migration).toContain('REGISTRATION_PUBLICATION_WORKFLOW_FENCING_CONFLICT');
    expect(migration).toContain("v_request.status = 'pointer_committed'");
    expect(migration).toContain("'action', 'compensate'");
    expect(migration).toContain('list_product_registration_publication_dispatches');
  });

  it('persists live canary evidence and makes convergence-failed outbox events processable', () => {
    expect(migration).toContain('live_canary_result');
    expect(migration).toContain('live_canary_checked_at');
    expect(migration).toContain('internal_product_registration.mark_convergence_failed(p_payload)');
    expect(outboxWorker).toContain("'package.publication.convergence_failed'");
  });

  it('starts the durable workflow only from the server-attributed admin request', () => {
    expect(requestRoute).toContain('start(productRegistrationPublicationWorkflow');
    expect(requestRoute).toContain('resolveAdminActorLabel(request)');
    expect(requestRoute).not.toContain('body.workflowRunId');
    expect(requestRoute).not.toContain('body.requestedActor');
  });
});
