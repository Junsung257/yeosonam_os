import type { NextRequest } from 'next/server';

import { supabaseAdmin } from '@/lib/supabase';

import type { BenchmarkEvidenceAnchor, ReviewedBenchmarkAnnotation } from './benchmark-ground-truth';

type JsonObject = Record<string, unknown>;

export function jsonObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

export async function resolveBenchmarkTenantId(input: {
  request: NextRequest;
  bodyTenantId?: unknown;
}): Promise<string | null> {
  const requested = typeof input.bodyTenantId === 'string'
    ? input.bodyTenantId
    : input.request.nextUrl.searchParams.get('tenant_id');
  if (requested && /^[0-9a-f-]{36}$/iu.test(requested)) {
    const { data, error } = await supabaseAdmin.from('tenants').select('id').eq('id', requested).maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
  }
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.id ?? null;
}

export function annotationFromJson(value: unknown): ReviewedBenchmarkAnnotation | null {
  const candidate = jsonObject(value);
  if (!candidate || !Array.isArray(candidate.sections)) return null;
  return candidate as ReviewedBenchmarkAnnotation;
}

export function collectBenchmarkEvidenceAnchors(annotation: ReviewedBenchmarkAnnotation): BenchmarkEvidenceAnchor[] {
  const anchors: BenchmarkEvidenceAnchor[] = [];
  for (const section of annotation.sections) {
    if (section.boundary) anchors.push(section.boundary.startAnchor, section.boundary.endAnchor);
    for (const component of section.priceComponents ?? []) anchors.push(...component.evidence);
    for (const fact of section.commercialFacts ?? []) anchors.push(...fact.evidence);
    for (const day of section.itinerary ?? []) {
      for (const item of day.items) anchors.push(...(item.evidence ?? []));
    }
  }
  const seen = new Set<string>();
  return anchors.filter(anchor => {
    const key = `${anchor.anchorId ?? ''}|${anchor.quoteHash}|${anchor.page ?? ''}|${anchor.tableId ?? ''}|${anchor.row ?? ''}|${anchor.column ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
