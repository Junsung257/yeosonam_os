import { describe, expect, it } from 'vitest';
import {
  buildBlogProductEvidenceWorkReport,
  categorizeProductEvidenceBlocker,
  extractProductOpenContractBlockers,
} from './blog-product-evidence-work';

describe('blog product evidence work', () => {
  it('extracts blockers from product open-contract publisher errors', () => {
    const blockers = extractProductOpenContractBlockers({
      last_error: 'product_customer_open_contract_failed:mobile_proof:stale|quality_scorecard:price_missing',
    });

    expect(blockers).toEqual(['mobile_proof:stale', 'quality_scorecard:price_missing']);
  });

  it('categorizes the blocker into operator-friendly groups', () => {
    expect(categorizeProductEvidenceBlocker('mobile_proof:actual customer mobile browser proof hashes are missing')).toBe('mobile_proof');
    expect(categorizeProductEvidenceBlocker('quality_scorecard:price_missing')).toBe('quality_scorecard');
    expect(categorizeProductEvidenceBlocker('v3_payload:supplier remark leaked')).toBe('v3_customer_payload');
  });

  it('builds a report with product titles and next actions', () => {
    const productsById = new Map([
      ['pkg-1', { id: 'pkg-1', title: '몽골 초원 4일', status: 'active', destination: '몽골' }],
    ]);

    const report = buildBlogProductEvidenceWorkReport({
      productsById,
      rows: [
        {
          id: 'queue-1',
          status: 'failed',
          product_id: 'pkg-1',
          topic: '몽골 초원 4일 상담 전 체크',
          attempts: 1,
          updated_at: '2026-07-01T00:00:00Z',
          last_error: 'product_customer_open_contract_failed:mobile_proof:stale',
          meta: { failure_code: 'unknown' },
        },
        {
          id: 'queue-2',
          status: 'failed',
          product_id: 'pkg-2',
          last_error: 'temporary timeout',
          meta: {},
        },
      ],
    });

    expect(report.total).toBe(1);
    expect(report.category_counts).toEqual({ mobile_proof: 1 });
    expect(report.samples[0]).toMatchObject({
      queue_id: 'queue-1',
      product_id: 'pkg-1',
      product_title: '몽골 초원 4일',
      blocker_categories: ['mobile_proof'],
      next_action: '모바일 공개 화면 증빙을 새로 생성하고 customer_open_contract 재평가',
    });
  });
});
