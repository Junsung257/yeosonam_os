import { describe, expect, it } from 'vitest';
import { evaluateBlogShadowGenerationV4 } from './blog-shadow-generation-verification-v4';

const queue = { id: 'queue-1', status: 'generating', last_error: null };
const run = {
  id: 'run-1',
  queue_id: queue.id,
  content_creative_id: 'creative-1',
  selected_attempt_id: 'attempt-1',
  status: 'approved_for_slot',
  disposition: 'approved_for_slot',
  last_error: null,
};
const attempt = {
  id: 'attempt-1',
  run_id: run.id,
  queue_id: queue.id,
  status: 'completed',
  route: 'approved_for_slot',
};
const creative = { id: 'creative-1', status: 'draft', published_at: null };

describe('blog shadow generation verification V4', () => {
  it('passes only with an approved completed attempt and a private creative', () => {
    expect(evaluateBlogShadowGenerationV4({
      queue,
      run,
      attempts: [attempt],
      creative,
      indexingJobs: [],
    })).toEqual({
      state: 'passed',
      reason: 'private_draft_generation_proven_without_publication',
      runId: 'run-1',
      creativeId: 'creative-1',
    });
  });

  it('fails when a terminal queue never produced a generation run', () => {
    expect(evaluateBlogShadowGenerationV4({
      queue: { ...queue, status: 'failed', last_error: 'evidence_insufficient' },
      run: null,
      attempts: [],
      creative: null,
      indexingJobs: [],
    })).toMatchObject({
      state: 'failed',
      reason: 'shadow_queue_terminal_without_run:failed:evidence_insufficient',
    });
  });

  it('fails when the draft was published or entered the indexing outbox', () => {
    expect(evaluateBlogShadowGenerationV4({
      queue,
      run,
      attempts: [attempt],
      creative: { ...creative, status: 'published', published_at: '2026-09-02T00:00:00Z' },
      indexingJobs: [],
    }).reason).toBe('shadow_creative_was_publicly_published');

    expect(evaluateBlogShadowGenerationV4({
      queue,
      run,
      attempts: [attempt],
      creative,
      indexingJobs: [{ id: 'index-1', content_creative_id: creative.id }],
    }).reason).toBe('shadow_creative_created_indexing_outbox');
  });
});
