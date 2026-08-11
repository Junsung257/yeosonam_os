#!/usr/bin/env tsx

import process from 'node:process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getProductRegistrationV4Job } from '@/lib/product-registration-v4/jobs';
import { processProductRegistrationV4CanonicalNormalizationJob } from '@/lib/product-registration-v4/canonical-worker';

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  loadEnvironment();
  const jobId = arg('--job-id');
  if (!jobId) throw new Error('JOB_ID_REQUIRED');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) throw new Error('SUPABASE_ADMIN_ENV_REQUIRED');
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as SupabaseClient;
  const job = await getProductRegistrationV4Job({ supabase, jobId });
  if (!job) throw new Error('JOB_NOT_FOUND');
  if (!job.source_document_id || !job.extraction_id) throw new Error('CANONICAL_LINEAGE_REQUIRED');

  process.env.PRODUCT_REGISTRATION_V5_SHADOW = '1';
  const result = await processProductRegistrationV4CanonicalNormalizationJob({ supabase, job });
  const state = (result.job.v4_stage_state ?? {}) as Record<string, unknown>;
  const revisionIds = Array.isArray(state.v5RevisionIds)
    ? state.v5RevisionIds.filter((value): value is string => typeof value === 'string')
    : [];
  const revisions = revisionIds.length > 0
    ? (await supabase.from('product_registration_v5_revisions')
      .select('id,package_id,status,revision_no,payload_hash,lineage_hash,supersedes_revision_id')
      .in('id', revisionIds)
      .order('created_at', { ascending: true })).data ?? []
    : [];
  const packageIds = Array.isArray(state.packageIds)
    ? state.packageIds.filter((value): value is string => typeof value === 'string')
    : [];
  const packageRows = packageIds.length > 0
    ? (await supabase.from('travel_packages')
      .select('id,canonical_revision_id,canonical_payload_hash,status,publication_state,audit_status')
      .in('id', packageIds)).data ?? []
    : [];

  console.log(JSON.stringify({
    mode: 'v5-package-rebind-shadow',
    customerPublicationAttempted: false,
    job: { id: result.job.id, stage: result.job.v4_stage, status: result.job.status },
    v5ShadowDiff: state.v5ShadowDiff ?? null,
    packageIds,
    revisions,
    packages: packageRows,
    normalizationId: result.normalizationId,
  }, null, 2));
}

void main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: errorMessage(error) }, null, 2));
  process.exitCode = 1;
});
