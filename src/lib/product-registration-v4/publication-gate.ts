import type { SupabaseClient } from '@supabase/supabase-js';

type AnyRecord = Record<string, unknown>;

export type ProductRegistrationV4PublicationGate = {
  required: boolean;
  ok: boolean;
  code: 'NO_V4_LINEAGE' | 'CANONICAL_NORMALIZATION_READY' | 'CANONICAL_JOB_NOT_READY' | 'CANONICAL_NORMALIZATION_MISSING' | 'CANONICAL_LINEAGE_MISMATCH';
  jobId: string | null;
  sourceDocumentId: string | null;
  extractionId: string | null;
  normalizationId: string | null;
  normalizationVersion: string | null;
  rawTextHash: string | null;
  sectionCount: number;
  stage: string | null;
};

const EMPTY_GATE = (code: ProductRegistrationV4PublicationGate['code']): ProductRegistrationV4PublicationGate => ({
  required: code !== 'NO_V4_LINEAGE',
  ok: code === 'NO_V4_LINEAGE',
  code,
  jobId: null,
  sourceDocumentId: null,
  extractionId: null,
  normalizationId: null,
  normalizationVersion: null,
  rawTextHash: null,
  sectionCount: 0,
  stage: null,
});

function packageIdsFromState(state: unknown): string[] {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return [];
  const record = state as AnyRecord;
  const ids = Array.isArray(record.packageIds) ? record.packageIds : [];
  const packageId = typeof record.packageId === 'string' ? [record.packageId] : [];
  return [...packageId, ...ids.filter((value): value is string => typeof value === 'string')];
}

function sectionCount(payload: unknown): number {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 0;
  const sections = (payload as AnyRecord).sections;
  return Array.isArray(sections) ? sections.length : 0;
}

async function loadJobForPackage(input: {
  supabase: SupabaseClient;
  packageId: string;
}): Promise<AnyRecord | null> {
  const { data: draft, error: draftError } = await input.supabase
    .from('product_registration_drafts')
    .select('upload_job_id, source_document_id, extraction_id, created_at')
    .eq('package_id', input.packageId)
    .not('upload_job_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (draftError) throw draftError;

  if (draft?.upload_job_id) {
    const { data: job, error: jobError } = await input.supabase
      .from('upload_jobs')
      .select('id, source_document_id, extraction_id, v4_stage, v4_stage_state, v4_canonical_normalization_id')
      .eq('id', String(draft.upload_job_id))
      .maybeSingle();
    if (jobError) throw jobError;
    return (job as AnyRecord | null) ?? null;
  }

  // The post-registration sidecar is asynchronous. During that window use
  // the packageId stored by the V4 pipeline to keep the publication gate
  // fail-closed instead of treating a missing draft row as legacy data.
  const { data: jobs, error: jobsError } = await input.supabase
    .from('upload_jobs')
    .select('id, source_document_id, extraction_id, v4_stage, v4_stage_state, v4_canonical_normalization_id')
    .in('v4_stage', ['normalized', 'verified', 'proofed', 'published', 'needs_review', 'failed'])
    .not('source_document_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (jobsError) throw jobsError;
  return ((jobs ?? []) as AnyRecord[]).find(job => packageIdsFromState(job.v4_stage_state).includes(input.packageId)) ?? null;
}

export async function loadProductRegistrationV4PublicationGate(input: {
  supabase: SupabaseClient;
  packageId: string;
}): Promise<ProductRegistrationV4PublicationGate> {
  const job = await loadJobForPackage(input);
  if (!job) return EMPTY_GATE('NO_V4_LINEAGE');

  const base = {
    required: true,
    ok: false,
    jobId: typeof job.id === 'string' ? job.id : null,
    sourceDocumentId: typeof job.source_document_id === 'string' ? job.source_document_id : null,
    extractionId: typeof job.extraction_id === 'string' ? job.extraction_id : null,
    normalizationId: typeof job.v4_canonical_normalization_id === 'string' ? job.v4_canonical_normalization_id : null,
    normalizationVersion: null,
    rawTextHash: null,
    sectionCount: 0,
    stage: typeof job.v4_stage === 'string' ? job.v4_stage : null,
  } satisfies Omit<ProductRegistrationV4PublicationGate, 'code'>;

  if (!base.jobId || !base.sourceDocumentId || !base.extractionId
    || !['normalized', 'verified', 'proofed', 'published'].includes(base.stage ?? '')
    || !base.normalizationId) {
    return { ...base, code: 'CANONICAL_JOB_NOT_READY' };
  }

  const { data: normalization, error: normalizationError } = await input.supabase
    .from('product_registration_v4_normalizations')
    .select('id, job_id, source_document_id, extraction_id, normalization_version, raw_text_hash, canonical_payload, status')
    .eq('id', base.normalizationId)
    .eq('job_id', base.jobId)
    .eq('source_document_id', base.sourceDocumentId)
    .eq('extraction_id', base.extractionId)
    .eq('status', 'complete')
    .maybeSingle();
  if (normalizationError) throw normalizationError;
  if (!normalization) return { ...base, code: 'CANONICAL_NORMALIZATION_MISSING' };

  const sections = sectionCount(normalization.canonical_payload);
  if (sections < 1) return { ...base, code: 'CANONICAL_LINEAGE_MISMATCH' };
  return {
    ...base,
    ok: true,
    code: 'CANONICAL_NORMALIZATION_READY',
    normalizationVersion: String(normalization.normalization_version),
    rawTextHash: String(normalization.raw_text_hash),
    sectionCount: sections,
  };
}
