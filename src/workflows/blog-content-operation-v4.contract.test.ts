import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('src/workflows/blog-content-operation-v4.ts', 'utf8');
const generateRoute = readFileSync('src/app/api/cron/blog-generate/route.ts', 'utf8');
const watchdog = readFileSync('src/lib/blog-content-factory/watchdog.ts', 'utf8');
const publisherRoute = readFileSync('src/app/api/cron/blog-publisher/route.ts', 'utf8');
const controllerRoute = readFileSync('src/app/api/cron/blog-publication-controller/route.ts', 'utf8');
const riskPolicy = readFileSync('src/lib/blog-publication-review-policy.ts', 'utf8');

describe('Blog V4 durable workflow wiring', () => {
  it('uses one workflow with bounded durable validation and generation steps', () => {
    expect(workflow).toContain("'use workflow'");
    for (const step of [
      'preflightStep', 'packageSnapshotStep', 'briefStep', 'researchStep',
      'generationStep', 'deterministicValidationStep', 'finalizeStep',
    ]) expect(workflow).toContain(`async function ${step}`);
    expect(workflow.match(/'use step'/g)?.length).toBeGreaterThanOrEqual(7);
    expect(workflow).toContain('RetryableError');
    expect(workflow).toContain('FatalError');
    expect(workflow).toContain('isDeepSeekOffPeakAt(new Date())');
    expect(workflow).toContain('BLOG_V4_STAGING_CANARY_ALLOW_OFFPEAK_BYPASS');
    expect(workflow).toContain("BLOG_AUTOPUBLISH_MODE?.trim().toLowerCase() === 'draft_only'");
    expect(workflow).toContain('BLOG_CONTENT_FACTORY_WAITING_FOR_DEEPSEEK_OFFPEAK');
    expect(workflow).toContain('for (let pass = 1; pass <= 5; pass += 1)');
    expect(workflow).toContain('pass <= 2');
    expect(workflow).toContain('deterministicRepairOnly: true');
    expect(workflow).toContain("nextGeneration.passDecision !== 'continue'");
    expect(workflow).toContain('BLOG_CONTENT_FACTORY_GENERATION_DEFERRED');
    expect(workflow).toContain('BLOG_CONTENT_FACTORY_ATTEMPT_RECEIPT_READ');
    expect(workflow).toContain('VERCEL_AUTOMATION_BYPASS_SECRET');
    expect(workflow).toContain('x-vercel-protection-bypass');
    expect(workflow).toContain("url.searchParams.set('stagingCanary', '1')");
    expect(workflow).toContain('generation:attempt:${attemptNumber}:v1');
    expect(workflow).toContain('generation:pass:${pass}:started:v1:${workflowRunId}');
    expect(workflow).toContain('finalize:approved:v1:${workflowRunId}');
    expect(workflow).toContain('cachedInputTokens: Number(attempt.cache_hit_input_tokens ?? 0)');
    expect(workflow).toContain('BLOG_CONTENT_FACTORY_GENERATION_RESULT_MISSING');
    expect(workflow).toContain('const contractValid = isBlogPublisherOperationResponseV4');
    expect(workflow).toContain('const payloadSkipped = payloadRecord?.skipped === true;');
    expect(workflow).toContain('const operationSucceeded = response.ok && contractValid && payloadOk;');
    expect(workflow).toContain('terminalizeBlogContentOperationV4');
    expect(workflow).toContain('recordWorkflowFailureStep');
    expect(workflow).toContain("operationStatus: 'running'");
    expect(workflow).toContain('payloadReason: payloadRecord?.reason ?? null');
    expect(workflow).toContain('isHighRiskAutoDiscardTopic');
    expect(workflow).toContain('high_risk_auto_discarded');
    expect(workflow).toContain("generationStatus: 'skipped'");
    expect(workflow).toContain("publicationStatus: 'quality_blocked'");
    expect(workflow).not.toContain('high_risk_human_approval_required');
  });

  it('starts workflows from the cron without making a model call in that request', () => {
    expect(generateRoute).toContain('BLOG_CONTENT_FACTORY_ENABLED');
    expect(generateRoute).toContain('materializeBlogContentOperationsV4');
    expect(generateRoute).toContain('startBlogContentOperationWorkflowV4');
    expect(generateRoute).toContain('modelCallsInCronRequest: 0');
    expect(generateRoute).toContain('forcedManualRun');
    expect(generateRoute).toContain('workflowStartLimit');
    expect(generateRoute).toContain(".in('status', ['queued', 'running'])");
    expect(generateRoute).toContain('lease_expires_at.lt.');
    expect(generateRoute).toContain('recoverExpiredBlogContentOperationsV4');
    expect(watchdog).toContain('expire_stale_ai_reservations_v1');
    expect(watchdog).toContain('recent_retryable_event');
  });

  it('requires operation id, fence, lease and queued lineage at the legacy engine boundary', () => {
    expect(publisherRoute).toContain("searchParams.get('operationId')");
    expect(publisherRoute).toContain(".eq('fencing_token', fencingToken)");
    expect(publisherRoute).toContain(".eq('lease_owner', leaseOwner)");
    expect(publisherRoute).toContain('content_operation_lease_expired');
    expect(publisherRoute).toContain('embeddedOnly: options.stagingCanary === true');
    expect(publisherRoute).toContain('publisher:progress:${step}:v1');
    expect(publisherRoute).toContain('buildBlogPublisherOperationResponseV4');
    expect(publisherRoute).toContain('generationRunId: result.generationRunId');
    expect(publisherRoute).toContain('resourceSaverResponse');
    expect(publisherRoute).toContain("reason: 'blog_quality_v3_runtime_schema_not_ready'");
    expect(publisherRoute).toContain('isHighRiskAutoDiscardTopic');
    expect(publisherRoute).toContain('publisher:high-risk:auto-discard');
    expect(publisherRoute).toContain("generationStatus: 'skipped'");
  });

  it('requires an approved factory operation and rechecks an immutable package snapshot before publication', () => {
    expect(controllerRoute).toContain('approved_content_operation_missing');
    expect(controllerRoute).toContain('claimBlogContentOperationPublicationV4');
    expect(controllerRoute).toContain('validateBlogPackageSnapshotPinV4');
    expect(controllerRoute).toContain('BLOG_CONTENT_FACTORY_PORTFOLIO_CAPS_V4');
    expect(controllerRoute).toContain('final_quality_decision_not_publishable');
    expect(controllerRoute).toContain('final_quality_revision_not_immutable_or_current');
    expect(controllerRoute).toContain('hashBlogContentRevisionV1');
  });

  it('uses automatic discard for high-risk topics instead of creating review work', () => {
    expect(riskPolicy).toContain('isHighRiskAutoDiscardTopic');
    expect(riskPolicy).toContain('V4_AUTO_DISCARD_INFORMATION_RE');
    expect(riskPolicy).toContain('가격');
    expect(riskPolicy).toContain('visa');
  });
});
