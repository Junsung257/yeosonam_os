import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { start } from 'workflow/api';

import { blogContentOperationWorkflow } from '@/workflows/blog-content-operation-v4';
import { bindBlogContentOperationWorkflowV4, claimBlogContentOperationV4 } from './repository';
import { BLOG_CONTENT_OPERATION_WORKFLOW_VERSION } from './types';

export async function startBlogContentOperationWorkflowV4(input: {
  supabase: SupabaseClient;
  operationId: string;
  requestBaseUrl: string;
}): Promise<{ operationId: string; workflowRunId: string; fencingToken: number; reused: boolean }> {
  const { data: existing, error: existingError } = await input.supabase
    .from('blog_content_operations')
    .select('id,status,workflow_run_id,fencing_token,queue_id,lease_owner,lease_expires_at')
    .eq('id', input.operationId)
    .maybeSingle();
  if (existingError) throw new Error(`blog_content_operation_lookup_failed:${existingError.message}`);
  if (!existing) throw new Error('blog_content_operation_not_found');
  const leaseExpiresAt = existing.lease_expires_at
    ? Date.parse(String(existing.lease_expires_at))
    : Number.NaN;
  const leaseActive = Number.isFinite(leaseExpiresAt) && leaseExpiresAt > Date.now();
  if (existing.status === 'running' && existing.workflow_run_id && existing.queue_id && leaseActive) {
    return {
      operationId: input.operationId,
      workflowRunId: String(existing.workflow_run_id),
      fencingToken: Number(existing.fencing_token),
      reused: true,
    };
  }
  if (existing.status !== 'queued' && existing.status !== 'running') {
    throw new Error(`blog_content_operation_not_startable:${existing.status}`);
  }

  const leaseOwner = `blog-content-factory:${input.operationId}:${randomUUID()}`;
  const claimed = await claimBlogContentOperationV4({
    supabase: input.supabase,
    operationId: input.operationId,
    leaseOwner,
    leaseSeconds: 300,
  });
  const workflowInput = {
    operationId: input.operationId,
    queueId: claimed.queueId,
    fencingToken: claimed.fencingToken,
    leaseOwner,
    requestBaseUrl: input.requestBaseUrl,
    workflowVersion: BLOG_CONTENT_OPERATION_WORKFLOW_VERSION,
  } as const;
  const run = await start(blogContentOperationWorkflow, [workflowInput]);
  try {
    await bindBlogContentOperationWorkflowV4({
      supabase: input.supabase,
      operationId: input.operationId,
      fencingToken: claimed.fencingToken,
      leaseOwner,
      workflowRunId: run.runId,
    });
  } catch (error) {
    await run.cancel().catch(() => undefined);
    throw error;
  }
  return {
    operationId: input.operationId,
    workflowRunId: run.runId,
    fencingToken: claimed.fencingToken,
    reused: false,
  };
}
