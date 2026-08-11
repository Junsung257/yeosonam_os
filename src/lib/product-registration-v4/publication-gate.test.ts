import { describe, expect, it } from 'vitest';

import { loadProductRegistrationV4PublicationGate } from './publication-gate';

function fakeSupabase(input: {
  draft?: Record<string, unknown> | null;
  job?: Record<string, unknown> | null;
  normalization?: Record<string, unknown> | null;
}) {
  const calls = new Map<string, number>();
  return {
    from(table: string) {
      const chain: Record<string, (...args: unknown[]) => unknown> = {};
      const passthrough = () => chain;
      chain.select = passthrough;
      chain.eq = passthrough;
      chain.not = passthrough;
      chain.in = passthrough;
      chain.order = passthrough;
      chain.limit = passthrough;
      chain.maybeSingle = async () => {
        const count = (calls.get(table) ?? 0) + 1;
        calls.set(table, count);
        if (table === 'product_registration_drafts') return { data: input.draft ?? null, error: null };
        if (table === 'upload_jobs') return { data: input.job ?? null, error: null };
        return { data: input.normalization ?? null, error: null };
      };
      return chain;
    },
  };
}

describe('product registration V4 publication gate', () => {
  it('requires a complete lineage-bound normalization before approval', async () => {
    const gate = await loadProductRegistrationV4PublicationGate({
      supabase: fakeSupabase({
        draft: { upload_job_id: 'job-1' },
        job: {
          id: 'job-1',
          source_document_id: 'source-1',
          extraction_id: 'extraction-1',
          v4_stage: 'normalized',
          v4_stage_state: {},
          v4_canonical_normalization_id: 'normalization-1',
        },
        normalization: {
          id: 'normalization-1',
          job_id: 'job-1',
          source_document_id: 'source-1',
          extraction_id: 'extraction-1',
          normalization_version: 'v4-canonical-2026-08-07',
          raw_text_hash: 'a'.repeat(64),
          canonical_payload: { sections: [{ index: 0 }] },
          status: 'complete',
        },
      }) as never,
      packageId: 'package-1',
    });
    expect(gate.ok).toBe(true);
    expect(gate.code).toBe('CANONICAL_NORMALIZATION_READY');
    expect(gate.sectionCount).toBe(1);
  });

  it('blocks a V4 job whose canonical snapshot is not ready', async () => {
    const gate = await loadProductRegistrationV4PublicationGate({
      supabase: fakeSupabase({
        draft: { upload_job_id: 'job-1' },
        job: {
          id: 'job-1',
          source_document_id: 'source-1',
          extraction_id: 'extraction-1',
          v4_stage: 'normalized',
          v4_stage_state: {},
          v4_canonical_normalization_id: null,
        },
      }) as never,
      packageId: 'package-1',
    });
    expect(gate.ok).toBe(false);
    expect(gate.code).toBe('CANONICAL_JOB_NOT_READY');
  });
});
