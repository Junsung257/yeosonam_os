import { describe, expect, it } from 'vitest';

import {
  buildCriticalFactEvidenceAnchors,
  resolveCriticalPriceFactsWithDualAi,
  verifyCriticalPriceCandidates,
  type CriticalFactProviderAnswer,
} from './critical-fact-consensus';

const text = '출발일 2026-09-27\n1인 1,199,000원→1,039,000원';

describe('critical fact DeepSeek dual-pass consensus', () => {
  it('accepts only identical independent answers that replay from source anchors', async () => {
    const anchors = buildCriticalFactEvidenceAnchors(text, 0);
    const answer: CriticalFactProviderAnswer = {
      status: 'resolved',
      candidates: [{
        amount: 1_039_000,
        currency: 'KRW',
        date: '2026-09-27',
        dateRange: null,
        weekday: null,
        minTravelers: null,
        maxTravelers: null,
        variantLabel: null,
        evidenceAnchorIds: anchors.map(anchor => anchor.id),
        evidenceQuoteHashes: anchors.map(anchor => anchor.quoteHash).sort(),
      }],
    };
    const result = await resolveCriticalPriceFactsWithDualAi({
      tenantId: 'tenant-1', sectionIndex: 0, sectionText: text, anchors,
      caller: async ({ provider, model }) => ({ success: true, provider, model, data: answer }),
    });
    expect(result.state).toBe('agreed');
    expect(result.verifier.valid).toBe(true);
  });

  it('requires a human when independent DeepSeek passes disagree', async () => {
    const anchors = buildCriticalFactEvidenceAnchors(text, 0);
    const result = await resolveCriticalPriceFactsWithDualAi({
      tenantId: null, sectionIndex: 0, sectionText: text, anchors,
      caller: async ({ leg, provider, model }) => ({
        success: true,
        provider,
        model,
        data: {
          status: 'resolved',
          candidates: [{
            amount: leg === 'a' ? 1_039_000 : 1_199_000,
            currency: 'KRW', date: '2026-09-27', dateRange: null, weekday: null,
            minTravelers: null, maxTravelers: null, variantLabel: null,
            evidenceAnchorIds: anchors.map(anchor => anchor.id),
            evidenceQuoteHashes: anchors.map(anchor => anchor.quoteHash).sort(),
          }],
        },
      }),
    });
    expect(result.state).toBe('human_required');
  });

  it('canonicalizes harmless label and evidence-neighborhood differences before consensus', async () => {
    const source = '상품가\n9/13, 14, 15, 16, 17\n499,000원\n*8월 발권 조건';
    const anchors = buildCriticalFactEvidenceAnchors(source, 0);
    const result = await resolveCriticalPriceFactsWithDualAi({
      tenantId: null, sectionIndex: 0, sectionText: source, anchors,
      trustedDateContext: {
        referenceDate: '2026-08-17', rollingInferenceEligible: true,
        explicitYear: null, policyVersion: 'test',
      },
      caller: async ({ leg, provider, model }) => ({
        success: true,
        provider,
        model,
        data: {
          status: 'resolved',
          candidates: [{
            amount: 499_000,
            currency: 'KRW',
            date: null,
            dateRange: { start: '2026-09-13', end: '2026-09-17' },
            weekday: null,
            minTravelers: null,
            maxTravelers: null,
            variantLabel: leg === 'a' ? '*8월 발권 조건' : '8월 발권 조건',
            evidenceAnchorIds: leg === 'a' ? anchors.map(anchor => anchor.id) : anchors.slice(0, 2).map(anchor => anchor.id),
            evidenceQuoteHashes: (leg === 'a' ? anchors : anchors.slice(0, 2)).map(anchor => anchor.quoteHash).sort(),
          }],
        },
      }),
    });
    expect(result.state).toBe('agreed');
    expect(result.candidates[0]?.variantLabel).toBe('8월 발권 조건');
    expect(result.verifier.valid).toBe(true);
  });

  it('does not accept a non-DeepSeek fallback masquerading as one independent leg', async () => {
    const result = await resolveCriticalPriceFactsWithDualAi({
      tenantId: null, sectionIndex: 0, sectionText: text,
      caller: async ({ model }) => ({ success: true, provider: 'claude', model, data: { status: 'unresolved', candidates: [] } }),
    });
    expect(result.state).toBe('provider_unavailable');
    expect(result.providerA.errors).toContain('PINNED_PROVIDER_MISMATCH');
  });

  it('rejects a value that cannot be replayed from the cited evidence', () => {
    const anchors = buildCriticalFactEvidenceAnchors(text, 0);
    expect(verifyCriticalPriceCandidates({
      sectionIndex: 0,
      anchors,
      candidates: [{
        amount: 999_000, currency: 'KRW', date: '2026-09-27', dateRange: null, weekday: null,
        minTravelers: null, maxTravelers: null, variantLabel: null,
        evidenceAnchorIds: anchors.map(anchor => anchor.id),
        evidenceQuoteHashes: anchors.map(anchor => anchor.quoteHash).sort(),
      }],
    })).toEqual(expect.objectContaining({ valid: false, errors: expect.arrayContaining(['candidate:0:AMOUNT_NOT_REPLAYABLE']) }));
  });

  it('rejects two final prices for the same exact sale scope', () => {
    const anchors = buildCriticalFactEvidenceAnchors(text, 0);
    const evidenceAnchorIds = anchors.map(anchor => anchor.id);
    const evidenceQuoteHashes = anchors.map(anchor => anchor.quoteHash).sort();
    expect(verifyCriticalPriceCandidates({
      sectionIndex: 0,
      anchors,
      candidates: [1_039_000, 1_199_000].map(amount => ({
        amount, currency: 'KRW' as const, date: '2026-09-27', dateRange: null, weekday: null,
        minTravelers: null, maxTravelers: null, variantLabel: null,
        evidenceAnchorIds, evidenceQuoteHashes,
      })),
    })).toEqual(expect.objectContaining({
      valid: false,
      errors: expect.arrayContaining(['candidate:1:SAME_SCOPE_PRICE_CONFLICT']),
    }));
  });
});
