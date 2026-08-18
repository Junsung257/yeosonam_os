import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { llmCall, type GatewayResult } from '@/lib/llm-gateway';
import { extractPriceIR } from '@/lib/parser/deterministic/price-ir';
import type { CanonicalSection, CriticalPriceFactOverride } from '@/lib/product-registration-v4/canonical-worker';

import {
  buildCriticalFactEvidenceAnchors,
  CRITICAL_FACT_CONSENSUS_POLICY_VERSION,
  resolveCriticalPriceFactsWithDualAi,
  type CriticalFactProviderAnswer,
  type CriticalFactProviderCaller,
} from './critical-fact-consensus';
import { resolveSourceSalePriceDisposition } from './source-sale-price-disposition';

type JsonObject = Record<string, unknown>;

type ProviderReservation = {
  action?: 'execute' | 'reuse' | 'wait' | 'exhausted';
  call_id?: string;
  result?: { gateway_result?: unknown };
};

export type CriticalFactAutomationResult = {
  overrides: CriticalPriceFactOverride[];
  candidateSectionCount: number;
  skippedDeterministicCount: number;
  skippedHumanOverrideCount: number;
  agreedCount: number;
  humanRequiredCount: number;
  providerUnavailableCount: number;
  invalidCount: number;
  overflowCount: number;
};

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as JsonObject;
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${stableValue(row[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableValue(value)).digest('hex');
}

function asGatewayResult(value: unknown): GatewayResult<CriticalFactProviderAnswer> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as JsonObject;
  if (typeof row.success !== 'boolean') return null;
  return row as unknown as GatewayResult<CriticalFactProviderAnswer>;
}

function jsonSafeGatewayResult(
  result: GatewayResult<CriticalFactProviderAnswer>,
): GatewayResult<CriticalFactProviderAnswer> {
  return JSON.parse(JSON.stringify(result)) as GatewayResult<CriticalFactProviderAnswer>;
}

/**
 * Makes each paid model call effectively-once. A workflow retry reuses the
 * append-only provider result instead of charging twice or producing a third
 * interpretation for the same source contract.
 */
export function createLedgeredCriticalFactProviderCaller(input: {
  supabase: SupabaseClient;
  tenantId: string;
  jobId: string;
  sourceHash: string;
}): CriticalFactProviderCaller {
  return async request => {
    const requestContract = {
      version: 'critical-price-provider-request-1',
      policyVersion: CRITICAL_FACT_CONSENSUS_POLICY_VERSION,
      provider: request.provider,
      leg: request.leg,
      model: request.model,
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
    };
    const requestHash = hash(requestContract);
    const operationKey = `critical-price:v2:${request.provider}:${request.leg}:${requestHash}`;
    const reservationPayload = {
      tenant_id: input.tenantId,
      job_id: input.jobId,
      product_revision_id: null,
      provider: request.provider,
      operation: 'critical_price_consensus',
      operation_key: operationKey,
      request_hash: requestHash,
      source_hash: input.sourceHash,
      revision_hash: null,
      created_version: CRITICAL_FACT_CONSENSUS_POLICY_VERSION,
    };
    let reservation: ProviderReservation | null = null;
    // Multiple sections from the same source can reach the provider step at
    // once during bounded backfill fan-out.  The database reservation is the
    // single-flight authority; wait briefly for that call to complete and
    // then reuse its durable result instead of turning a harmless race into a
    // customer-visible workflow failure.
    // Provider calls can legitimately take longer than one workflow step when
    // a backfill cohort is cold-starting. Wait long enough to reuse the
    // durable result, but never turn a still-running single-flight call into a
    // dead-lettered workflow. If it is still in flight after the bounded wait,
    // record the provider as unavailable; the deterministic resolver remains
    // authoritative and validation will either publish a safe result or block
    // the unresolved critical field.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const { data, error } = await input.supabase.rpc('reserve_product_registration_v6_provider_call', {
        p_payload: reservationPayload,
      });
      if (error) throw error;
      reservation = (data ?? {}) as ProviderReservation;
      if (reservation.action !== 'wait') break;
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    if (!reservation) throw new Error('CRITICAL_FACT_PROVIDER_RESERVATION_RESPONSE_INVALID');
    if (reservation.action === 'wait') {
      return {
        success: false,
        provider: request.provider,
        model: request.model,
        errors: ['CRITICAL_FACT_PROVIDER_CALL_IN_FLIGHT_TIMEOUT'],
        providerCallId: null,
      };
    }
    if (reservation.action === 'reuse' && reservation.call_id) {
      const stored = asGatewayResult(reservation.result?.gateway_result);
      if (!stored || stored.provider !== request.provider) {
        throw new Error('CRITICAL_FACT_PROVIDER_REUSABLE_RESULT_INVALID');
      }
      return { ...stored, providerCallId: reservation.call_id };
    }
    if (reservation.action === 'exhausted') {
      return {
        success: false,
        provider: request.provider,
        model: request.model,
        errors: ['CRITICAL_FACT_PROVIDER_RETRY_EXHAUSTED'],
        providerCallId: reservation.call_id ?? null,
      };
    }
    if (reservation.action !== 'execute' || !reservation.call_id) {
      throw new Error('CRITICAL_FACT_PROVIDER_RESERVATION_RESPONSE_INVALID');
    }

    const result = await llmCall<CriticalFactProviderAnswer>({
      task: 'normalize-complex',
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      tenantId: request.tenantId,
      jsonSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['resolved', 'unresolved'] },
          candidates: { type: 'array', items: { type: 'object' } },
        },
        required: ['status', 'candidates'],
      },
      temperature: 0,
      maxTokens: 2_500,
      maxRetries: 1,
      autoEscalate: false,
      pinnedProvider: request.provider,
      pinnedModel: request.model,
    });
    const storedResult = { gateway_result: jsonSafeGatewayResult(result) };
    const { error: completionError } = await input.supabase.rpc(
      'complete_product_registration_v6_provider_call',
      {
        p_payload: {
          call_id: reservation.call_id,
          request_hash: requestHash,
          response_hash: hash(storedResult),
          status: result.success ? 'succeeded' : 'failed',
          billed_units: (result._usage?.input ?? 0) + (result._usage?.output ?? 0),
          cost_krw: 0,
          result: storedResult,
        },
      },
    );
    if (completionError) throw completionError;
    return { ...result, providerCallId: reservation.call_id };
  };
}

function integerEnvironment(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function decisionId(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const id = (data as JsonObject).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Runs only for price sections the deterministic graph could not resolve.
 * AI supplies relationship candidates; the original quotes remain the sole
 * authority and are replayed again by the canonical compiler.
 */
export async function runCriticalPriceFactAutomation(input: {
  supabase: SupabaseClient;
  tenantId: string;
  jobId: string;
  sourceHash: string;
  sections: CanonicalSection[];
  existingOverrides?: CriticalPriceFactOverride[];
  referenceDate: string;
  rollingInferenceEligible: boolean;
  explicitYear?: number | null;
  datePolicyVersion: string;
  caller?: CriticalFactProviderCaller;
  maxSections?: number;
}): Promise<CriticalFactAutomationResult> {
  const existingOverrides = input.existingOverrides ?? [];
  const humanSections = new Set(existingOverrides.map(override => override.sectionIndex));
  let skippedDeterministicCount = 0;
  let skippedHumanOverrideCount = 0;
  const unresolved: CanonicalSection[] = [];
  for (const section of input.sections) {
    if (humanSections.has(section.index)) {
      skippedHumanOverrideCount += 1;
      continue;
    }
    const deterministic = extractPriceIR(section.rawText, { year: input.explicitYear ?? undefined });
    const disposition = resolveSourceSalePriceDisposition({
      sourceText: section.rawText,
      canonicalSection: {},
    });
    if (deterministic.rows.length > 0 && deterministic.resolution?.status !== 'ambiguous') {
      skippedDeterministicCount += 1;
      continue;
    }
    if (disposition.state === 'source_price_requires_resolution') unresolved.push(section);
  }

  const maxSections = input.maxSections
    ?? integerEnvironment('PRODUCT_REGISTRATION_CRITICAL_FACT_MAX_SECTIONS', 12, 1, 50);
  const selected = unresolved.slice(0, maxSections);
  const caller = input.caller ?? createLedgeredCriticalFactProviderCaller(input);
  const result: CriticalFactAutomationResult = {
    overrides: [...existingOverrides],
    candidateSectionCount: unresolved.length,
    skippedDeterministicCount,
    skippedHumanOverrideCount,
    agreedCount: 0,
    humanRequiredCount: 0,
    providerUnavailableCount: 0,
    invalidCount: 0,
    overflowCount: Math.max(0, unresolved.length - selected.length),
  };

  // Deliberately sequential: each section already makes two provider calls in
  // parallel, while sequential sections cap supplier/API bursts and cost.
  for (const section of selected) {
    const consensus = await resolveCriticalPriceFactsWithDualAi({
      tenantId: input.tenantId,
      sectionIndex: section.index,
      sectionText: section.rawText,
      trustedDateContext: {
        referenceDate: input.referenceDate,
        rollingInferenceEligible: input.rollingInferenceEligible,
        explicitYear: input.explicitYear ?? null,
        policyVersion: input.datePolicyVersion,
      },
      caller,
    });
    const sourceAnchorById = new Map(
      buildCriticalFactEvidenceAnchors(section.rawText, section.index)
        .map(anchor => [anchor.id, anchor.quoteHash]),
    );
    const evidenceById = new Map<string, string>();
    for (const candidate of consensus.candidates) {
      candidate.evidenceAnchorIds.forEach(id => {
        const quoteHash = sourceAnchorById.get(id);
        if (quoteHash) evidenceById.set(id, quoteHash);
      });
    }
    const agreedWithDurableCalls = consensus.state === 'agreed'
      && Boolean(consensus.providerA.providerCallId && consensus.providerB.providerCallId);
    const persistedState = consensus.state === 'agreed' && !agreedWithDurableCalls
      ? 'invalid'
      : consensus.state;
    const verifier = consensus.state === 'agreed' && !agreedWithDurableCalls
      ? { valid: false, errors: ['DURABLE_PROVIDER_LINEAGE_REQUIRED'] }
      : consensus.verifier;
    const { data, error } = await input.supabase.rpc('record_product_registration_critical_fact_consensus', {
      p_payload: {
        tenant_id: input.tenantId,
        job_id: input.jobId,
        product_revision_id: null,
        section_index: section.index,
        field_path: 'price_calendar',
        source_hash: input.sourceHash,
        input_hash: consensus.inputHash,
        provider_call_a_id: consensus.providerA.providerCallId,
        provider_call_b_id: consensus.providerB.providerCallId,
        // The DB keeps these as the two independent consensus legs. The
        // provider-call ledger still records the actual provider as deepseek.
        provider_a: `${consensus.providerA.provider}:pass-${consensus.providerA.leg}`,
        provider_b: `${consensus.providerB.provider}:pass-${consensus.providerB.leg}`,
        candidate_hash: agreedWithDurableCalls ? consensus.candidateHash : null,
        candidate: { candidates: agreedWithDurableCalls ? consensus.candidates : [] },
        evidence_anchor_ids: [...evidenceById.keys()].sort(),
        evidence_quote_hashes: [...evidenceById.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value),
        decision_state: persistedState,
        verifier_result: verifier,
        policy_version: CRITICAL_FACT_CONSENSUS_POLICY_VERSION,
      },
    });
    if (error) throw error;
    const persistedDecisionId = decisionId(data);
    if (agreedWithDurableCalls && consensus.candidateHash && persistedDecisionId) {
      result.agreedCount += 1;
      result.overrides.push({
        sectionIndex: section.index,
        decisionId: persistedDecisionId,
        candidateHash: consensus.candidateHash,
        policyVersion: CRITICAL_FACT_CONSENSUS_POLICY_VERSION,
        candidates: consensus.candidates,
      });
    } else if (persistedState === 'provider_unavailable') {
      result.providerUnavailableCount += 1;
    } else if (persistedState === 'invalid') {
      result.invalidCount += 1;
    } else {
      result.humanRequiredCount += 1;
    }
  }
  return result;
}
