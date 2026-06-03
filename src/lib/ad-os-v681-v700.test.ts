import { describe, expect, it } from 'vitest';
import { buildAdOsAdminSurfaceQaMatrix } from '@/lib/ad-os-v681-v700';
import type { AdOsStagingValidationPackage } from '@/lib/ad-os-v641-v660';

const stagingValidation: AdOsStagingValidationPackage = {
  status: 'pass',
  readiness_score: 96,
  passed: 7,
  warnings: 0,
  failed: 0,
  checks: [],
  gates: {
    read_only_smoke: 'pass',
    db_backed_summary: 'pass',
    operating_inventory: 'pass',
    live_spend_preflight: 'pass',
    learning_evidence: 'pass',
    external_write_safety: 'pass',
    full_auto_safety: 'pass',
  },
  top_blocker: null,
  next_action: 'Staging validation is clean.',
  safety: {
    read_only: true,
    database_mutation: false,
    external_api_write: false,
    live_spend_krw: 0,
    full_auto_allowed: false,
  },
};

const baseInput = {
  stagingValidation,
  channelExecutionStates: {
    naver: { state: 'executable' },
    google: { state: 'no_campaign' },
  },
  enterpriseLayer: {
    completion_audit: {
      status: 'ready',
      failed: 0,
      warnings: 0,
      readiness_score: 95,
      next_action: 'Keep evidence current.',
    },
    platform_job_queue: {
      total: 2,
      blocked: 0,
      external_api_write_count: 0,
    },
    creative_factory: {
      variants: 5,
      duplicate_content_risks: 0,
    },
    conversion_data_quality: {
      uploadable_conversions: 2,
      blocked_conversions: 0,
    },
  },
  counts: {
    blog_ad_mappings: { total: 3 },
    blog_visibility_snapshots: { total: 2 },
    blog_topic_clusters: { total: 4 },
  },
  learningLoop: {
    metrics: {
      fact_clicks_30d: 80,
      fact_conversions_30d: 4,
    },
  },
};

describe('buildAdOsAdminSurfaceQaMatrix', () => {
  it('passes when all six admin surfaces have current evidence', () => {
    const result = buildAdOsAdminSurfaceQaMatrix(baseInput);

    expect(result.status).toBe('pass');
    expect(result.surfaces).toHaveLength(6);
    expect(result.failed).toBe(0);
    expect(result.surfaces.find((surface) => surface.id === 'search_ads')?.status).toBe('pass');
    expect(result.safety.external_api_write).toBe(false);
  });

  it('fails search ads when a channel is permission denied', () => {
    const result = buildAdOsAdminSurfaceQaMatrix({
      ...baseInput,
      channelExecutionStates: {
        naver: { state: 'permission_denied' },
        google: { state: 'no_campaign' },
      },
    });

    expect(result.status).toBe('fail');
    expect(result.top_gap).toBe('Search ads');
    expect(result.surfaces.find((surface) => surface.id === 'search_ads')?.next_action).toContain('permission_denied');
  });

  it('fails topical authority when duplicate content risk is present', () => {
    const result = buildAdOsAdminSurfaceQaMatrix({
      ...baseInput,
      enterpriseLayer: {
        ...baseInput.enterpriseLayer,
        creative_factory: {
          variants: 5,
          duplicate_content_risks: 2,
        },
      },
    });

    expect(result.status).toBe('fail');
    expect(result.surfaces.find((surface) => surface.id === 'blog_topical')?.status).toBe('fail');
    expect(result.surfaces.find((surface) => surface.id === 'blog_topical')?.next_action).toContain('near-duplicate');
  });

  it('warns rankings when visibility snapshots are missing even if learning facts exist', () => {
    const result = buildAdOsAdminSurfaceQaMatrix({
      ...baseInput,
      counts: {
        ...baseInput.counts,
        blog_visibility_snapshots: { total: 0 },
      },
    });

    expect(result.status).toBe('warn');
    expect(result.surfaces.find((surface) => surface.id === 'blog_rankings')?.status).toBe('warn');
    expect(result.surfaces.find((surface) => surface.id === 'blog_rankings')?.next_action).toContain('request submitted');
  });
});
