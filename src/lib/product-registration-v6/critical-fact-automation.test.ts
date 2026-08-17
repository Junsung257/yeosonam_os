import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { CanonicalSection } from '@/lib/product-registration-v4/canonical-worker';

import { runCriticalPriceFactAutomation } from './critical-fact-automation';

function section(rawText: string): CanonicalSection {
  return {
    index: 0,
    sectionKey: 'section-0',
    titleHint: null,
    rawText,
    rawTextHash: 'a'.repeat(64),
    sourceNodeIds: [],
    evidence: [],
  };
}

function candidateFromPrompt(userPrompt: string, amount: number) {
  const contract = JSON.parse(userPrompt) as {
    anchors: Array<{ id: string; quoteHash: string }>;
  };
  return {
    status: 'resolved' as const,
    candidates: [{
      amount,
      currency: 'KRW' as const,
      date: '2026-09-27',
      dateRange: null,
      weekday: null,
      minTravelers: null,
      maxTravelers: null,
      variantLabel: null,
      evidenceAnchorIds: contract.anchors.map(anchor => anchor.id),
      evidenceQuoteHashes: contract.anchors.map(anchor => anchor.quoteHash).sort(),
    }],
  };
}

describe('critical price fact automation', () => {
  it('persists and applies only a durable two-provider source-replay agreement', async () => {
    const rpc = vi.fn(async (name: string, args: { p_payload?: Record<string, unknown> }) => {
      expect(name).toBe('record_product_registration_critical_fact_consensus');
      expect(args.p_payload?.decision_state).toBe('agreed');
      return { data: { id: '00000000-0000-4000-8000-000000000003' }, error: null };
    });
    const result = await runCriticalPriceFactAutomation({
      supabase: { rpc } as unknown as SupabaseClient,
      tenantId: '00000000-0000-4000-8000-000000000001',
      jobId: '00000000-0000-4000-8000-000000000002',
      sourceHash: 'b'.repeat(64),
      sections: [section('상품가 1,039,000원\n출발 9월 27일')],
      referenceDate: '2026-08-17',
      rollingInferenceEligible: true,
      explicitYear: 2026,
      datePolicyVersion: 'source-departure-date-policy-4',
      caller: async ({ leg, provider, model, userPrompt }) => ({
        success: true,
        provider,
        model,
        providerCallId: leg === 'a'
          ? '00000000-0000-4000-8000-000000000011'
          : '00000000-0000-4000-8000-000000000012',
        data: candidateFromPrompt(userPrompt, 1_039_000),
      }),
    });
    expect(result).toEqual(expect.objectContaining({ agreedCount: 1, candidateSectionCount: 1 }));
    expect(result.overrides).toHaveLength(1);
    expect(result.overrides[0]).toEqual(expect.objectContaining({ sectionIndex: 0 }));
  });

  it('records disagreement but never creates an automatic override', async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const rpc = vi.fn(async (_name: string, args: { p_payload?: Record<string, unknown> }) => {
      payloads.push(args.p_payload ?? {});
      return { data: { id: '00000000-0000-4000-8000-000000000003' }, error: null };
    });
    const result = await runCriticalPriceFactAutomation({
      supabase: { rpc } as unknown as SupabaseClient,
      tenantId: '00000000-0000-4000-8000-000000000001',
      jobId: '00000000-0000-4000-8000-000000000002',
      sourceHash: 'b'.repeat(64),
      sections: [section('상품가 1,039,000원 / 정상가 1,199,000원\n출발 9월 27일')],
      referenceDate: '2026-08-17',
      rollingInferenceEligible: true,
      explicitYear: 2026,
      datePolicyVersion: 'source-departure-date-policy-4',
      caller: async ({ leg, provider, model, userPrompt }) => ({
        success: true,
        provider,
        model,
        providerCallId: leg === 'a'
          ? '00000000-0000-4000-8000-000000000011'
          : '00000000-0000-4000-8000-000000000012',
        data: candidateFromPrompt(userPrompt, leg === 'a' ? 1_039_000 : 1_199_000),
      }),
    });
    expect(result.overrides).toHaveLength(0);
    expect(result.humanRequiredCount).toBe(1);
    expect(payloads[0]?.decision_state).toBe('human_required');
  });

  it('does not spend AI calls when the deterministic price graph is already unique', async () => {
    const caller = vi.fn();
    const result = await runCriticalPriceFactAutomation({
      supabase: { rpc: vi.fn() } as unknown as SupabaseClient,
      tenantId: '00000000-0000-4000-8000-000000000001',
      jobId: '00000000-0000-4000-8000-000000000002',
      sourceHash: 'b'.repeat(64),
      sections: [section('출발일 2026-09-27\n1인 1,199,000원→1,039,000원')],
      referenceDate: '2026-08-17',
      rollingInferenceEligible: true,
      explicitYear: 2026,
      datePolicyVersion: 'source-departure-date-policy-4',
      caller,
    });
    expect(caller).not.toHaveBeenCalled();
    expect(result.skippedDeterministicCount).toBe(1);
    expect(result.candidateSectionCount).toBe(0);
  });
});
