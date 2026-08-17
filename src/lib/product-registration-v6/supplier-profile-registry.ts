import type { SupabaseClient } from '@supabase/supabase-js';

import type { CatalogSegmentationProfileHints } from '@/lib/parser/catalog-pre-split';

type JsonObject = Record<string, unknown>;

export const SUPPLIER_PROFILE_MIN_SECTIONS = 30;
export const SUPPLIER_PROFILE_MIN_LINEAGES = 10;
export const SUPPLIER_PROFILE_MIN_EXACT_MATCH_RATE = 0.995;

export type QualifiedSupplierLayoutProfile = {
  id: string;
  supplierKey: string;
  documentFamily: string;
  profileVersion: string;
  profileHash: string;
  segmentationHints: CatalogSegmentationProfileHints;
  benchmark: {
    sectionCount: number;
    lineageCount: number;
    criticalFalsePublishCount: number;
    exactMatchRate: number;
  };
};

export type SupplierProfileResolution = {
  supplierKey: string | null;
  documentFamily: string;
  profile: QualifiedSupplierLayoutProfile | null;
  reason:
    | 'supplier_unresolved'
    | 'profile_not_found'
    | 'profile_benchmark_missing'
    | 'profile_benchmark_failed'
    | 'profile_qualified';
};

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedSupplierIdentity(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/(?:주식회사|유한회사|\(주\)|㈜)/gu, '')
    .replace(/[^0-9a-z\p{Script=Hangul}]+/gu, '');
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(item => String(item ?? '').normalize('NFKC').trim())
    .filter(item => item.length >= 2 && item.length <= 80))]
    .slice(0, 20);
}

export function parseCatalogSegmentationProfileHints(value: unknown): CatalogSegmentationProfileHints {
  const rules = object(value);
  return {
    productHeaderTokens: stringList(rules.product_header_tokens ?? rules.productHeaderTokens),
  };
}

export function supplierProfileBenchmarkQualification(input: {
  passed: boolean;
  metrics: unknown;
  criticalFalsePublishCount: unknown;
  exactMatchRate: unknown;
}): QualifiedSupplierLayoutProfile['benchmark'] | null {
  const metrics = object(input.metrics);
  const sectionCount = number(metrics.sectionCount ?? metrics.section_count ?? metrics.sampleCount ?? metrics.sample_count);
  const lineageCount = number(metrics.lineageCount ?? metrics.lineage_count);
  const criticalFalsePublishCount = number(input.criticalFalsePublishCount);
  const exactMatchRate = number(input.exactMatchRate);
  if (!input.passed
    || sectionCount < SUPPLIER_PROFILE_MIN_SECTIONS
    || lineageCount < SUPPLIER_PROFILE_MIN_LINEAGES
    || criticalFalsePublishCount !== 0
    || exactMatchRate < SUPPLIER_PROFILE_MIN_EXACT_MATCH_RATE) return null;
  return { sectionCount, lineageCount, criticalFalsePublishCount, exactMatchRate };
}

async function resolveTrustedSupplierKey(
  supabase: SupabaseClient,
  supplierName: string | null,
): Promise<string | null> {
  const identity = normalizedSupplierIdentity(supplierName);
  if (!identity) return null;
  const { data, error } = await supabase.from('land_operators').select('id,name,aliases');
  if (error) throw error;
  const matches = (data ?? []).filter(row => {
    const candidates = [row.name, ...(Array.isArray(row.aliases) ? row.aliases : [])];
    return candidates.some(candidate => normalizedSupplierIdentity(candidate) === identity);
  });
  return matches.length === 1 ? String(matches[0]!.id) : null;
}

export async function resolveQualifiedSupplierLayoutProfile(input: {
  supabase: SupabaseClient;
  tenantId: string;
  supplierName: string | null;
  documentFamily: string;
}): Promise<SupplierProfileResolution> {
  const supplierKey = await resolveTrustedSupplierKey(input.supabase, input.supplierName);
  if (!supplierKey) {
    return { supplierKey: null, documentFamily: input.documentFamily, profile: null, reason: 'supplier_unresolved' };
  }
  const internal = input.supabase.schema('internal_product_registration');
  const { data: profiles, error: profileError } = await internal
    .from('supplier_layout_profiles')
    .select('id,supplier_key,document_family,profile_version,profile_hash,segmentation_rules,activated_at')
    .eq('tenant_id', input.tenantId)
    .eq('supplier_key', supplierKey)
    .eq('document_family', input.documentFamily)
    .eq('activation_state', 'active')
    .order('activated_at', { ascending: false })
    .limit(1);
  if (profileError) throw profileError;
  const profile = profiles?.[0];
  if (!profile) {
    return { supplierKey, documentFamily: input.documentFamily, profile: null, reason: 'profile_not_found' };
  }
  const { data: runs, error: runError } = await internal
    .from('profile_benchmark_runs')
    .select('metrics,critical_false_publish_count,exact_match_rate,passed,created_at')
    .eq('supplier_layout_profile_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (runError) throw runError;
  const run = runs?.[0];
  if (!run) {
    return { supplierKey, documentFamily: input.documentFamily, profile: null, reason: 'profile_benchmark_missing' };
  }
  const benchmark = supplierProfileBenchmarkQualification({
    passed: run.passed === true,
    metrics: run.metrics,
    criticalFalsePublishCount: run.critical_false_publish_count,
    exactMatchRate: run.exact_match_rate,
  });
  if (!benchmark) {
    return { supplierKey, documentFamily: input.documentFamily, profile: null, reason: 'profile_benchmark_failed' };
  }
  return {
    supplierKey,
    documentFamily: input.documentFamily,
    reason: 'profile_qualified',
    profile: {
      id: String(profile.id),
      supplierKey,
      documentFamily: input.documentFamily,
      profileVersion: String(profile.profile_version),
      profileHash: String(profile.profile_hash),
      segmentationHints: parseCatalogSegmentationProfileHints(profile.segmentation_rules),
      benchmark,
    },
  };
}
