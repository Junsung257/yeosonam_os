#!/usr/bin/env tsx

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createProductRegistrationV4Job, getProductRegistrationV4Job } from '@/lib/product-registration-v4/jobs';
import { processProductRegistrationV4CanonicalNormalizationJob } from '@/lib/product-registration-v4/canonical-worker';
import { processProductRegistrationV4ExtractionJob } from '@/lib/product-registration-v4/extractions';
import { ensureSourceDocumentStored, inferProductSourceType } from '@/lib/product-registration-v4/source-documents';

type Counts = {
  revisions: number;
  proofs: number;
  outbox: number;
  publicSnapshots: number;
};

function arg(name: string): string | null {
  const value = process.argv.slice(2).find(item => item.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : null;
}

function loadEnvironment(): void {
  const configuredPath = process.env.LIVE_ENV_FILE;
  if (configuredPath) dotenv.config({ path: configuredPath, override: false });
  dotenv.config({ path: '.env.local', override: false });
  dotenv.config({ path: '.env', override: false });
}

async function countRows(supabase: SupabaseClient): Promise<Counts> {
  const readCount = async (table: string): Promise<number> => {
    const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true });
    if (error) throw new Error(`${table}:${error.message}`);
    return count ?? 0;
  };
  return {
    revisions: await readCount('product_registration_v5_revisions'),
    proofs: await readCount('product_registration_v5_proof_runs'),
    outbox: await readCount('product_registration_v5_publication_outbox'),
    publicSnapshots: await readCount('public_package_snapshots'),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  loadEnvironment();
  const filePath = arg('--file');
  if (!filePath) throw new Error('FILE_REQUIRED');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) throw new Error('SUPABASE_ADMIN_ENV_REQUIRED');

  const resolvedFile = path.resolve(filePath);
  const buffer = await fs.readFile(resolvedFile);
  const filename = path.basename(resolvedFile);
  const sourceType = inferProductSourceType(filename, null);
  if (!sourceType) throw new Error('SOURCE_TYPE_UNSUPPORTED');

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as SupabaseClient;
  const before = await countRows(supabase);

  const sourceDocument = await ensureSourceDocumentStored({
    supabase,
    buffer,
    filename,
    declaredMime: null,
    sourceType,
  });

  const job = await createProductRegistrationV4Job({
    supabase,
    sourceType: sourceType === 'text' ? 'text' : 'file',
    sourceDocumentId: sourceDocument.id,
    normalizedHash: null,
  });

  const extraction = await processProductRegistrationV4ExtractionJob({
    supabase,
    jobId: job.id,
  });
  const extractedJob = await getProductRegistrationV4Job({ supabase, jobId: job.id });
  if (!extractedJob) throw new Error('JOB_NOT_FOUND_AFTER_EXTRACTION');

  const normalization = await processProductRegistrationV4CanonicalNormalizationJob({
    supabase,
    job: extractedJob,
  });
  const after = await countRows(supabase);
  const latestJob = await getProductRegistrationV4Job({ supabase, jobId: job.id });
  const state = (latestJob?.v4_stage_state ?? {}) as Record<string, unknown>;
  const revisionIds = Array.isArray(state.v5RevisionIds)
    ? state.v5RevisionIds.filter((value): value is string => typeof value === 'string')
    : [];

  const revisions = revisionIds.length > 0
    ? (await supabase
      .from('product_registration_v5_revisions')
      .select('id,package_id,status,revision_no,payload_hash,lineage_hash,created_at')
      .in('id', revisionIds)
      .order('created_at', { ascending: true })).data ?? []
    : [];

  const result = {
    mode: 'operational-shadow-quarantine',
    customerPublicationAttempted: false,
    file: filename,
    sourceDocument: {
      id: sourceDocument.id,
      sourceType: sourceDocument.source_type,
      sha256: sourceDocument.sha256,
      byteSize: sourceDocument.byte_size,
      status: sourceDocument.status,
    },
    job: {
      id: job.id,
      status: latestJob?.status ?? null,
      v4Stage: latestJob?.v4_stage ?? null,
      reviewReasons: latestJob?.v4_review_reasons ?? [],
      errorCode: latestJob?.v4_last_error_code ?? null,
      errorDetail: latestJob?.v4_last_error_detail ?? null,
    },
    extraction: {
      id: extraction.extraction.id,
      hash: extraction.extraction.extractionHash,
      pages: extraction.documentIr.pages,
      nodes: extraction.documentIr.nodes.length,
      tables: extraction.documentIr.tables.length,
      chars: extraction.documentIr.text.length,
    },
    normalization: {
      id: normalization.normalizationId,
      status: normalization.normalization.status,
      sections: normalization.normalization.qualityDiagnostics.sectionCount,
      blockedSections: normalization.normalization.qualityDiagnostics.blockedSectionCount,
      completeness: normalization.normalization.qualityDiagnostics.completeness,
      gateStatuses: normalization.normalization.qualityDiagnostics.gateStatuses,
    },
    revisions,
    counts: { before, after, delta: {
      revisions: after.revisions - before.revisions,
      proofs: after.proofs - before.proofs,
      outbox: after.outbox - before.outbox,
      publicSnapshots: after.publicSnapshots - before.publicSnapshots,
    } },
  };
  console.log(JSON.stringify(result, null, 2));
}

void main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: errorMessage(error) }, null, 2));
  process.exitCode = 1;
});
