import { describe, expect, it } from 'vitest';
import { auditRagIndexRows, getRagIndexIssueSeverity } from './rag-index-audit';
import type { RagIndexAuditRow } from './rag-index-audit';

const NOW = new Date('2026-06-05T00:00:00.000Z');

function row(overrides: Partial<RagIndexAuditRow>): RagIndexAuditRow {
  return {
    id: crypto.randomUUID(),
    tenant_id: null,
    source_type: 'package',
    source_id: crypto.randomUUID(),
    source_url: '/packages/sample',
    source_title: 'Sample Package',
    chunk_index: 0,
    chunk_text: 'A sufficiently detailed product chunk with itinerary, inclusion, destination, and booking policy facts.',
    contextual_text: 'This package context explains where the chunk belongs before the detailed product chunk with itinerary, inclusion, destination, and booking policy facts.',
    content_hash: 'hash-1',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Jarvis live RAG index audit', () => {
  it('marks a healthy source-balanced sample as ready', () => {
    const summary = auditRagIndexRows([
      row({ source_type: 'package' }),
      row({ source_type: 'blog', source_url: '/blog/sample', source_title: 'Sample Blog' }),
      row({ source_type: 'attraction', source_url: null, source_title: 'Sample Attraction' }),
      row({ source_type: 'policy', source_url: null, source_title: 'Sample Policy' }),
    ], { now: NOW });

    expect(summary.readinessLevel).toBe('ready');
    expect(summary.qualityScore).toBe(100);
    expect(summary.remediationActions).toEqual([]);
    expect(summary.coverage.missingSourceTypes).toEqual([]);
    expect(summary.sourceBreakdown.map((source) => source.sourceType).sort()).toEqual([
      'attraction',
      'blog',
      'package',
      'policy',
    ]);
  });

  it('detects stale, short, uncontextualized, and duplicate chunks', () => {
    const sourceId = crypto.randomUUID();
    const duplicated = {
      tenant_id: null,
      source_type: 'package',
      source_id: sourceId,
      source_url: '/packages/duplicate',
      chunk_index: 0,
    };
    const summary = auditRagIndexRows([
      row({
        ...duplicated,
        id: 'chunk-a',
        chunk_text: 'too short',
        contextual_text: 'too short',
        content_hash: null,
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
      row({
        ...duplicated,
        id: 'chunk-b',
        contextual_text: 'A sufficiently detailed product chunk with itinerary, inclusion, destination, and booking policy facts. This sentence keeps the context long enough for the audit threshold.',
      }),
    ], {
      now: NOW,
      expectedSourceTypes: ['package'],
    });

    expect(summary.readinessLevel).toBe('blocked');
    expect(summary.issueCounts.short_chunk_text).toBe(1);
    expect(summary.issueCounts.short_contextual_text).toBe(1);
    expect(summary.issueCounts.context_not_enriched).toBe(1);
    expect(summary.issueCounts.missing_content_hash).toBe(1);
    expect(summary.issueCounts.stale_chunk).toBe(1);
    expect(summary.issueCounts.duplicate_source_chunk).toBe(2);
    expect(summary.samples).toHaveLength(2);
    expect(summary.remediationActions[0]?.id).toBe('dedupe-source-chunks');
    expect(summary.remediationActions.map((action) => action.id)).toContain('review-thin-rag-content');
    expect(summary.remediationActions.flatMap((action) => action.commands)).toContain('node db/rag_reindex_all.js --source=packages');
  });

  it('penalizes missing expected source coverage', () => {
    const summary = auditRagIndexRows([
      row({ source_type: 'package' }),
    ], {
      now: NOW,
      expectedSourceTypes: ['package', 'blog', 'attraction', 'policy'],
    });

    expect(summary.coverage.missingSourceTypes).toEqual(['blog', 'attraction', 'policy']);
    expect(summary.issueCounts.missing_expected_source).toBe(3);
    expect(summary.qualityScore).toBeLessThan(100);
    expect(getRagIndexIssueSeverity('missing_expected_source')).toBe('warning');
    expect(summary.remediationActions).toEqual([
      expect.objectContaining({
        id: 'restore-source-coverage',
        affectedSourceTypes: ['blog', 'attraction', 'policy'],
        commands: [
          'npm run audit:jarvis-rag -- --source=blog',
          'npm run audit:jarvis-rag -- --source=attraction',
          'npm run audit:jarvis-rag -- --source=policy',
          'node db/rag_reindex_all.js --source=blogs',
          'node db/rag_reindex_all.js --source=attractions',
          'npx tsx scripts/seed-jarvis-policy-knowledge.ts',
        ],
      }),
    ]);
  });

  it('does not penalize coverage for source-specific audits', () => {
    const summary = auditRagIndexRows([
      row({ source_type: 'blog', source_url: '/blog/sample', source_title: 'Sample Blog' }),
    ], {
      now: NOW,
      expectedSourceTypes: ['blog'],
    });

    expect(summary.readinessLevel).toBe('ready');
    expect(summary.coverage.missingSourceTypes).toEqual([]);
    expect(summary.issueCounts.missing_expected_source).toBe(0);
  });
});
