import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function migration(name: string): string {
  return readFileSync(join(process.cwd(), 'supabase', 'migrations', name), 'utf8');
}

describe('informational existing-table index migrations', () => {
  const sourceVersions = migration('20260715226000_blog_information_source_versions.sql');
  const evidenceIndexes = migration('20260715226500_blog_information_evidence_concurrent_indexes.sql');
  const reviewWorkflow = migration('20260715227000_blog_information_review_workflow.sql');
  const reviewQueueIndex = migration('20260715227750_blog_information_review_queue_concurrent_index.sql');
  const atomicPublication = migration('20260715228000_blog_information_atomic_publication.sql');
  const indexingJobsIndex = migration('20260715228500_blog_indexing_jobs_concurrent_index.sql');
  const localDatabaseContract = readFileSync(
    join(process.cwd(), 'supabase', 'tests', 'blog_information_publication_contract.sql'),
    'utf8',
  );

  it('keeps existing-table index builds outside explicit transactions and uses CONCURRENTLY', () => {
    for (const sql of [evidenceIndexes, reviewQueueIndex, indexingJobsIndex]) {
      expect(sql).toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY/i);
      expect(sql).not.toMatch(/^\s*(?:BEGIN|COMMIT)\s*;/im);
    }
  });

  it('removes blocking index builds from the transactional schema migrations', () => {
    expect(sourceVersions).not.toContain('CREATE UNIQUE INDEX IF NOT EXISTS blog_information_evidence_legacy_logical_key');
    expect(reviewWorkflow).not.toContain('CREATE INDEX IF NOT EXISTS idx_content_review_queue_information_case');
    expect(atomicPublication).not.toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_indexing_jobs_idempotency_key');
  });

  it('preserves every required uniqueness and lookup index', () => {
    expect(evidenceIndexes).toContain('blog_information_evidence_content_logical_source_version_key');
    expect(evidenceIndexes).toContain('blog_information_evidence_legacy_logical_key');
    expect(reviewQueueIndex).toContain('idx_content_review_queue_information_case');
    expect(indexingJobsIndex).toContain('idx_blog_indexing_jobs_idempotency_key');
  });

  it('ships a local-only pgTAP contract for RLS, privileges, indexes, and legacy RPC removal', () => {
    expect(localDatabaseContract).toContain('SELECT plan(20)');
    expect(localDatabaseContract).toContain("has_function_privilege('anon'");
    expect(localDatabaseContract).toContain("has_function_privilege('service_role'");
    expect(localDatabaseContract).toContain('relrowsecurity');
    expect(localDatabaseContract).toContain('indisvalid');
    expect(localDatabaseContract).toContain('publish_blog_information_reviewed_draft');
    expect(localDatabaseContract).not.toMatch(/travel_packages|package_publication|product_snapshot/);
  });
});
