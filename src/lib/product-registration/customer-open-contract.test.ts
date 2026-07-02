import { describe, expect, it } from 'vitest';

import {
  customerOpenContractBlogBlockReason,
  evaluateCustomerOpenContract,
  isCustomerOpenContractBlogPublishable,
  type CustomerOpenContractResult,
} from './customer-open-contract';

const basePkg = {
  id: 'pkg-1',
  title: 'Da Nang package',
  destination: 'Da Nang',
  raw_text: 'PKG Da Nang package\n'.repeat(10),
  internal_code: 'PUS-ETC-DAD-05-0001',
  airline: 'BX',
  updated_at: '2026-06-28T00:00:00.000Z',
  itinerary_data: {
    days: [
      { day: 1, schedule: [{ activity: 'Arrival' }] },
      { day: 2, schedule: [{ activity: 'Tour' }] },
    ],
  },
  price_dates: [{ date: '2026-07-01', price: 1000000 }],
};

const productPrices = [
  {
    target_date: '2026-07-01',
    net_price: 1000000,
    adult_selling_price: 1000000,
  },
];

const mobileProof = {
  ok: true,
  reason: 'actual /packages and /lp mobile browser proof passed',
  proof: {
    status: 'pass',
    checked_at: '2026-06-28T00:00:00.000Z',
    package_updated_at: '2026-06-28T00:00:00.000Z',
    surfaces: ['packages', 'lp'],
    surface_results: [
      { surface: 'packages', status: 'pass' },
      { surface: 'lp', status: 'pass' },
    ],
  },
};

describe('customer-open contract', () => {
  it('passes only when scorecard, proof, V3, entities, and prices are all customer-open ready', () => {
    const result = evaluateCustomerOpenContract({
      pkg: basePkg,
      verifyChecks: [{ id: 'C15', status: 'pass' }, { id: 'C18', status: 'pass' }],
      productPrices,
      mobileProof,
      v3Gate: { blocksApproval: false, payloadError: null, blockReasons: [], draftStatus: 'ready_to_publish' },
      sourceVerifyStatus: 'clean',
    });

    expect(result.ok).toBe(true);
    expect(result.nextAction).toBe('customer_open_candidate');
    expect(result.qualityScorecard.customerOpenCandidate).toBe(true);
    expect(result.evidencePack.status).toBe('pass');
    expect(result.evidencePack.downstream_eligibility.blog_publish).toBe(true);
    expect(result.evidencePack.source.raw_text_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('blocks downstream opening when LP proof is missing', () => {
    const result = evaluateCustomerOpenContract({
      pkg: basePkg,
      verifyChecks: [{ id: 'C15', status: 'pass' }, { id: 'C18', status: 'pass' }],
      productPrices,
      mobileProof: {
        ...mobileProof,
        proof: {
          ...mobileProof.proof,
          surfaces: ['packages'],
          surface_results: [{ surface: 'packages', status: 'pass' }],
        },
      },
      v3Gate: { blocksApproval: false, payloadError: null, blockReasons: [], draftStatus: 'ready_to_publish' },
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join('\n')).toContain('lp');
    expect(result.evidencePack.status).toBe('blocked');
    expect(result.evidencePack.mobile_proof.stale_or_missing_proof).toBe(true);
    expect(result.evidencePack.downstream_eligibility.marketing_stage).toBe(false);
  });

  it('blocks downstream opening when unresolved customer-visible entities remain', () => {
    const result = evaluateCustomerOpenContract({
      pkg: basePkg,
      verifyChecks: [{ id: 'C15', status: 'fail', detail: 'entity_attraction_unresolved=2' }],
      productPrices,
      mobileProof,
      v3Gate: { blocksApproval: false, payloadError: null, blockReasons: [], draftStatus: 'ready_to_publish' },
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join('\n')).toContain('entity_attraction_unresolved=2');
    expect(result.evidencePack.downstream_eligibility.blockers.join('\n')).toContain('entity_attraction_unresolved=2');
  });

  it('blocks downstream opening when Product Registration V3 blocks customer notices', () => {
    const result = evaluateCustomerOpenContract({
      pkg: basePkg,
      verifyChecks: [{ id: 'C15', status: 'pass' }, { id: 'C18', status: 'pass' }],
      productPrices,
      mobileProof,
      v3Gate: {
        blocksApproval: true,
        payloadError: null,
        blockReasons: ['customer notice requires review'],
        draftStatus: 'needs_review',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('v3:customer notice requires review');
  });

  it('does not allow blog publishing when downstream blog eligibility is false', () => {
    const result = evaluateCustomerOpenContract({
      pkg: basePkg,
      verifyChecks: [{ id: 'C15', status: 'pass' }, { id: 'C18', status: 'pass' }],
      productPrices,
      mobileProof,
      v3Gate: { blocksApproval: false, payloadError: null, blockReasons: [], draftStatus: 'ready_to_publish' },
      sourceVerifyStatus: 'clean',
    });
    const staleEvidence = {
      ...result,
      evidencePack: {
        ...result.evidencePack,
        downstream_eligibility: {
          ...result.evidencePack.downstream_eligibility,
          blog_publish: false,
          blockers: [],
        },
      },
    } satisfies CustomerOpenContractResult;

    expect(staleEvidence.ok).toBe(true);
    expect(isCustomerOpenContractBlogPublishable(staleEvidence)).toBe(false);
    expect(customerOpenContractBlogBlockReason(staleEvidence)).toBe('downstream_blog_publish_false');
  });
});
