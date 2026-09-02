import { describe, expect, it } from 'vitest';

import {
  BLOG_RUNTIME_RESOURCES_V3,
  probeBlogRuntimeSchemaReadinessV3,
  probeBlogRuntimeSchemaWithSupabaseV3,
} from './blog-runtime-readiness-v3';

describe('blog runtime schema readiness v3', () => {
  it('requires every publish resource instead of trusting the latest migration number', async () => {
    const report = await probeBlogRuntimeSchemaReadinessV3(async (resource) => ({
      error: resource.key === 'publication_decisions'
        ? { code: '42P01', message: 'relation does not exist' }
        : null,
    }), new Date('2026-08-12T00:00:00.000Z'));

    expect(report.publishReady).toBe(false);
    expect(report.fullyReady).toBe(false);
    expect(report.missing).toContain('publication_decisions');
    expect(report.checkedAt).toBe('2026-08-12T00:00:00.000Z');
  });

  it('treats keyword-family storage as a publish prerequisite', () => {
    expect(BLOG_RUNTIME_RESOURCES_V3).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'keyword_families', scope: 'publish' }),
      expect.objectContaining({ key: 'keyword_family_members', scope: 'publish' }),
    ]));
  });

  it('requires the least-privilege public slug registry for hard 404 responses', () => {
    expect(BLOG_RUNTIME_RESOURCES_V3).toContainEqual(expect.objectContaining({
      key: 'public_slug_registry_v1',
      table: 'public_blog_slug_registry',
      columns: 'id,slug',
      scope: 'delivery',
    }));
  });

  it('requires the V4 durable generation ledger before generation or publication', () => {
    expect(BLOG_RUNTIME_RESOURCES_V3).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'generation_runs_v4',
        scope: 'publish',
        columns: expect.stringContaining('selected_attempt_id'),
      }),
      expect.objectContaining({
        key: 'generation_attempts_v4',
        scope: 'publish',
        columns: expect.stringContaining('finish_reason'),
      }),
      expect.objectContaining({ key: 'model_price_catalog_v4', scope: 'publish' }),
      expect.objectContaining({ key: 'publishing_policy_v4', scope: 'publish' }),
    ]));
  });

  it('requires lifecycle classification and deployment provenance before V4 public delivery', () => {
    expect(BLOG_RUNTIME_RESOURCES_V3).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'indexing_reports_lifecycle_v4', scope: 'delivery' }),
      expect.objectContaining({ key: 'visibility_lifecycle_v4', scope: 'delivery' }),
      expect.objectContaining({ key: 'classification_revisions_v4', scope: 'delivery' }),
      expect.objectContaining({
        key: 'generation_runs_v4',
        columns: expect.stringContaining('deployment_commit_sha'),
      }),
    ]));
  });

  it('reports scope readiness independently for safe operator diagnosis', async () => {
    const report = await probeBlogRuntimeSchemaReadinessV3(async (resource) => ({
      error: resource.scope === 'measurement'
        ? { code: 'PGRST204', message: 'missing measurement projection' }
        : null,
    }));

    expect(report.publishReady).toBe(true);
    expect(report.deliveryReady).toBe(true);
    expect(report.measurementReady).toBe(false);
    expect(report.missing.length).toBe(
      BLOG_RUNTIME_RESOURCES_V3.filter((resource) => resource.scope === 'measurement').length,
    );
  });

  it('fails closed when a probe throws', async () => {
    const report = await probeBlogRuntimeSchemaReadinessV3(async (resource) => {
      if (resource.key === 'public_snapshots') throw new Error('network timeout');
      return { error: null };
    });

    expect(report.deliveryReady).toBe(false);
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'public_snapshots',
        ready: false,
        errorCode: 'probe_exception',
        errorMessage: 'network timeout',
      }),
    ]));
  });

  it('uses a bounded GET projection because PostgREST HEAD can mask missing relations', async () => {
    const calls: Array<{ table: string; columns: string; limit: number }> = [];
    const report = await probeBlogRuntimeSchemaWithSupabaseV3({
      from: (table: string) => ({
        select: (columns: string) => ({
          limit: async (limit: number) => {
            calls.push({ table, columns, limit });
            return {
              error: table === 'blog_demand_signals'
                ? { code: 'PGRST205', message: 'relation is missing' }
                : null,
            };
          },
        }),
      }),
    });

    expect(calls).toHaveLength(BLOG_RUNTIME_RESOURCES_V3.length);
    expect(calls.every((call) => call.limit === 1)).toBe(true);
    expect(report.publishReady).toBe(false);
    expect(report.missing).toContain('demand_signals');
  });
});
