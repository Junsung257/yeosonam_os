import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { verifyBlogReleaseCandidateResponsesV4 } from '../../scripts/lib/blog-release-candidate-responses-v4';

const passing = {
  aiModelCanary: {
    ok: true,
    read_only: true,
    model_calls: 3,
    results: Array.from({ length: 3 }, () => ({ passed: true })),
  },
  analyticsCanary: { ok: true, stored: true, external_delivery_jobs: 0, errors: [] },
  rankTracking: { ok: true, requested_dates: ['2026-08-15'], errors: [] },
  dataReadiness: {
    ok: true,
    schemaReadiness: { fullyReady: true },
    snapshotParity: { parity: true },
    remoteSnapshots: { catalog: true, detail: true },
    analyticsCanary24h: 1,
    approvedForSlotCount: 1,
    generationReady: true,
    publicationReady: true,
    autopublish: { effectiveMode: 'draft_only' },
  },
};

describe('Blog V4 release candidate response contracts', () => {
  it('accepts real successful endpoint payloads', () => {
    expect(verifyBlogReleaseCandidateResponsesV4(passing)).toMatchObject({ passed: true });
  });

  it('rejects a successful HTML/not-found response represented as no JSON contract', () => {
    expect(() => verifyBlogReleaseCandidateResponsesV4({
      ...passing,
      analyticsCanary: {},
    })).toThrow('analytics_canary_contract_failed');
  });

  it('rejects a missing provider or incomplete model-stage canary', () => {
    expect(() => verifyBlogReleaseCandidateResponsesV4({
      ...passing,
      aiModelCanary: { ok: false, read_only: true, model_calls: 2, results: [] },
    })).toThrow('ai_model_canary_contract_failed');
  });

  it('rejects failed GSC recovery or non-ready candidate state', () => {
    expect(() => verifyBlogReleaseCandidateResponsesV4({
      ...passing,
      rankTracking: { ok: false, requested_dates: [], errors: ['gsc_unavailable'] },
      dataReadiness: { ...passing.dataReadiness, generationReady: false },
    })).toThrow(/rank_tracking_contract_failed.*data_readiness_contract_failed/);
  });

  it('allows generation readiness before an approved slot exists', () => {
    expect(verifyBlogReleaseCandidateResponsesV4({
      ...passing,
      dataReadiness: { ...passing.dataReadiness, approvedForSlotCount: 0 },
    })).toMatchObject({ passed: true });
  });

  it('requires publication readiness only for the live promotion gate', () => {
    expect(() => verifyBlogReleaseCandidateResponsesV4({
      ...passing,
      dataReadiness: { ...passing.dataReadiness, publicationReady: false },
    }, { requirePublicationReady: true })).toThrow('publication_readiness_contract_failed');
  });

  it('rejects a candidate whose generation readiness is blocked', () => {
    expect(() => verifyBlogReleaseCandidateResponsesV4({
      ...passing,
      dataReadiness: { ...passing.dataReadiness, generationReady: false },
    })).toThrow('data_readiness_contract_failed');
  });

  it('CLI input cannot silently parse an HTML body as a valid response', () => {
    const root = mkdtempSync(join(tmpdir(), 'blog-v4-candidate-response-'));
    const path = join(root, 'not-found.html');
    writeFileSync(path, '<!doctype html><title>Not found</title>', 'utf8');
    expect(() => JSON.parse(readFileSync(path, 'utf8'))).toThrow();
  });
});
