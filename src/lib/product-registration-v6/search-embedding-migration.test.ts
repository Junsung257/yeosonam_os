import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

const sql = fs.readFileSync(
  `${process.cwd()}/supabase/migrations/20260817040000_product_registration_snapshot_search_embeddings.sql`,
  'utf8',
);

describe('snapshot search embedding projection migration', () => {
  it('binds embeddings to the current immutable publication pointer', () => {
    expect(sql).toContain('internal_product_registration.product_search_embeddings');
    expect(sql).toContain("pointer.state = 'published'");
    expect(sql).toContain('pointer.current_snapshot_id = v_snapshot_id');
    expect(sql).toContain('snapshot.snapshot_hash = v_snapshot_hash');
    expect(sql).toContain('PRODUCT_SEARCH_EMBEDDING_POINTER_STALE');
    expect(sql).not.toMatch(/update\s+public\.travel_packages/iu);
  });

  it('keeps both RPCs service-role only and validates vector dimensions', () => {
    expect(sql).toContain('extensions.vector_dims(v_embedding) <> 1536');
    expect(sql).toContain('revoke all on function public.claim_product_registration_search_embedding_candidates');
    expect(sql).toContain('revoke all on function public.persist_product_registration_search_embedding');
    expect(sql).toContain('to service_role');
  });
});
