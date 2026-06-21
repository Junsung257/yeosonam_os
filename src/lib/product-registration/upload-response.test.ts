import { describe, expect, it, vi } from 'vitest';
import { attemptPhaseFor, type ImprovementLedgerEvent } from './improvement-ledger';
import { buildUploadResponsePayload } from './upload-response';

function learningEvent(overrides: Partial<ImprovementLedgerEvent> = {}): ImprovementLedgerEvent {
  const attemptNo = overrides.attemptNo ?? 0;
  return {
    uploadId: 'upload-1',
    productId: 'PUS-ETC-CEB-05-0001',
    packageId: 'pkg-1',
    rawTextHash: 'hash-1',
    sectionRawTextHash: null,
    parserVersion: 'test',
    detectedFormat: 'hotel_column_matrix',
    blockersBefore: [],
    blockersAfter: [],
    normalizedBlockerSignatures: [],
    evidenceSpans: [],
    comparedFields: ['product_prices', 'price_dates'],
    autoFixesApplied: [],
    packagesAudit: { status: 'pass', failures: [], warnings: [] },
    a4Audit: { status: 'pass', failures: [], warnings: [] },
    finalStatus: 'PASS',
    fixtureCandidate: false,
    ruleCandidate: false,
    createdAt: '2026-06-07T00:00:00.000Z',
    ...overrides,
    attemptNo,
    attemptPhase: overrides.attemptPhase ?? attemptPhaseFor(attemptNo),
  };
}

describe('buildUploadResponsePayload learning summary', () => {
  it('includes shadow learning-engine telemetry from micro improvement events', async () => {
    const payload = await buildUploadResponsePayload({
      supabase: {} as never,
      isSupabaseConfigured: false,
      savedIds: ['pkg-1'],
      savedTitles: ['Cebu Package'],
      savedInternalCodes: ['PUS-ETC-CEB-05-0001'],
      savedConfidences: [0.91],
      saveErrors: [],
      totalPriceRowsSaved: 1,
      savedPriceRowsByPackageId: new Map([['pkg-1', 1]]),
      productsToSaveLength: 1,
      parsedDocument: { confidence: 0.9 },
      fileHash: 'abcdef123456',
      classification: null,
      inputAnalysisForTrust: null,
      preSaveV3Status: 'ready_to_publish',
      matchedAttractionCount: 0,
      unmatchedAttractionCount: 0,
      attractionSeededCount: 0,
      attractionReflectedCount: 0,
      uploadSourceMetadata: null,
      filenameSupplierRaw: null,
      marginRate: 0.1,
      fileName: 'cebu.txt',
      baseUrl: 'http://localhost:3000',
      improvementEvents: [
        learningEvent(),
        learningEvent({ attemptNo: 1, finalStatus: 'AUTO_FIXED', autoFixesApplied: [{ field: 'price_dates', kind: 'deterministic', reason: 'fix', confidence: 0.9 }] }),
      ],
      improvementEventsSaved: 2,
      improvementEventsSaveError: null,
    });

    expect(payload.learningEngine).toEqual(expect.objectContaining({
      mode: 'shadow',
      microEventsCaptured: 2,
      microEventsPersisted: 2,
      persistenceError: null,
      latestStatuses: ['PASS', 'AUTO_FIXED'],
    }));
    expect((payload.learningEngine as { score: { productionReady: boolean } }).score.productionReady).toBe(false);
  });

  it('uses structured diagnostics instead of uppercase BLOCKED text to decide the upload gate', async () => {
    const payload = await buildUploadResponsePayload({
      supabase: {} as never,
      isSupabaseConfigured: false,
      savedIds: [],
      savedTitles: [],
      savedInternalCodes: [],
      savedConfidences: [],
      saveErrors: [{
        title: '시즈오카',
        error: 'Customer landing/A4 blocked: Price source audit failed: price date disagreement: source-backed dates do not overlap recovered dates',
      }],
      totalPriceRowsSaved: 0,
      savedPriceRowsByPackageId: new Map(),
      productsToSaveLength: 1,
      parsedDocument: { confidence: 0.4 },
      fileHash: 'abcdef123456',
      classification: null,
      inputAnalysisForTrust: null,
      preSaveV3Status: 'blocked',
      matchedAttractionCount: 0,
      unmatchedAttractionCount: 0,
      attractionSeededCount: 0,
      attractionReflectedCount: 0,
      uploadSourceMetadata: null,
      filenameSupplierRaw: null,
      marginRate: 0.1,
      fileName: 'shizuoka.txt',
      baseUrl: 'http://localhost:3000',
      improvementEvents: [],
      improvementEventsSaved: 0,
      improvementEventsSaveError: null,
    });

    expect(payload.gate).toBe('BLOCKED');
    expect(payload.failureDiagnostics).toEqual(expect.objectContaining({
      hasCritical: true,
      codes: expect.arrayContaining([
        'CUSTOMER_RENDER_BLOCKED',
        'PRICE_DATE_DISAGREEMENT',
      ]),
    }));
  });

  it('marks saved review-only packages as not customer publishable', async () => {
    const fakeSupabase = {
      from: () => ({
        select: () => ({
          in: async () => ({
            data: [{
              id: 'pkg-review',
              internal_code: 'PUS-ETC-FSZ-03-0001',
              title: 'Shizuoka 3 days',
              price: 599000,
              airline: 'BX',
              status: 'REVIEW_NEEDED',
              audit_status: null,
              departure_days: '월,수',
              commission_rate: 0.09,
              land_operator: 'test',
              price_dates: [{ date: '2026-07-01', price: 599000 }],
              itinerary_data: { days: [{}, {}, {}] },
            }],
            error: null,
          }),
        }),
      }),
    };

    const payload = await buildUploadResponsePayload({
      supabase: fakeSupabase as never,
      isSupabaseConfigured: true,
      savedIds: ['pkg-review'],
      savedTitles: ['Shizuoka 3 days'],
      savedInternalCodes: ['PUS-ETC-FSZ-03-0001'],
      savedConfidences: [0.9],
      saveErrors: [],
      totalPriceRowsSaved: 1,
      savedPriceRowsByPackageId: new Map([['pkg-review', 1]]),
      productsToSaveLength: 1,
      parsedDocument: { confidence: 0.9 },
      fileHash: 'abcdef123456',
      classification: null,
      inputAnalysisForTrust: null,
      preSaveV3Status: 'ready_to_publish',
      matchedAttractionCount: 0,
      unmatchedAttractionCount: 0,
      attractionSeededCount: 0,
      attractionReflectedCount: 0,
      uploadSourceMetadata: null,
      filenameSupplierRaw: null,
      marginRate: 0.09,
      fileName: 'shizuoka.txt',
      baseUrl: 'https://www.yeosonam.com',
      improvementEvents: [],
      improvementEventsSaved: 0,
      improvementEventsSaveError: null,
    });

    expect(payload.success).toBe(true);
    expect(payload.gate).toBe('REVIEW_NEEDED');
    expect(payload.customerPublishable).toBe(false);
    expect(payload.customerBlockedCount).toBe(1);
  });
});
