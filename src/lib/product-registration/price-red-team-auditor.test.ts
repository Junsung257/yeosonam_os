import { describe, expect, it } from 'vitest';
import { readSupplierDocumentLikeHuman } from './ai-human-reader';
import { auditPriceExtractionAgainstSource } from './price-red-team-auditor';
import type { UploadPriceRecoveryResult } from './price-recovery';

const RAW_PRICE_TABLE = `
상품가
7/1, 6
1,299,000원
포함 내역
항공권
`;

function recovery(price: number): UploadPriceRecoveryResult {
  return {
    ok: true,
    source: 'deterministic:product_price_vertical_date_table',
    tiers: [],
    priceRows: [{
      target_date: '2026-07-01',
      day_of_week: null,
      net_price: price,
      adult_selling_price: price,
      child_price: null,
      note: null,
    }],
    priceDates: [{ date: '2026-07-01', price, confirmed: false }],
    minPrice: price,
    failures: [],
  };
}

function modelRecovery(): UploadPriceRecoveryResult {
  return {
    ...recovery(1299000),
    source: 'llm_hydrated',
  };
}

describe('auditPriceExtractionAgainstSource', () => {
  it('passes when recovered price agrees with source-backed reader evidence', () => {
    const reader = readSupplierDocumentLikeHuman({
      rawText: RAW_PRICE_TABLE,
      durationDays: 3,
      year: 2026,
    });

    const audit = auditPriceExtractionAgainstSource({
      humanReader: reader,
      priceRecovery: recovery(1299000),
    });

    expect(audit.status).toBe('pass');
    expect(audit.blockers).toHaveLength(0);
  });

  it('fails when the same source-backed date has a different recovered price', () => {
    const reader = readSupplierDocumentLikeHuman({
      rawText: RAW_PRICE_TABLE,
      durationDays: 3,
      year: 2026,
    });

    const audit = auditPriceExtractionAgainstSource({
      humanReader: reader,
      priceRecovery: recovery(1399000),
    });

    expect(audit.status).toBe('fail');
    expect(audit.blockers.join('\n')).toContain('price amount disagreement 2026-07-01');
  });

  it('blocks model-derived prices when no independent source-backed price evidence exists', () => {
    const reader = readSupplierDocumentLikeHuman({
      rawText: '포함 내역\n항공권\n호텔\n',
      durationDays: 3,
      year: 2026,
    });

    const audit = auditPriceExtractionAgainstSource({
      humanReader: reader,
      priceRecovery: modelRecovery(),
    });

    expect(audit.status).toBe('fail');
    expect(audit.blockers.join('\n')).toContain('model-derived price source llm_hydrated');
  });
});
