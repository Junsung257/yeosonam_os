import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildBlogInformationAutomatedReplacementIdempotencyKey } from './blog-information-atomic-publication';

const migration = readFileSync(
  'supabase/migrations/20260817043000_blog_automated_atomic_replacement_v1.sql',
  'utf8',
);

describe('automated informational replacement contract', () => {
  it('is service-role only and commits content, representative, queue, run, and indexing atomically', () => {
    expect(migration).toContain('security definer');
    expect(migration).toContain('set search_path =');
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to service_role');
    expect(migration).toContain('update public.content_creatives');
    expect(migration).toContain('update public.blog_information_representatives');
    expect(migration).toContain('update public.blog_topic_queue');
    expect(migration).toContain('update public.blog_generation_runs');
    expect(migration).toContain('insert into public.blog_indexing_jobs');
    expect(migration).toContain('insert into public.blog_information_automated_replacements');
  });

  it('revalidates the immutable DeepSeek attempt and forbids HIGH-risk automation', () => {
    expect(migration).toContain("v_attempt.provider <> 'deepseek'");
    expect(migration).toContain("v_attempt.route <> 'approved_for_slot'");
    expect(migration).toContain("v_attempt.finish_reason, '') <> 'stop'");
    expect(migration).toContain('jsonb_array_length(coalesce(v_attempt.hard_blockers');
    expect(migration).toContain('jsonb_array_length(coalesce(v_attempt.failure_reasons');
    expect(migration).toContain("coalesce(v_brief ->> 'risk_level', 'HIGH') not in ('LOW', 'MEDIUM')");
    expect(migration).toContain('HIGH-risk or human-review content cannot use automated replacement');
    expect(migration).toContain("coalesce(v_autopublish ->> 'mode', '') <> 'live'");
    expect(migration).toContain("v_representative.status <> 'active'");
  });

  it('preserves canonical identity and archives only the isolated shadow draft', () => {
    expect(migration).toContain('or coalesce(v_contract ->> \'canonical_slug\', \'\') <> v_target.slug');
    expect(migration).toContain("set status = 'archived'");
    expect(migration).toContain("status = 'published'");
    expect(migration).toContain('published_at = coalesce(v_target.published_at, v_now)');
    expect(migration).toContain("'URL_UPDATED', 'pending'");
  });

  it('builds a stable key bound to run and selected attempt', () => {
    const base = {
      replacementDraftId: 'draft-1',
      targetCreativeId: 'target-1',
      runId: 'run-1',
      selectedAttemptId: 'attempt-3',
      sourceFingerprint: 'a'.repeat(64),
      representativeKey: 'v1|danang|itinerary|general|ko-KR',
    };
    expect(buildBlogInformationAutomatedReplacementIdempotencyKey(base))
      .toBe(buildBlogInformationAutomatedReplacementIdempotencyKey(base));
    expect(buildBlogInformationAutomatedReplacementIdempotencyKey(base))
      .not.toBe(buildBlogInformationAutomatedReplacementIdempotencyKey({
        ...base,
        selectedAttemptId: 'attempt-2',
      }));
  });
});
