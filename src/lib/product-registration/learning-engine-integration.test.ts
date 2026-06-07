import { describe, expect, it } from 'vitest';

import type { ImprovementLedgerEvent } from './improvement-ledger';
import { persistImprovementLedgerEvents } from './improvement-ledger-persistence';
import { loadProductRegistrationLearningReport } from './learning-engine-report';

type Row = Record<string, unknown>;

function event(index: number): ImprovementLedgerEvent {
  return {
    uploadId: `upload-${index}`,
    productId: `PUS-LA-PQC-05-${String(index).padStart(4, '0')}`,
    packageId: '550e8400-e29b-41d4-a716-446655440000',
    attemptNo: 1,
    rawTextHash: `${index.toString(16).padStart(64, '0')}`.slice(0, 64),
    sectionRawTextHash: null,
    parserVersion: 'product-registration-central',
    detectedFormat: 'catalog_pkg',
    blockersBefore: ['price storage mismatch: product_prices missing date 2026-07-24'],
    blockersAfter: [],
    normalizedBlockerSignatures: ['price storage mismatch: product_prices missing date <date>'],
    evidenceSpans: [{
      field: 'price_dates',
      rawTextHash: `${index.toString(16).padStart(64, '0')}`.slice(0, 64),
      start: 10,
      end: 18,
      quote: '859,000',
      sourceKind: 'line',
      confidence: 0.95,
    }],
    comparedFields: ['product_prices', 'price_dates'],
    autoFixesApplied: [{
      field: 'price_dates',
      kind: 'deterministic',
      reason: 'rebuild date-level minimum from product_prices',
      confidence: 0.95,
    }],
    packagesAudit: { status: 'pass', failures: [], warnings: [] },
    a4Audit: { status: 'pass', failures: [], warnings: [] },
    finalStatus: 'AUTO_FIXED',
    fixtureCandidate: false,
    ruleCandidate: true,
    createdAt: `2026-06-07T00:${String(index).padStart(2, '0')}:00.000Z`,
  };
}

function memorySupabase(rows: Row[]) {
  return {
    from(table: string) {
      expect(table).toBe('product_registration_improvement_events');
      return {
        async insert(insertRows: Row[]) {
          rows.push(...insertRows);
          return { error: null };
        },
        select() {
          let since: string | null = null;
          let limit = rows.length;
          const query = {
            order() {
              return query;
            },
            limit(value: number) {
              limit = value;
              return query;
            },
            gte(_field: string, value: string) {
              since = value;
              return query;
            },
            then(resolve: (value: { data: Row[]; error: null }) => unknown) {
              const data = rows
                .filter(row => !since || String(row.created_at) >= since)
                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
                .slice(0, limit);
              return Promise.resolve({ data, error: null }).then(resolve);
            },
          };
          return query;
        },
      };
    },
  };
}

describe('product registration learning engine integration', () => {
  it('flows from persisted micro events to a 100-point macro report with promotion work items', async () => {
    const rows: Row[] = [];
    const supabase = memorySupabase(rows);
    const events = Array.from({ length: 50 }, (_, index) => event(index));

    const persistence = await persistImprovementLedgerEvents({
      supabase: supabase as never,
      isSupabaseConfigured: true,
      events,
    });
    const report = await loadProductRegistrationLearningReport({
      supabase: supabase as never,
      isSupabaseConfigured: true,
      since: '2026-06-01T00:00:00.000Z',
      limit: 1000,
      fullRegressionVerified: true,
    });

    expect(persistence).toEqual({ saved: 50, error: null });
    expect(report.micro.eventsPersisted).toBe(50);
    expect(report.macro.shouldRun).toBe(true);
    expect(report.promotion.workItems.length).toBeGreaterThan(0);
    expect(report.score).toEqual(expect.objectContaining({
      micro: 100,
      macro: 100,
      combined: 100,
      productionReady: true,
    }));
    expect(report.safety).toEqual({
      readOnly: true,
      productionMutation: false,
      rawTextStored: false,
      promotionRequiresReview: true,
    });
  });
});
