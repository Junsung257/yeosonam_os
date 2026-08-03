#!/usr/bin/env tsx

/**
 * Register an audited one-product-per-upload manifest.
 *
 * This is intentionally explicit about the test-only land operator. It never
 * infers an operator or a commission from a filename and it never approves a
 * product. The central upload registration pipeline remains the single write
 * path; this runner only feeds it one audited text at a time.
 */

import './load-script-env';

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { analyzeUploadInputText } from '@/lib/product-registration-input-guard';
import { runUploadRegistrationPipeline } from '@/lib/product-registration/upload-registration-pipeline';
import {
  DEFAULT_LAND_OPERATOR_COMMISSION_RATE,
  parseUploadSourceMetadata,
} from '@/lib/upload-source-metadata';
import { isSupabaseAdminConfigured, isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import type { UploadRequestIntakeSuccess } from '@/lib/product-registration/upload-request-intake';

type ManifestEntry = {
  sequence: number;
  sourceFile: string;
  title?: string | null;
  rawTextHash: string;
  textFileName: string;
  customerReadyOffline?: boolean;
  publishableOffline?: boolean;
  requiredActions?: string[];
};

type Manifest = {
  entries: ManifestEntry[];
  summary?: Record<string, unknown>;
};

type ResultRow = {
  sequence: number;
  sourceFile: string;
  title: string | null;
  rawTextHash: string;
  status: 'registered' | 'duplicate' | 'failed' | 'hash_mismatch';
  packageIds: string[];
  internalCode?: string | null;
  reason?: string | null;
  customerReadyOffline?: boolean;
  requiredActions?: string[];
};

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function hashText(text: string): string {
  return sha256(text);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(String(await readFile(path, { encoding: 'utf8' }))) as T;
}

function buildIntake(input: {
  rawText: string;
  fileName: string;
  landOperator: string;
  commissionRate?: number;
  forceReprocess: boolean;
}): UploadRequestIntakeSuccess {
  const metadata = parseUploadSourceMetadata({
    rawText: input.rawText,
    sourceLabel: input.fileName,
    explicitLandOperator: input.landOperator,
    explicitCommissionRate: input.commissionRate,
    defaultCommissionRate: DEFAULT_LAND_OPERATOR_COMMISSION_RATE,
  });
  const errors = metadata.issues.filter(issue => issue.severity === 'error');
  if (errors.length > 0) {
    throw new Error(errors.map(issue => issue.message).join(' '));
  }

  const parserRawText = metadata.parserRawText ?? input.rawText;
  const inputAnalysisForTrust = analyzeUploadInputText(input.rawText);
  return {
    ok: true,
    buffer: Buffer.from(parserRawText, 'utf8'),
    fileHash: hashText(parserRawText),
    fileName: metadata.cleanSourceLabel || input.fileName,
    directRawText: parserRawText,
    originalRawText: input.rawText,
    parserRawText,
    documentRawText: input.rawText,
    analysisNormalizedText: inputAnalysisForTrust.normalizedText,
    uploadSourceMetadata: metadata,
    inputAnalysisForTrust,
    archiveMode: false,
    bulkMode: false,
    forceReprocess: input.forceReprocess,
  };
}

async function patchDuplicateMetadata(input: {
  internalCode: string;
  operatorName: string;
  operatorId: string;
  commissionRate: number;
}): Promise<string[]> {
  const { data: packageRow } = await supabaseAdmin
    .from('travel_packages')
    .select('id')
    .eq('internal_code', input.internalCode)
    .maybeSingle();
  if (!packageRow?.id) return [];

  const { error } = await supabaseAdmin
    .from('travel_packages')
    .update({
      land_operator: input.operatorName,
      land_operator_id: input.operatorId,
      commission_rate: input.commissionRate,
      status: 'pending',
      publication_state: 'draft',
    })
    .eq('id', packageRow.id);
  if (error) throw new Error(`duplicate metadata patch failed: ${error.message}`);
  return [String(packageRow.id)];
}

async function enforceTestOnlySafety(operatorId: string): Promise<{ total: number; demoted: number }> {
  const { data: rows, error: readError } = await supabaseAdmin
    .from('travel_packages')
    .select('id,status,publication_state')
    .eq('land_operator_id', operatorId);
  if (readError) throw new Error(`test-only safety read failed: ${readError.message}`);
  const packageIds = (rows ?? []).map(row => String(row.id)).filter(Boolean);
  if (packageIds.length === 0) return { total: 0, demoted: 0 };

  const unsafeIds = (rows ?? [])
    .filter(row => row.status !== 'pending' || row.publication_state !== 'draft')
    .map(row => String(row.id));
  if (unsafeIds.length > 0) {
    const { error: updateError } = await supabaseAdmin
      .from('travel_packages')
      .update({ status: 'pending', publication_state: 'draft' })
      .in('id', unsafeIds);
    if (updateError) throw new Error(`test-only safety demotion failed: ${updateError.message}`);
  }
  return { total: packageIds.length, demoted: unsafeIds.length };
}

async function main(): Promise<void> {
  const manifestPath = arg('manifest');
  const operatorName = arg('test-land-operator');
  if (!manifestPath || !operatorName) {
    throw new Error(
      'Usage: npx tsx scripts/register-upload-one-by-one-input-pack.ts '
      + '--manifest=<upload-one-by-one-input-manifest.json> '
      + '--test-land-operator=<explicit QA operator> [--register] [--include-review-needed]',
    );
  }
  if (!hasFlag('register')) {
    throw new Error('Registration is write-enabled only with --register.');
  }
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) {
    throw new Error('Supabase admin environment is not configured.');
  }

  const manifestFile = resolve(manifestPath);
  const manifest = await readJson<Manifest>(manifestFile);
  const inputDir = resolve(dirname(manifestFile), 'texts');
  const commissionRateRaw = arg('commission-rate');
  const commissionRate = commissionRateRaw == null ? undefined : Number(commissionRateRaw);
  if (commissionRate !== undefined && (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100)) {
    throw new Error(`Invalid commission rate: ${commissionRateRaw}`);
  }
  const forceReprocess = hasFlag('force');
  const includeReviewNeeded = hasFlag('include-review-needed');
  const skipAfter = hasFlag('skip-after');
  const fromSequence = Number(arg('from-sequence') ?? '1');
  const toSequence = Number(arg('to-sequence') ?? String(Number.MAX_SAFE_INTEGER));
  if (!Number.isInteger(fromSequence) || !Number.isInteger(toSequence) || fromSequence < 1 || toSequence < fromSequence) {
    throw new Error(`Invalid sequence range: ${fromSequence}-${toSequence}`);
  }
  const entries = (manifest.entries ?? []).filter(entry => entry.sequence >= fromSequence && entry.sequence <= toSequence);
  if (entries.length === 0) throw new Error(`No manifest entries in sequence range ${fromSequence}-${toSequence}`);
  const outputDir = resolve(arg('output-dir') ?? `${dirname(manifestFile)}/registration-one-by-one-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(outputDir, { recursive: true });

  const { data: operator } = await supabaseAdmin
    .from('land_operators')
    .select('id,name,is_active')
    .eq('name', operatorName)
    .maybeSingle();
  if (!operator?.id || !operator.is_active) {
    throw new Error(`Explicit test land operator is not active: ${operatorName}`);
  }

  const results: ResultRow[] = [];
  const deferredTasks: Array<() => Promise<void> | void> = [];
  const safeAfter = (task: () => Promise<void> | void): void => {
    deferredTasks.push(task);
  };

  for (const entry of entries) {
    const result: ResultRow = {
      sequence: entry.sequence,
      sourceFile: entry.sourceFile,
      title: entry.title ?? null,
      rawTextHash: entry.rawTextHash,
      status: 'failed',
      packageIds: [],
      customerReadyOffline: entry.customerReadyOffline,
      requiredActions: entry.requiredActions ?? [],
    };
    if (!includeReviewNeeded && entry.customerReadyOffline === false) {
      result.status = 'failed';
      result.reason = 'offline customer review required; rerun with --include-review-needed';
      results.push(result);
      continue;
    }

    try {
      const rawText = String(await readFile(resolve(inputDir, entry.textFileName), { encoding: 'utf8' }));
      if (sha256(rawText) !== entry.rawTextHash) {
        result.status = 'hash_mismatch';
        result.reason = `expected ${entry.rawTextHash}, got ${sha256(rawText)}`;
        results.push(result);
        continue;
      }

      const pipelineResult = await runUploadRegistrationPipeline({
        intake: buildIntake({
          rawText,
          fileName: entry.sourceFile,
          landOperator: operatorName,
          commissionRate,
          forceReprocess,
        }),
        supabase: supabaseAdmin,
        isSupabaseConfigured,
        safeAfter,
        postAlert: async () => ({}),
        requestBaseUrl: arg('base-url') ?? 'https://www.yeosonam.com',
        publicBaseUrl: arg('base-url') ?? 'https://www.yeosonam.com',
      });
      const payload = pipelineResult.payload as Record<string, unknown>;
      const dbIds = Array.isArray(payload.dbIds) ? payload.dbIds.map(String) : [];
      const duplicateCode = typeof payload.internal_code === 'string' ? payload.internal_code : null;
      if (pipelineResult.status >= 200 && pipelineResult.status < 300 && dbIds.length > 0) {
        result.status = payload.duplicate ? 'duplicate' : 'registered';
        result.packageIds = dbIds;
        result.internalCode = duplicateCode;
      } else if (pipelineResult.status >= 200 && pipelineResult.status < 300 && duplicateCode) {
        result.status = 'duplicate';
        result.internalCode = duplicateCode;
        result.packageIds = await patchDuplicateMetadata({
          internalCode: duplicateCode,
          operatorName,
          operatorId: String(operator.id),
          commissionRate: commissionRate ?? DEFAULT_LAND_OPERATOR_COMMISSION_RATE,
        });
      } else {
        result.status = 'failed';
        result.reason = JSON.stringify(payload.errors ?? payload.failureDiagnostics ?? payload).slice(0, 4000);
      }
    } catch (error) {
      result.status = 'failed';
      result.reason = error instanceof Error ? error.message : String(error);
    }
    results.push(result);
    const completed = results.length;
    console.log(`[one-by-one] ${completed}/${entries.length} seq=${entry.sequence} ${result.status} ids=${result.packageIds.join(',') || '-'}`);
  }

  const packageIds = [...new Set(results.flatMap(row => row.packageIds))];
  const testOnlySafety = await enforceTestOnlySafety(String(operator.id));
  const afterErrors: string[] = [];
  if (!skipAfter) {
    const maxAfter = Number(arg('after-concurrency') ?? 4);
    for (let start = 0; start < deferredTasks.length; start += Math.max(1, maxAfter)) {
      const batch = deferredTasks.slice(start, start + Math.max(1, maxAfter));
      const settled = await Promise.allSettled(batch.map(task => Promise.resolve().then(task)));
      settled.forEach((item, index) => {
        if (item.status === 'rejected') afterErrors.push(`task ${start + index}: ${item.reason instanceof Error ? item.reason.message : String(item.reason)}`);
      });
      console.log(`[one-by-one] after ${Math.min(start + batch.length, deferredTasks.length)}/${deferredTasks.length}`);
    }
  } else {
    console.log(`[one-by-one] after skipped: ${deferredTasks.length}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    manifest: manifestFile,
    sequenceRange: { from: fromSequence, to: toSequence },
    operator: { id: operator.id, name: operator.name, testOnly: true },
    commissionRate: commissionRate ?? DEFAULT_LAND_OPERATOR_COMMISSION_RATE,
    includeReviewNeeded,
    skipAfter,
    forceReprocess,
    counts: {
      manifestEntries: entries.length,
      registered: results.filter(row => row.status === 'registered').length,
      duplicate: results.filter(row => row.status === 'duplicate').length,
      failed: results.filter(row => row.status === 'failed').length,
      hashMismatch: results.filter(row => row.status === 'hash_mismatch').length,
      packageIds: packageIds.length,
      deferredTasks: deferredTasks.length,
      deferredTaskErrors: afterErrors.length,
    },
    packageIds,
    testOnlySafety,
    results,
    deferredTaskErrors: afterErrors,
  };
  await writeFile(`${outputDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputDir, counts: report.counts }, null, 2));
  if (report.counts.failed > 0 || report.counts.hashMismatch > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
