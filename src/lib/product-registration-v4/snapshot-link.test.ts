import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { linkV5ShadowRevisionToSnapshot } from './snapshot-link';

function fakeSupabase(input: {
  revision?: unknown;
  revisionError?: { message: string } | null;
  snapshot?: unknown;
  snapshotError?: { message: string } | null;
}) {
  const update = vi.fn(async () => ({ error: null }));
  const updateChain3 = { eq: () => { update(); return Promise.resolve({ error: null }); } };
  const updateChain2 = { eq: () => updateChain3 };
  const updateChain1 = { eq: () => updateChain2 };
  const revisionQuery = {
    select: () => revisionQuery,
    eq: () => revisionQuery,
    in: () => revisionQuery,
    order: () => revisionQuery,
    limit: () => revisionQuery,
    maybeSingle: async () => ({ data: input.revision ?? null, error: input.revisionError ?? null }),
  };
  const snapshotQuery = {
    select: () => snapshotQuery,
    eq: () => snapshotQuery,
    in: () => snapshotQuery,
    order: () => snapshotQuery,
    limit: () => snapshotQuery,
    maybeSingle: async () => ({ data: input.snapshot ?? null, error: input.snapshotError ?? null }),
  };
  const supabase = {
    from: (table: string) => table === 'product_registration_v5_revisions'
      ? revisionQuery
      : { ...snapshotQuery, update: () => updateChain1 },
  };
  return { supabase: supabase as unknown as SupabaseClient, update };
}

describe('retired V5 shadow snapshot lineage link', () => {
  it('requires the immutable snapshot CAS instead of mutating a published snapshot', async () => {
    const fake = fakeSupabase({
      revision: { id: 'revision-1', status: 'candidate', package_id: 'package-1' },
      snapshot: { id: 'snapshot-1', canonical_revision_id: null },
    });

    const result = await linkV5ShadowRevisionToSnapshot({
      supabase: fake.supabase,
      packageId: 'package-1',
      snapshotHash: 'a'.repeat(64),
      revisionId: 'revision-1',
      rendererBuildId: 'build-1',
    });

    expect(result).toEqual({ status: 'skipped', reason: 'V5_SHADOW_LINK_WRITER_RETIRED_USE_SNAPSHOT_CAS' });
    expect(fake.update).not.toHaveBeenCalled();
  });

  it('does not overwrite an already-bound snapshot', async () => {
    const fake = fakeSupabase({
      revision: { id: 'revision-2', status: 'verified', package_id: 'package-1' },
      snapshot: { id: 'snapshot-1', canonical_revision_id: 'revision-1' },
    });

    const result = await linkV5ShadowRevisionToSnapshot({
      supabase: fake.supabase,
      packageId: 'package-1',
      snapshotHash: 'b'.repeat(64),
      revisionId: 'revision-2',
    });

    expect(result).toEqual({ status: 'skipped', reason: 'V5_SHADOW_LINK_WRITER_RETIRED_USE_SNAPSHOT_CAS' });
    expect(fake.update).not.toHaveBeenCalled();
  });
});
