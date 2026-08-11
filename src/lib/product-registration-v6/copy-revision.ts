import type { SupabaseClient } from '@supabase/supabase-js';

import { sha256Hex } from '@/lib/product-registration-v4/document-ir';
import { stableJson } from '@/lib/product-registration-v4/revision';

type JsonObject = Record<string, unknown>;

const HIGH_RISK_EXPRESSIONS = ['확정', '보장', '최저가', '노옵션', '노쇼핑', '출발확정'] as const;

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(cleanText).filter((item): item is string => Boolean(item)))].slice(0, 12)
    : [];
}

function claimSupportsExpression(claims: Array<{ normalized_value: unknown; evidence_status: string; conflict_status: string }>, expression: string): boolean {
  return claims.some(claim => claim.evidence_status === 'verified'
    && claim.conflict_status === 'none'
    && stableJson(claim.normalized_value).includes(expression));
}

export function buildProductRegistrationV6Copy(input: {
  pkg: JsonObject;
  claims: Array<{ id: string; field_path: string; normalized_value: unknown; criticality: string; evidence_status: string; conflict_status: string }>;
  degradedReasons: string[];
}): { payload: JsonObject; blockers: string[]; claimLinks: Array<{ claim_id: string; copy_path: string }> } {
  const title = cleanText(input.pkg.title) ?? '여행 상품';
  const summary = cleanText(input.pkg.product_summary);
  const highlights = cleanList(input.pkg.product_highlights);
  const candidateText = [title, summary, ...highlights].filter(Boolean).join(' ');
  const blockers = HIGH_RISK_EXPRESSIONS
    .filter(expression => candidateText.includes(expression) && !claimSupportsExpression(input.claims, expression))
    .map(expression => `UNSUPPORTED_CUSTOMER_EXPRESSION:${expression}`);
  if (/5\s*성급/i.test(candidateText) && !claimSupportsExpression(input.claims, '5성')) {
    blockers.push('UNSUPPORTED_CUSTOMER_EXPRESSION:5성급');
  }
  const importantClaims = input.claims.filter(claim => ['critical', 'high'].includes(claim.criticality)
    && claim.evidence_status === 'verified'
    && claim.conflict_status === 'none');
  const payload: JsonObject = {
    title,
    summary,
    highlights,
    disclosure: input.degradedReasons.length > 0
      ? '일부 운항·숙박 정보는 상담 시점 기준으로 최종 확인해 드립니다.'
      : null,
    display_order: [
      'price_and_departure', 'highlights', 'itinerary', 'transport_and_lodging',
      'inclusions_and_exclusions', 'options_and_shopping', 'cancellation', 'consultation',
    ],
    policy: 'facts-template-only-v6',
  };
  return {
    payload,
    blockers: [...new Set(blockers)],
    claimLinks: importantClaims.map(claim => ({ claim_id: claim.id, copy_path: 'facts' })),
  };
}

export async function persistProductRegistrationV6Copy(input: {
  supabase: SupabaseClient;
  tenantId: string | null;
  revisionId: string;
  revisionHash: string;
  sourceHash: string;
  payload: JsonObject;
  claimLinks: Array<{ claim_id: string; copy_path: string }>;
  validationState: 'verified' | 'blocked';
}) {
  const copyHash = sha256Hex(stableJson(input.payload));
  const { data, error } = await input.supabase.rpc('persist_product_registration_v6_copy_revision', {
    p_payload: {
      tenant_id: input.tenantId,
      product_revision_id: input.revisionId,
      locale: 'ko-KR',
      copy_payload: input.payload,
      copy_hash: copyHash,
      source_hash: input.sourceHash,
      revision_hash: input.revisionHash,
      validation_state: input.validationState,
      claim_links: input.claimLinks,
    },
  });
  if (error) throw error;
  return { copyHash, data };
}
