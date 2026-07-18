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
    expect(categorizeProductEvidenceBlocker('product_status_not_customer_visible:pending_review')).toBe('product_status');
    expect(categorizeProductEvidenceBlocker('v3_payload:supplier remark leaked')).toBe('v3_customer_payload');
    expect(categorizeProductEvidenceBlocker('archived_product')).toBe('archived_product');
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

  it('classifies archived product rows as skip work instead of evidence repair work', () => {
    const report = buildBlogProductEvidenceWorkReport({
      productsById: new Map([
        ['pkg-archived', { id: 'pkg-archived', title: 'Archived package', status: 'archived' }],
      ]),
      rows: [
        {
          id: 'queue-archived',
          status: 'failed',
          product_id: 'pkg-archived',
          topic: 'Archived product blog',
          attempts: 2,
          updated_at: '2026-07-01T00:00:00Z',
          last_error: 'product_customer_open_contract_failed:mobile_proof:stale',
          meta: { failure_code: 'product_open_contract' },
        },
      ],
    });

    expect(report.category_counts).toEqual({ archived_product: 1 });
    expect(report.next_actions).toEqual(['skip_archived_product_candidate']);
    expect(report.samples[0]).toMatchObject({
      product_status: 'archived',
      blocker_categories: ['archived_product'],
      next_action: 'skip_archived_product_candidate',
    });
  });

  it('separates pending product review from generic evidence work', () => {
    const report = buildBlogProductEvidenceWorkReport({
      productsById: new Map([
        ['pkg-review', { id: 'pkg-review', title: '나트랑 3박5일 패키지', status: 'pending_review' }],
      ]),
      rows: [
        {
          id: 'queue-review',
          status: 'failed',
          product_id: 'pkg-review',
          topic: '나트랑 3박5일 패키지 가성비 리뷰',
          attempts: 0,
          updated_at: '2026-07-09T00:00:00Z',
          meta: {
            failure_code: 'product_open_contract',
            product_open_contract_blockers: ['product_status_not_customer_visible:pending_review'],
          },
        },
      ],
    });

    expect(report.category_counts).toEqual({ product_status: 1 });
    expect(report.next_actions).toEqual(['상품을 고객 공개 상태로 검수/승인한 뒤 재큐잉']);
    expect(report.samples[0]).toMatchObject({
      product_status: 'pending_review',
      blocker_categories: ['product_status'],
      blockers: ['product_status_not_customer_visible:pending_review'],
    });
  });
});
