import { createHash } from 'node:crypto';

import { type NextRequest } from 'next/server';

import { apiResponse } from '@/lib/api-response';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { embedBatch } from '@/lib/embeddings';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const BATCH_SIZE = 20;
const MAX_ITERATIONS = 10;
const EMBEDDING_MODEL_VERSION = 'google-retrieval-document-1536-v1';

type Candidate = {
  tenant_id: string;
  catalog_product_id: string;
  channel: string;
  locale: string;
  snapshot_id: string;
  snapshot_hash: string;
  snapshot_json: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap(item => typeof item === 'string' ? [item] : []).slice(0, 20)
    : [];
}

function buildEmbeddingText(snapshot: Record<string, unknown>): string {
  const lines: string[] = [];
  const append = (label: string, value: unknown) => {
    if (typeof value === 'string' && value.trim()) lines.push(`${label}: ${value.trim()}`);
    if (typeof value === 'number' && Number.isFinite(value)) lines.push(`${label}: ${value}`);
  };
  append('상품명', snapshot.display_title ?? snapshot.title);
  append('목적지', snapshot.destination);
  append('국가', snapshot.country);
  append('기간', snapshot.duration);
  append('요약', snapshot.product_summary ?? snapshot.summary);
  for (const [label, value] of [
    ['특징', snapshot.product_highlights ?? snapshot.highlights],
    ['태그', snapshot.product_tags],
    ['포함', snapshot.inclusions],
    ['불포함', snapshot.excludes ?? snapshot.exclusions],
    ['숙소', snapshot.accommodations],
  ] as const) {
    const values = list(value);
    if (values.length > 0) lines.push(`${label}: ${values.join(', ')}`);
  }
  const itinerary = Array.isArray(snapshot.itinerary_data)
    ? snapshot.itinerary_data
    : Array.isArray(snapshot.itinerary) ? snapshot.itinerary : [];
  const itineraryText = itinerary.slice(0, 10).map(item => {
    if (typeof item === 'string') return item;
    const row = record(item);
    return [row.day, row.title, row.description, row.schedule].filter(Boolean).join(' ');
  }).filter(Boolean);
  if (itineraryText.length > 0) lines.push(`일정: ${itineraryText.join(' | ')}`);
  return lines.join('\n').slice(0, 12_000);
}

function contentHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return apiResponse({ error: 'Supabase not configured' }, { status: 503 });
  }
  const apiKey = getSecret('GOOGLE_AI_API_KEY');
  if (!apiKey) return apiResponse({ error: 'Google AI API key not configured' }, { status: 503 });

  let embedded = 0;
  let failed = 0;
  let iterations = 0;
  const errors: string[] = [];
  while (iterations < MAX_ITERATIONS) {
    const { data, error } = await supabaseAdmin.rpc(
      'claim_product_registration_search_embedding_candidates',
      { p_limit: BATCH_SIZE, p_model_version: EMBEDDING_MODEL_VERSION },
    );
    if (error) {
      errors.push(`claim: ${sanitizeDbError(error)}`);
      break;
    }
    const candidates = Array.isArray(data) ? data as Candidate[] : [];
    if (candidates.length === 0) break;
    const texts = candidates.map(candidate => buildEmbeddingText(record(candidate.snapshot_json)));
    const vectors = await embedBatch(texts, apiKey, 'RETRIEVAL_DOCUMENT');
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]!;
      const vector = vectors[index];
      const text = texts[index]!;
      if (!vector || vector.length !== 1536 || !text) {
        failed += 1;
        errors.push(`vector ${candidate.snapshot_id.slice(0, 8)}: invalid output`);
        continue;
      }
      const { error: persistError } = await supabaseAdmin.rpc(
        'persist_product_registration_search_embedding',
        { p_payload: {
          tenant_id: candidate.tenant_id,
          catalog_product_id: candidate.catalog_product_id,
          channel: candidate.channel,
          locale: candidate.locale,
          snapshot_id: candidate.snapshot_id,
          snapshot_hash: candidate.snapshot_hash,
          content_hash: contentHash(text),
          model_version: EMBEDDING_MODEL_VERSION,
          embedding: vector,
        } },
      );
      if (persistError) {
        failed += 1;
        errors.push(`persist ${candidate.snapshot_id.slice(0, 8)}: ${sanitizeDbError(persistError)}`);
      } else embedded += 1;
    }
    iterations += 1;
  }

  return apiResponse({
    target: 'immutable_public_snapshot_projection',
    modelVersion: EMBEDDING_MODEL_VERSION,
    embedded,
    failed,
    iterations,
    errors: errors.slice(0, 10),
  });
}
