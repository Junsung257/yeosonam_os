import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('durable blog generation run source contract', () => {
  const source = readFileSync('src/lib/blog-generation-run-v4.ts', 'utf8');

  it('keeps attempts append-only and accepts only an identical idempotent retry', () => {
    expect(source).toContain(".from('blog_generation_attempts')\n    .insert(attemptPayload)");
    expect(source).toContain("existingAttempt?.output_hash === outputHash");
    expect(source).toContain('generation_attempt_number_conflict');
    expect(source).not.toContain(".from('blog_generation_attempts').upsert");
  });

  it('fails closed when attempt evidence cannot be persisted', () => {
    expect(source).toContain("disposition: 'attempt_persistence_failed'");
    expect(source).toContain("status: 'failed'");
    expect(source).toContain('approved_generation_run_not_found');
  });
});
