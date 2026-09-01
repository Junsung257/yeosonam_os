import { describe, expect, it } from 'vitest';

import {
  buildResearchSignalTaskEnvelope,
  parseResearchSignalEnvelopeV1,
} from '@/lib/research/research-signal';

function validSignal() {
  return {
    schemaVersion: 1,
    sourceUrl: 'https://www.youtube.com/watch?v=abc&utm_source=test&token=secret#comments',
    sourcePlatform: 'youtube',
    title: '오사카 후기 test@example.com 010-1234-5678',
    collectedAt: '2026-08-31T00:00:00.000Z',
    publishedAt: '2026-08-30T03:00:00.000Z',
    collector: 'opencli',
    collectorVersion: '1.4.2',
    contentHash: `sha256:${'a'.repeat(64)}`,
    excerpt: '연락처 test@example.com / 010-1234-5678. 이동이 불편했다.',
    authorAliasHash: `sha256:${'b'.repeat(64)}`,
    evidenceClass: 'market_opinion',
    confidence: 0.72,
    officialSource: false,
    collectionMethod: 'authenticated_session',
    contentCheck: {
      bodyPresent: true,
      requiredFieldsPresent: true,
      emptyResult: false,
      loginError: false,
    },
  } as const;
}

describe('ResearchSignalEnvelopeV1', () => {
  it('normalizes tracking parameters and redacts contact data', () => {
    const parsed = parseResearchSignalEnvelopeV1(validSignal());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.sourceUrl).toBe('https://www.youtube.com/watch?v=abc');
    expect(parsed.data.title).toContain('[email-redacted]');
    expect(parsed.data.title).toContain('[phone-redacted]');
    expect(parsed.data.excerpt).toContain('[email-redacted]');
    expect(parsed.data.excerpt).toContain('[phone-redacted]');
  });

  it('rejects private hosts, moving versions, and empty-result health checks', () => {
    const privateHost = parseResearchSignalEnvelopeV1({ ...validSignal(), sourceUrl: 'https://127.0.0.1/admin' });
    const movingVersion = parseResearchSignalEnvelopeV1({ ...validSignal(), collectorVersion: 'main' });
    const emptyResult = parseResearchSignalEnvelopeV1({
      ...validSignal(),
      contentCheck: { ...validSignal().contentCheck, emptyResult: true },
    });

    expect(privateHost.success).toBe(false);
    expect(movingVersion.success).toBe(false);
    expect(emptyResult.success).toBe(false);
  });

  it('rejects future collection times and publication after collection', () => {
    const futureCollection = parseResearchSignalEnvelopeV1({
      ...validSignal(),
      collectedAt: '2999-01-01T00:00:00.000Z',
    });
    const publicationAfterCollection = parseResearchSignalEnvelopeV1({
      ...validSignal(),
      publishedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(futureCollection.success).toBe(false);
    expect(publicationAfterCollection.success).toBe(false);
  });

  it('maps every signal to a review-only idempotent agent task', () => {
    const parsed = parseResearchSignalEnvelopeV1(validSignal());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const first = buildResearchSignalTaskEnvelope(parsed.data, '018fe3d4-8dc3-7c29-a33d-9ecac7ef1d9c');
    const second = buildResearchSignalTaskEnvelope(parsed.data, '018fe3d4-8dc3-7c29-a33d-9ecac7ef1d9c');

    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first).toMatchObject({
      source: 'research_node',
      agentType: 'marketing',
      status: 'queued',
      riskLevel: 'medium',
      taskContext: {
        disposition: 'review_required',
        publicationAllowed: false,
        productFactAllowed: false,
      },
    });
  });
});
