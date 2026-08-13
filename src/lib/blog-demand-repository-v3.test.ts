import { describe, expect, it } from 'vitest';
import {
  mergePersistedBlogDemandSignalsV3,
  readEmbeddedBlogQueueDemandSignalV3,
} from './blog-demand-repository-v3';

describe('blog demand repository v3', () => {
  it('merges observed search and customer evidence without inventing values', () => {
    const result = mergePersistedBlogDemandSignalsV3({}, [
      {
        provider: 'google_search_console',
        signal_value: 120,
        source_reference: 'gsc:2026-08-11:osaka-hotel',
        verified_at: null,
        expires_at: '2026-09-11T00:00:00.000Z',
      },
      {
        provider: 'customer_question',
        signal_value: 4,
        source_reference: 'question-cluster:42',
        verified_at: null,
        expires_at: null,
      },
    ], new Date('2026-08-12T00:00:00.000Z'));

    expect(result.signal).toMatchObject({ gsc: true, customerQuestionCount: 4 });
    expect(result.acceptedProviders).toEqual(['customer_question', 'google_search_console']);
  });

  it('rejects expired evidence and unreviewed human assertions', () => {
    const result = mergePersistedBlogDemandSignalsV3({}, [
      {
        provider: 'operator_note',
        signal_value: 1,
        source_reference: 'operator:note-1',
        verified_at: null,
        expires_at: null,
      },
      {
        provider: 'search_trend',
        signal_value: 90,
        source_reference: 'trend:expired',
        verified_at: null,
        expires_at: '2026-08-01T00:00:00.000Z',
      },
    ], new Date('2026-08-12T00:00:00.000Z'));

    expect(result.signal).toEqual({});
    expect(result.acceptedProviders).toEqual([]);
    expect(result.rejectedCount).toBe(2);
  });

  it('accepts an editor seed only with review evidence', () => {
    const result = mergePersistedBlogDemandSignalsV3({}, [{
      provider: 'editor_seed',
      signal_value: null,
      source_reference: 'editor-seed:42',
      verified_at: '2026-08-11T00:00:00.000Z',
      expires_at: null,
    }]);

    expect(result.signal.editorApprovedSeed).toBe(true);
    expect(result.acceptedProviders).toEqual(['editor_seed']);
  });

  it('does not treat a bare product id or null volume fields as verified demand', () => {
    expect(readEmbeddedBlogQueueDemandSignalV3({
      product_id: 'product-with-unknown-state',
      monthly_search_volume: null,
      trend_score: null,
      meta: {},
    })).toMatchObject({
      activeProductRelation: false,
      monthlySearchVolume: null,
      trendScore: null,
    });
  });

  it('accepts only an explicitly verified active product relation from queue metadata', () => {
    expect(readEmbeddedBlogQueueDemandSignalV3({
      product_id: 'active-product',
      meta: { active_product_relation_verified: true },
    }).activeProductRelation).toBe(true);
  });
});
