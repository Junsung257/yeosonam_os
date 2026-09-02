export type BlogShadowQueueV4 = {
  id: string;
  status: string | null;
  last_error?: string | null;
};

export type BlogShadowRunV4 = {
  id: string;
  queue_id: string;
  content_creative_id: string | null;
  selected_attempt_id: string | null;
  status: string | null;
  disposition?: string | null;
  last_error?: string | null;
};

export type BlogShadowAttemptV4 = {
  id: string;
  run_id: string;
  queue_id: string;
  status: string | null;
  route: string | null;
};

export type BlogShadowCreativeV4 = {
  id: string;
  status: string | null;
  published_at: string | null;
};

export type BlogShadowIndexingJobV4 = {
  id: string;
  content_creative_id: string | null;
};

export type BlogShadowVerificationDecisionV4 = {
  state: 'pending' | 'passed' | 'failed';
  reason: string;
  runId: string | null;
  creativeId: string | null;
};

const TERMINAL_QUEUE_STATUSES = new Set(['failed', 'skipped', 'quarantined']);
const TERMINAL_RUN_FAILURE_STATUSES = new Set([
  'failed',
  'cancelled',
  'human_review',
  'quarantine',
]);

export function evaluateBlogShadowGenerationV4(input: {
  queue: BlogShadowQueueV4 | null;
  run: BlogShadowRunV4 | null;
  attempts: BlogShadowAttemptV4[];
  creative: BlogShadowCreativeV4 | null;
  indexingJobs: BlogShadowIndexingJobV4[];
}): BlogShadowVerificationDecisionV4 {
  if (!input.queue) {
    return { state: 'failed', reason: 'shadow_queue_missing', runId: null, creativeId: null };
  }

  const queueStatus = String(input.queue.status || '').trim().toLowerCase();
  if (!input.run) {
    if (TERMINAL_QUEUE_STATUSES.has(queueStatus)) {
      return {
        state: 'failed',
        reason: `shadow_queue_terminal_without_run:${queueStatus}:${input.queue.last_error || 'unknown'}`,
        runId: null,
        creativeId: null,
      };
    }
    return { state: 'pending', reason: 'shadow_generation_run_pending', runId: null, creativeId: null };
  }

  const runStatus = String(input.run.status || '').trim().toLowerCase();
  if (TERMINAL_RUN_FAILURE_STATUSES.has(runStatus)) {
    return {
      state: 'failed',
      reason: `shadow_generation_run_terminal:${runStatus}:${input.run.last_error || input.run.disposition || 'unknown'}`,
      runId: input.run.id,
      creativeId: input.run.content_creative_id,
    };
  }

  if (runStatus !== 'approved_for_slot') {
    return {
      state: 'pending',
      reason: `shadow_generation_run_pending:${runStatus || 'unknown'}`,
      runId: input.run.id,
      creativeId: input.run.content_creative_id,
    };
  }

  if (!input.run.selected_attempt_id || !input.run.content_creative_id) {
    return {
      state: 'failed',
      reason: 'shadow_approved_run_missing_selected_artifacts',
      runId: input.run.id,
      creativeId: input.run.content_creative_id,
    };
  }

  const selectedAttempt = input.attempts.find((attempt) => attempt.id === input.run?.selected_attempt_id);
  if (!selectedAttempt || selectedAttempt.status !== 'completed' || selectedAttempt.route !== 'approved_for_slot') {
    return {
      state: 'failed',
      reason: 'shadow_selected_attempt_not_completed_and_approved',
      runId: input.run.id,
      creativeId: input.run.content_creative_id,
    };
  }

  if (!input.creative || input.creative.id !== input.run.content_creative_id) {
    return {
      state: 'failed',
      reason: 'shadow_private_creative_missing',
      runId: input.run.id,
      creativeId: input.run.content_creative_id,
    };
  }
  if (input.creative.published_at || input.creative.status === 'published') {
    return {
      state: 'failed',
      reason: 'shadow_creative_was_publicly_published',
      runId: input.run.id,
      creativeId: input.creative.id,
    };
  }
  if (input.indexingJobs.length > 0) {
    return {
      state: 'failed',
      reason: 'shadow_creative_created_indexing_outbox',
      runId: input.run.id,
      creativeId: input.creative.id,
    };
  }

  return {
    state: 'passed',
    reason: 'private_draft_generation_proven_without_publication',
    runId: input.run.id,
    creativeId: input.creative.id,
  };
}
