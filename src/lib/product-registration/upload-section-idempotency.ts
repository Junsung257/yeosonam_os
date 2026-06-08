import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeTextForDedup } from '@/lib/parser/upload-text-hash';

export type UploadSectionJobStatus = 'processing' | 'completed' | 'blocked' | 'failed';

export type UploadSectionClaim = {
  shouldProcess: true;
  jobId: string | null;
  rawTextHash: string;
  sectionRawTextHash: string;
  normalizedTitle: string;
  reason: 'disabled' | 'force_reprocess' | 'claimed' | 'reclaimed';
} | {
  shouldProcess: false;
  jobId: string | null;
  rawTextHash: string;
  sectionRawTextHash: string;
  normalizedTitle: string;
  reason: UploadSectionJobStatus | 'duplicate';
  productId: string | null;
  packageId: string | null;
};

type SectionJobRow = {
  id: string;
  status: UploadSectionJobStatus;
  product_id: string | null;
  package_id: string | null;
  attempt_count?: number | null;
  updated_at?: string | null;
};

const STALE_PROCESSING_MS = 45 * 60 * 1000;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizedTitle(value: string): string {
  return normalizeTextForDedup(value).replace(/\s+/g, ' ').slice(0, 240);
}

function isUniqueViolation(error: unknown): boolean {
  const record = error as { code?: string; message?: string } | null | undefined;
  return record?.code === '23505' || /duplicate key/i.test(record?.message ?? '');
}

function shouldReclaimSectionJob(row: SectionJobRow | null, now: Date): boolean {
  if (!row) return false;
  if (row.status === 'failed' || row.status === 'blocked') return true;
  if (row.status !== 'processing') return false;
  const updatedAt = row.updated_at ? Date.parse(row.updated_at) : NaN;
  if (!Number.isFinite(updatedAt)) return false;
  return now.getTime() - updatedAt > STALE_PROCESSING_MS;
}

export function buildUploadSectionJobKey(input: {
  documentRawText: string;
  sectionRawText: string;
  supplierCode: string;
  title: string;
}) {
  return {
    rawTextHash: sha256(normalizeTextForDedup(input.documentRawText || input.sectionRawText)),
    sectionRawTextHash: sha256(normalizeTextForDedup(input.sectionRawText || input.documentRawText)),
    supplierCode: input.supplierCode.trim().toUpperCase() || 'UNKNOWN',
    normalizedTitle: normalizedTitle(input.title || 'untitled'),
  };
}

export async function claimUploadProductSection(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  forceReprocess: boolean;
  uploadId: string;
  documentRawText: string;
  sectionRawText: string;
  supplierCode: string;
  title: string;
}): Promise<UploadSectionClaim> {
  const key = buildUploadSectionJobKey(input);
  const base = {
    rawTextHash: key.rawTextHash,
    sectionRawTextHash: key.sectionRawTextHash,
    normalizedTitle: key.normalizedTitle,
  };

  if (!input.isSupabaseConfigured) {
    return { shouldProcess: true, jobId: null, ...base, reason: 'disabled' };
  }
  if (input.forceReprocess) {
    return { shouldProcess: true, jobId: null, ...base, reason: 'force_reprocess' };
  }

  const insertRow = {
    upload_id: input.uploadId,
    raw_text_hash: key.rawTextHash,
    section_raw_text_hash: key.sectionRawTextHash,
    supplier_code: key.supplierCode,
    normalized_title: key.normalizedTitle,
    status: 'processing' satisfies UploadSectionJobStatus,
    attempt_count: 1,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await input.supabase
    .from('product_registration_section_jobs')
    .insert(insertRow)
    .select('id, status, product_id, package_id')
    .single();

  if (!error) {
    const row = data as SectionJobRow | null;
    return { shouldProcess: true, jobId: row?.id ?? null, ...base, reason: 'claimed' };
  }

  if (!isUniqueViolation(error)) {
    throw new Error(`section idempotency claim failed: ${error.message}`);
  }

  const { data: existing, error: lookupError } = await input.supabase
    .from('product_registration_section_jobs')
    .select('id, status, product_id, package_id, attempt_count, updated_at')
    .eq('raw_text_hash', key.rawTextHash)
    .eq('section_raw_text_hash', key.sectionRawTextHash)
    .eq('supplier_code', key.supplierCode)
    .eq('normalized_title', key.normalizedTitle)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`section idempotency lookup failed: ${lookupError.message}`);
  }

  const row = existing as SectionJobRow | null;
  if (shouldReclaimSectionJob(row, new Date())) {
    const nextAttempt = Math.max(Number(row?.attempt_count ?? 1), 1) + 1;
    const { data: reclaimed, error: reclaimError } = await input.supabase
      .from('product_registration_section_jobs')
      .update({
        upload_id: input.uploadId,
        status: 'processing' satisfies UploadSectionJobStatus,
        attempt_count: nextAttempt,
        error_message: null,
        started_at: new Date().toISOString(),
        completed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row?.id)
      .select('id, status, product_id, package_id, attempt_count, updated_at')
      .single();

    if (reclaimError) {
      throw new Error(`section idempotency reclaim failed: ${reclaimError.message}`);
    }
    const reclaimedRow = reclaimed as SectionJobRow | null;
    return {
      shouldProcess: true,
      jobId: reclaimedRow?.id ?? row?.id ?? null,
      ...base,
      reason: 'reclaimed',
    };
  }

  return {
    shouldProcess: false,
    jobId: row?.id ?? null,
    ...base,
    reason: row?.status ?? 'duplicate',
    productId: row?.product_id ?? null,
    packageId: row?.package_id ?? null,
  };
}

export async function updateUploadProductSectionJob(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  jobId: string | null;
  status: UploadSectionJobStatus;
  productId?: string | null;
  packageId?: string | null;
  errorMessage?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.isSupabaseConfigured || !input.jobId) return { ok: true };

  const patch = {
    status: input.status,
    product_id: input.productId ?? null,
    package_id: input.packageId ?? null,
    error_message: input.errorMessage ?? null,
    completed_at: input.status === 'processing' ? null : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await input.supabase
    .from('product_registration_section_jobs')
    .update(patch)
    .eq('id', input.jobId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
