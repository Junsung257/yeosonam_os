import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260830011340_blog_editorial_harness_v5.sql'),
  'utf8',
);
const retryMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260831011721_blog_editorial_judge_retry_v1.sql'),
  'utf8',
);
const recorder = readFileSync(resolve(process.cwd(), 'src/lib/blog-generation-run-v4.ts'), 'utf8');

describe('blog editorial harness v5 migration contract', () => {
  it('enforces complete prompt trace evidence for new approved attempts without fabricating history', () => {
    expect(migration).toContain('blog_generation_attempts_approved_prompt_trace_v1');
    expect(migration).toContain("prompt_trace_version = 'blog-prompt-trace-v1'");
    expect(migration).toContain("prompt_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("git_commit_sha ~ '^[0-9a-f]{40}$'");
    expect(migration).toContain('claim_packet_hash');
    expect(migration).toContain('not valid');
    expect(recorder).toContain('prompt_hash: input.promptTrace?.renderedPromptHash ?? null');
    expect(recorder).toContain('brief_hash: input.promptTrace?.briefHash ?? null');
  });

  it('gives generation and the independent judge separate reservations under one daily cap', () => {
    expect(migration).toContain("call_kind in ('generation', 'editorial_judge')");
    expect(migration).toContain('unique (queue_id, attempt_number, call_kind)');
    expect(migration).toContain('reserve_blog_ai_budget_v5');
    expect(migration).toContain("p_requested_usd, p_cap_usd, p_budget_day_kst, 'generation'");
    expect(recorder).toContain("p_call_kind: input.callKind ?? 'editorial_judge'");
    expect(recorder).toContain("callKind?: 'editorial_judge' | 'editorial_judge_retry'");
    expect(retryMigration).toContain("call_kind in ('generation', 'editorial_judge', 'editorial_judge_retry')");
    expect(retryMigration).toContain("p_call_kind in ('editorial_judge', 'editorial_judge_retry')");
  });
});
