import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Inngest blog autopilot V4 contract', () => {
  it('uses a stable event id, a three-retry ceiling, and per-queue concurrency', () => {
    const dispatcher = source('src/app/api/cron/blog-generate/route.ts');
    const workflow = source('src/inngest/functions/blog-autopilot-v4.ts');
    expect(dispatcher).toContain('createBlogPipelineEventId');
    expect(dispatcher).toContain('contentVersion');
    expect(workflow).toContain('retries: 3');
    expect(workflow).toContain("idempotency: 'event.id'");
    expect(workflow).toContain("key: 'event.data.queueId'");
  });

  it('keeps deterministic quality/browser failure terminal and leaves publishing to the slot controller', () => {
    const workflow = source('src/inngest/functions/blog-autopilot-v4.ts');
    expect(workflow).toContain("step.run('preview'");
    expect(workflow).toContain("verified.run.status !== 'approved_for_slot'");
    expect(workflow).toContain('publicationDispatched: false');
    expect(workflow).not.toContain('blog-publication-controller?force=true');
  });

  it('terminates deterministic duplicate skips before artifact verification and retries real generation failures', () => {
    const workflow = source('src/inngest/functions/blog-autopilot-v4.ts');
    const publisher = source('src/app/api/cron/blog-publisher/route.ts');
    const terminalCheck = workflow.indexOf('const terminalGeneration = readTerminalGenerationOutcome(generation)');
    const verifyStep = workflow.indexOf("step.run('verify'");
    expect(workflow).toContain("status.startsWith('skipped')");
    expect(workflow).toContain("['duplicate_review', 'failed', 'quarantined'].includes(status)");
    expect(workflow).toContain('payload.ok === false && !readTerminalGenerationOutcome(payload)');
    expect(workflow).toContain('blog_generation_payload_failed:');
    expect(workflow).toContain("terminalStage: 'draft'");
    expect(publisher).toContain("const terminalFailureStatus = failureStatus === 'failed' || failureStatus === 'skipped'");
    expect(publisher).toContain('status: terminalFailureStatus');
    expect(terminalCheck).toBeGreaterThan(0);
    expect(terminalCheck).toBeLessThan(verifyStep);
  });

  it('checkpoints all ten V4 stages with atomic publication deferred to the five-slot controller', () => {
    const workflow = source('src/inngest/functions/blog-autopilot-v4.ts');
    for (const stage of ['research', 'brief', 'draft', 'verify', 'edit', 'quality', 'preview', 'publish', 'indexing', 'observe']) {
      expect(workflow).toContain(`step.run('${stage}'`);
    }
    expect(workflow).toContain('publicationQueuedForScheduledSlot: true');
  });

  it('uses one function registration list for the serve route and runtime diagnostics', () => {
    const index = source('src/inngest/index.ts');
    const route = source('src/app/api/inngest/route.ts');
    expect(index).toContain('export const inngestFunctions = [');
    expect(index).toContain('blogAutopilotV4Fn');
    expect(index).toContain('MINIMUM_INNGEST_FUNCTION_COUNT = 5');
    expect(route).toContain('functions: [...inngestFunctions]');
  });

  it('can call its protected deployment without exposing the automation bypass key', () => {
    const workflow = source('src/inngest/functions/blog-autopilot-v4.ts');
    expect(workflow).toContain("getSecret('VERCEL_AUTOMATION_BYPASS_SECRET')");
    expect(workflow).toContain("headers['x-vercel-protection-bypass'] = deploymentProtectionBypass");
    expect(workflow).not.toContain('process.env.VERCEL_AUTOMATION_BYPASS_SECRET');
  });

  it('dispatches approved manual shadow runs through Inngest and release wiring never enables the legacy generator', () => {
    const dispatcher = source('src/app/api/cron/blog-generate/route.ts');
    const release = source('.github/workflows/blog-v4-production-release.yml');
    expect(dispatcher).toContain('if (durableWorkflowConfigured)');
    expect(dispatcher).toContain('inngest_blog_autopilot_credentials_missing');
    expect(dispatcher).toContain("getBlogPublishingPolicy('global')");
    expect(dispatcher).toContain('blog_generation_daily_quota_reached');
    expect(dispatcher).toContain("url.searchParams.get('limit')");
    expect(dispatcher).toContain('requestedManualLimit >= 1');
    expect(dispatcher).toContain('requestedManualLimit <= 2');
    expect(dispatcher).toContain('const dispatchLimit = Math.min(perRunLimit, remainingToday)');
    expect(dispatcher).toContain("url.searchParams.get('targetQueueId')");
    expect(dispatcher).toContain('target_queue_id_requires_forced_manual_run');
    expect(dispatcher).toContain('quarantineNonRetryableBlogQueueItems');
    expect(dispatcher).toContain('shouldQuarantineQueuedBlogItem');
    expect(dispatcher).toContain('selectPublishableQueueCandidates');
    expect(dispatcher).toContain('loadQueueDemandSignalMapV3');
    expect(dispatcher).toContain('activeRepresentativeKeys');
    expect(dispatcher).toContain('dispatchReadiness');
    expect(dispatcher).toContain('forcedManualDispatch: forcedManualRun');
    expect(release).toContain('update_env INNGEST_BLOG_AUTOPILOT_ENABLED true');
    expect(release).toContain('npx vercel env update INNGEST_BLOG_AUTOPILOT_ENABLED production --value true');
    expect(release).not.toContain('npx vercel env update BLOG_GENERATION_CRON_ENABLED production --value true');
  });

  it('preserves an existing terminal queue cause before deriving a new preflight diagnosis', () => {
    const lifecycle = source('src/lib/blog-queue-lifecycle.ts');
    const existingTerminalCheck = lifecycle.indexOf('const existingTerminalDecision = shouldQuarantineQueuedBlogItem');
    const candidateInspection = lifecycle.indexOf('const candidateContract = inspectBlogCandidatePrepublishContract');

    expect(existingTerminalCheck).toBeGreaterThan(0);
    expect(existingTerminalCheck).toBeLessThan(candidateInspection);
    expect(lifecycle).toContain('if (!existingTerminalDecision.quarantine)');
    expect(lifecycle).toContain('if (!existingTerminalDecision.quarantine && row.product_id)');
    expect(lifecycle).toContain('const decision = existingTerminalDecision.quarantine');
    expect(lifecycle).toContain("destinationIssue === 'generic_unmarked'");
    expect(lifecycle).toContain('buildDestinationlessInfoGenericMeta');
  });
});
