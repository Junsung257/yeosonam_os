import { describe, expect, it } from 'vitest';

import type { ImprovementLedgerEvent } from './improvement-ledger';
import {
  buildProductRegistrationLearningReport,
  mapImprovementLedgerRowToEvent,
} from './learning-engine-report';

function event(overrides: Partial<ImprovementLedgerEvent> = {}): ImprovementLedgerEvent {
  return {
    uploadId: 'upload-1',
    productId: 'PUS-LA-PQC-05-0001',
    packageId: '550e8400-e29b-41d4-a716-446655440000',
    attemptNo: 0,
    attemptPhase: 'normal_registration',
    rawTextHash: 'a'.repeat(64),
    sectionRawTextHash: null,
    parserVersion: 'product-registration-central',
    detectedFormat: 'catalog_pkg',
    blockersBefore: ['schedule pollution: ZE981'],
    blockersAfter: [],
    normalizedBlockerSignatures: ['schedule pollution: <flight>'],
    evidenceSpans: [],
    comparedFields: ['itinerary'],
    autoFixesApplied: [{
      field: 'itinerary',
      kind: 'deterministic',
      reason: 'pruned standalone flight token',
      confidence: 0.92,
    }],
    packagesAudit: { status: 'pass', failures: [], warnings: [] },
    a4Audit: { status: 'pass', failures: [], warnings: [] },
    finalStatus: 'AUTO_FIXED',
    fixtureCandidate: false,
    ruleCandidate: true,
    createdAt: '2026-06-07T00:00:00.000Z',
    ...overrides,
  };
}

describe('product registration learning engine report', () => {
  it('maps durable DB rows back to improvement events', () => {
    const mapped = mapImprovementLedgerRowToEvent({
      created_at: '2026-06-07T00:00:00.000Z',
      upload_id: 'upload-1',
      product_id: 'PUS-LA-PQC-05-0001',
      package_id: '550e8400-e29b-41d4-a716-446655440000',
      attempt_no: 2,
      attempt_phase: 'render_payload_audit_repair',
      raw_text_hash: 'a'.repeat(64),
      section_raw_text_hash: null,
      parser_version: null,
      detected_format: 'catalog_pkg',
      final_status: 'BLOCKED',
      blockers_before: ['missing price'],
      blockers_after: ['missing price'],
      normalized_blocker_signatures: ['missing price'],
      evidence_spans: [],
      compared_fields: ['price_dates'],
      auto_fixes_applied: [],
      packages_audit: { status: 'fail', failures: ['no price'], warnings: [] },
      a4_audit: { status: 'unknown', failures: [], warnings: [] },
      fixture_candidate: true,
      rule_candidate: true,
    });

    expect(mapped).toEqual(expect.objectContaining({
      attemptNo: 2,
      attemptPhase: 'render_payload_audit_repair',
      finalStatus: 'BLOCKED',
      blockersBefore: ['missing price'],
      packagesAudit: { status: 'fail', failures: ['no price'], warnings: [] },
      fixtureCandidate: true,
      ruleCandidate: true,
    }));
  });

  it('builds a read-only macro report from repeated durable events', () => {
    const events = Array.from({ length: 50 }, (_, index) => event({
      uploadId: `upload-${index}`,
      rawTextHash: String(index).padStart(64, 'a').slice(-64),
      createdAt: `2026-06-07T00:${String(index).padStart(2, '0')}:00.000Z`,
    }));

    const report = buildProductRegistrationLearningReport({
      events,
      since: '2026-06-01T00:00:00.000Z',
      limit: 500,
      fullRegressionVerified: true,
    });

    expect(report.ok).toBe(true);
    expect(report.micro.eventsPersisted).toBe(50);
    expect(report.macro.shouldRun).toBe(true);
    expect(report.macro.candidates.some(candidate => candidate.promotionReady)).toBe(true);
    expect(report.promotion.workItems.length).toBeGreaterThan(0);
    expect(report.promotion).toEqual(expect.objectContaining({
      requiresReview: true,
      autoMutationEnabled: false,
    }));
    expect(report.promotion.workItems[0].verificationCommands).toContain('npm run eval:product-registration:ci');
    expect(report.safety).toEqual({
      readOnly: true,
      productionMutation: false,
      rawTextStored: false,
      promotionRequiresReview: true,
    });
  });
});
