import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nextBlogModelCallAttemptNumberV4 } from './blog-generation-run-v4';

describe('durable blog generation run source contract', () => {
  const source = readFileSync('src/lib/blog-generation-run-v4.ts', 'utf8');

  it('keeps attempts append-only and accepts only an identical idempotent retry', () => {
    expect(source).toContain(".from('blog_generation_attempts')\n    .insert(attemptPayload)\n    .select('id')");
    expect(source).toContain('finish_reason: input.receipt.finishReason');
    expect(source).toContain('thinking_mode: input.receipt.thinkingMode');
    expect(source).toContain("status: input.attemptStatus ?? 'completed'");
    expect(source).toContain('error_code: input.errorCode ?? null');
    expect(source).toContain("existingAttempt?.output_hash === outputHash");
    expect(source).toContain('generation_attempt_number_conflict');
    expect(source).toContain('generation_attempt_id_missing');
    expect(source).toContain('selected_attempt_id: selectedAttemptId');
    expect(source).toContain(".not('selected_attempt_id', 'is', null)");
    expect(source).not.toContain(".from('blog_generation_attempts').upsert");
  });

  it('fails closed when attempt evidence cannot be persisted', () => {
    expect(source).toContain("disposition: 'attempt_persistence_failed'");
    expect(source).toContain("status: 'failed'");
    expect(source).toContain('approved_generation_run_not_found');
  });

  it('requires an atomic budget reservation before a provider call and retains unknown-cost reservations', () => {
    expect(source).toContain(".rpc('reserve_blog_ai_budget_v4'");
    expect(source).toContain('budget_reservation_unavailable:');
    expect(source).toContain(".rpc('settle_blog_ai_budget_v4'");
    expect(source).toContain('p_retain_reservation: actualUsd == null');
    expect(source).toContain('p_receipt: input.receipt ?? {}');
  });

  it('advances past a retained transport-failure reservation instead of colliding forever', () => {
    expect(source).toContain(".from('blog_ai_budget_reservations')");
    expect(source).toContain(".order('attempt_number', { ascending: false })");
    expect(nextBlogModelCallAttemptNumberV4(0)).toBe(1);
    expect(nextBlogModelCallAttemptNumberV4(1)).toBe(2);
    expect(nextBlogModelCallAttemptNumberV4(2)).toBe(3);
    expect(nextBlogModelCallAttemptNumberV4(3)).toBe(3);
  });

  it('persists provider-neutral Gemini token receipts without fabricating a price', () => {
    expect(source).toContain('cost?.inputTokens ?? usage?.inputTokens ?? null');
    expect(source).toContain('input.receipt.estimatedCostUsd ?? cost?.estimatedCostUsd ?? null');
  });
});
