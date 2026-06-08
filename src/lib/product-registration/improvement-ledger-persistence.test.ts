import { describe, expect, it, vi } from 'vitest';

import type { ImprovementLedgerEvent } from './improvement-ledger';
import {
  mapImprovementLedgerEventToRow,
  persistImprovementLedgerEvents,
} from './improvement-ledger-persistence';

function event(overrides: Partial<ImprovementLedgerEvent> = {}): ImprovementLedgerEvent {
  return {
    uploadId: 'upload-1',
    productId: 'PUS-LA-PQC-05-0001',
    packageId: '550e8400-e29b-41d4-a716-446655440000',
    attemptNo: 0,
    attemptPhase: 'normal_registration',
    rawTextHash: 'a'.repeat(64),
    sectionRawTextHash: 'b'.repeat(64),
    parserVersion: 'product-registration-central',
    detectedFormat: 'catalog_pkg',
    blockersBefore: ['missing price'],
    blockersAfter: [],
    normalizedBlockerSignatures: ['missing price'],
    evidenceSpans: [{
      field: 'price',
      rawTextHash: 'a'.repeat(64),
      start: 10,
      end: 18,
      quote: '859,000',
      confidence: 0.95,
    }],
    comparedFields: ['product_prices', 'price_dates'],
    autoFixesApplied: [],
    packagesAudit: { status: 'pass', failures: [], warnings: [] },
    a4Audit: { status: 'pass', failures: [], warnings: [] },
    finalStatus: 'AUTO_FIXED',
    fixtureCandidate: false,
    ruleCandidate: true,
    createdAt: '2026-06-07T00:00:00.000Z',
    ...overrides,
  };
}

describe('improvement ledger persistence', () => {
  it('maps a micro QA event to the DB row contract without raw text', () => {
    const row = mapImprovementLedgerEventToRow(event({ packageId: 'not-a-uuid' }));

    expect(row).toEqual(expect.objectContaining({
      upload_id: 'upload-1',
      product_id: 'PUS-LA-PQC-05-0001',
      package_id: null,
      raw_text_hash: 'a'.repeat(64),
      section_raw_text_hash: 'b'.repeat(64),
      attempt_phase: 'normal_registration',
      final_status: 'AUTO_FIXED',
      normalized_blocker_signatures: ['missing price'],
    }));
    expect(row).not.toHaveProperty('raw_text');
    expect(row).not.toHaveProperty('section_raw_text');
  });

  it('skips DB writes when Supabase is not configured', async () => {
    const insert = vi.fn();
    const supabase = { from: vi.fn(() => ({ insert })) };

    const result = await persistImprovementLedgerEvents({
      supabase: supabase as never,
      isSupabaseConfigured: false,
      events: [event()],
    });

    expect(result).toEqual({ saved: 0, error: null });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('inserts events into the product-registration ledger table', async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const supabase = { from: vi.fn(() => ({ insert })) };

    const result = await persistImprovementLedgerEvents({
      supabase: supabase as never,
      isSupabaseConfigured: true,
      events: [event()],
    });

    expect(result).toEqual({ saved: 1, error: null });
    expect(supabase.from).toHaveBeenCalledWith('product_registration_improvement_events');
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        package_id: '550e8400-e29b-41d4-a716-446655440000',
        attempt_phase: 'normal_registration',
        final_status: 'AUTO_FIXED',
      }),
    ]);
  });
});
