#!/usr/bin/env tsx

import './load-script-env';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { analyzeUploadInputText } from '@/lib/product-registration-input-guard';
import { runUploadRegistrationPipeline } from '@/lib/product-registration/upload-registration-pipeline';
import type { UploadRequestIntakeSuccess } from '@/lib/product-registration/upload-request-intake';
import { parseUploadSourceMetadata } from '@/lib/upload-source-metadata';
import { isSupabaseAdminConfigured, isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

type ExtractReportRow = {
  fileName?: string;
  filePath?: string;
  status?: string;
  rawTextHash?: string | null;
  extractedTextPath?: string | null;
};

type ExtractReport = {
  outputDir?: string;
  rows?: ExtractReportRow[];
};

type OfflineProductAudit = {
  sourceFile: string;
  productIndex: number;
  title: string | null;
  publishableOffline: boolean;
  customerReadyOffline: boolean;
  blockerCategory: string | null;
  blockers: string[];
  warnings: string[];
};

type OfflineAuditReport = {
  sourceReport: string;
  products: OfflineProductAudit[];
};

type CliOptions = {
  auditPath: string;
  register: boolean;
  forceDb: boolean;
  forceReprocess: boolean;
  auditMobile: boolean;
  fillAttractionPhotos: boolean;
  requireAllProductsPublishable: boolean;
  includeReviewNeeded: boolean;
  maxFiles: number | null;
  waitDb: boolean;
  waitDbTimeoutMs: number;
  waitDbIntervalMs: number;
  runAfter: boolean;
  landOperator: string | null;
  commissionRate: number | null;
  baseUrl: string;
};

type RegistrationReportRow = {
  sourceFile: string;
  extractedTextPath: string | null;
  productCount: number;
  publishableOffline: number;
  customerReadyOffline: number;
  status:
    | 'eligible'
    | 'skipped_blocked'
    | 'skipped_review_needed'
    | 'skipped_chunk_limit'
    | 'registered'
    | 'registration_failed';
  savedIds: string[];
  reason: string | null;
  blockedProducts: Array<{
    productIndex: number;
    title: string | null;
    blockerCategory: string | null;
    blockers: string[];
  }>;
};

type RegistrationReport = {
  version: 1;
  generatedAt: string;
  sourceAudit: string;
  sourceExtractReport: string;
  outputDir: string;
  mode: {
    register: boolean;
    auditMobile: boolean;
    fillAttractionPhotos: boolean;
    requireAllProductsPublishable: boolean;
    includeReviewNeeded: boolean;
    runAfter: boolean;
  };
  dbPreflight: {
    status: 'pass' | 'fail' | 'skipped';
    reason: string;
    responseTimeMs?: number;
    attempts?: Array<{
      at: string;
      status: 'pass' | 'fail' | 'skipped';
      reason: string;
      responseTimeMs?: number;
    }>;
  };
  rows: RegistrationReportRow[];
  mobileAudit: {
    requested: boolean;
    status: 'pass' | 'fail' | 'skipped';
    reason: string;
    packageIds: string[];
    outputPath: string | null;
  };
  summary: {
    sourceFiles: number;
    eligibleFiles: number;
    skippedBlockedFiles: number;
    skippedReviewNeededFiles: number;
    skippedChunkLimitFiles: number;
    registeredFiles: number;
    registrationFailedFiles: number;
    savedPackageIds: number;
    mobileLandingVerified: boolean;
    mobileLandingVerificationReason: string;
  };
};

function readArg(name: string): string | null {
  const prefix = `${name}=`;
  return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function hasArg(name: string): boolean {
  return process.argv.slice(2).includes(name);
}

function parseCli(): CliOptions {
  const auditPath = readArg('--audit') ?? readArg('--offline-audit') ?? process.argv.slice(2).find(arg => !arg.startsWith('--'));
  if (!auditPath) {
    throw new Error('Usage: npx tsx scripts/register-upload-inbox-from-report.ts --audit=scratch/.../offline-source-audit.json --register --audit-mobile');
  }
  const commissionRateRaw = readArg('--commission-rate');
  const commissionRate = commissionRateRaw == null ? null : Number(commissionRateRaw);
  return {
    auditPath,
    register: hasArg('--register'),
    forceDb: hasArg('--force-db'),
    forceReprocess: hasArg('--force') || hasArg('--reprocess'),
    auditMobile: hasArg('--audit-mobile'),
    fillAttractionPhotos: hasArg('--fill-attraction-photos'),
    requireAllProductsPublishable: !hasArg('--allow-partial-source'),
    includeReviewNeeded: !hasArg('--exclude-review-needed'),
    maxFiles: readOptionalPositiveNumberArg('--max-files') ?? readOptionalPositiveNumberArg('--limit'),
    waitDb: hasArg('--wait-db'),
    waitDbTimeoutMs: readPositiveNumberArg('--wait-db-timeout-ms', 900_000),
    waitDbIntervalMs: readPositiveNumberArg('--wait-db-interval-ms', 30_000),
    runAfter: !hasArg('--skip-after'),
    landOperator: readArg('--land-operator'),
    commissionRate: Number.isFinite(commissionRate) ? commissionRate : null,
    baseUrl: readArg('--base-url')
      ?? process.env.NEXT_PUBLIC_BASE_URL
      ?? process.env.NEXT_PUBLIC_SITE_URL
      ?? 'http://localhost:3000',
  };
}

function readPositiveNumberArg(name: string, fallback: number): number {
  const rawValue = readArg(name);
  if (rawValue == null) return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readOptionalPositiveNumberArg(name: string): number | null {
  const rawValue = readArg(name);
  if (rawValue == null) return null;
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

async function readJson<T>(path: string): Promise<T> {
  const value = await readFile(path, { encoding: 'utf8' });
  return JSON.parse(String(value)) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readTextFile(path: string): Promise<string> {
  const value = await readFile(path, { encoding: 'utf8' });
  return String(value);
}

function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function checkDbPreflight(register: boolean): Promise<RegistrationReport['dbPreflight']> {
  if (!register) return { status: 'skipped', reason: 'registration was not requested' };
  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) {
    return { status: 'fail', reason: 'Supabase admin environment is not configured' };
  }

  const startedAt = Date.now();
  try {
    const { error } = await supabaseAdmin
      .from('travel_packages')
      .select('id')
      .limit(1)
      .abortSignal(AbortSignal.timeout(5000));
    const responseTimeMs = Date.now() - startedAt;
    if (error) return { status: 'fail', reason: error.message, responseTimeMs };
    return { status: 'pass', reason: 'Supabase admin query succeeded', responseTimeMs };
  } catch (error) {
    return {
      status: 'fail',
      reason: error instanceof Error ? error.message : String(error),
      responseTimeMs: Date.now() - startedAt,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDbPreflight(options: CliOptions): Promise<RegistrationReport['dbPreflight']> {
  if (!options.register || !options.waitDb) return checkDbPreflight(options.register);

  const startedAt = Date.now();
  const attempts: NonNullable<RegistrationReport['dbPreflight']['attempts']> = [];
  while (true) {
    const attempt = await checkDbPreflight(true);
    attempts.push({
      at: new Date().toISOString(),
      status: attempt.status,
      reason: attempt.reason,
      responseTimeMs: attempt.responseTimeMs,
    });
    if (attempt.status === 'pass') return { ...attempt, attempts };

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= options.waitDbTimeoutMs) {
      return {
        ...attempt,
        reason: `DB preflight did not pass before wait timeout (${options.waitDbTimeoutMs}ms): ${attempt.reason}`,
        attempts,
      };
    }
    await sleep(Math.min(options.waitDbIntervalMs, Math.max(1000, options.waitDbTimeoutMs - elapsedMs)));
  }
}

function buildIntake(input: {
  rawText: string;
  fileName: string;
  options: CliOptions;
}): UploadRequestIntakeSuccess {
  const metadata = parseUploadSourceMetadata({
    rawText: input.rawText,
    sourceLabel: input.fileName,
    explicitLandOperator: input.options.landOperator ?? undefined,
    explicitCommissionRate: input.options.commissionRate ?? undefined,
    defaultCommissionRate: 9,
  });
  const parserRawText = metadata.parserRawText ?? input.rawText;
  const inputAnalysisForTrust = analyzeUploadInputText(input.rawText);
  const buffer = Buffer.from(parserRawText, 'utf8');
  return {
    ok: true,
    buffer,
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
    forceReprocess: input.options.forceReprocess,
  };
}

async function runDeferredTasks(tasks: Array<() => Promise<void> | void>): Promise<void> {
  for (const task of tasks) {
    await Promise.resolve().then(task);
  }
}

function runCommandToFile(command: string, args: string[], outputPath: string): { ok: boolean; reason: string } {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 300_000,
  });
  const output = [
    result.stdout ?? '',
    result.stderr ? `\n[stderr]\n${result.stderr}` : '',
  ].join('');
  writeFileSync(outputPath, output, 'utf8');
  if (result.status === 0) return { ok: true, reason: 'command completed' };
  return { ok: false, reason: `exit ${result.status ?? 'unknown'}: ${result.error?.message ?? 'command failed'}` };
}

function groupBySource(products: OfflineProductAudit[]): Map<string, OfflineProductAudit[]> {
  const grouped = new Map<string, OfflineProductAudit[]>();
  for (const product of products) {
    const group = grouped.get(product.sourceFile) ?? [];
    group.push(product);
    grouped.set(product.sourceFile, group);
  }
  return grouped;
}

function extractRowsBySource(report: ExtractReport, sourceReportPath: string): Map<string, ExtractReportRow> {
  const rows = new Map<string, ExtractReportRow>();
  const baseDir = report.outputDir ? resolve(report.outputDir) : dirname(sourceReportPath);
  for (const row of report.rows ?? []) {
    const source = row.fileName ?? row.filePath;
    if (!source || !row.extractedTextPath) continue;
    const extractedTextPath = resolve(baseDir, row.extractedTextPath);
    rows.set(source, { ...row, extractedTextPath });
  }
  return rows;
}

function makeReportRow(input: {
  sourceFile: string;
  products: OfflineProductAudit[];
  extractRow: ExtractReportRow | undefined;
  options: CliOptions;
}): RegistrationReportRow {
  const blockedProducts = input.products.filter(product => !product.publishableOffline);
  const reviewNeededProducts = input.products.filter(product => product.publishableOffline && !product.customerReadyOffline);
  const base: RegistrationReportRow = {
    sourceFile: input.sourceFile,
    extractedTextPath: input.extractRow?.extractedTextPath ?? null,
    productCount: input.products.length,
    publishableOffline: input.products.filter(product => product.publishableOffline).length,
    customerReadyOffline: input.products.filter(product => product.customerReadyOffline).length,
    status: 'eligible',
    savedIds: [],
    reason: null,
    blockedProducts: blockedProducts.map(product => ({
      productIndex: product.productIndex,
      title: product.title,
      blockerCategory: product.blockerCategory,
      blockers: product.blockers.slice(0, 10),
    })),
  };
  if (!input.extractRow?.extractedTextPath || !existsSync(input.extractRow.extractedTextPath)) {
    return { ...base, status: 'skipped_blocked', reason: 'extracted text is missing from source report' };
  }
  if (input.options.requireAllProductsPublishable && blockedProducts.length > 0) {
    return { ...base, status: 'skipped_blocked', reason: 'one or more products in this source are blocked by offline audit' };
  }
  if (!input.options.includeReviewNeeded && reviewNeededProducts.length > 0) {
    return { ...base, status: 'skipped_review_needed', reason: 'offline audit has customer-review warnings; pass --include-review-needed to register anyway' };
  }
  return base;
}

async function main(): Promise<void> {
  const options = parseCli();
  const auditPath = resolve(options.auditPath);
  const offlineAudit = await readJson<OfflineAuditReport>(auditPath);
  const sourceReportPath = resolve(dirname(auditPath), offlineAudit.sourceReport);
  const extractReport = await readJson<ExtractReport>(sourceReportPath);
  const outputDir = join(dirname(auditPath), `registration-from-report-${timestampSlug()}`);
  await mkdir(outputDir, { recursive: true });

  const productsBySource = groupBySource(offlineAudit.products ?? []);
  const extractRows = extractRowsBySource(extractReport, sourceReportPath);
  const rows = [...productsBySource.entries()].map(([sourceFile, products]) => makeReportRow({
    sourceFile,
    products,
    extractRow: extractRows.get(sourceFile),
    options,
  }));
  let eligibleSeen = 0;
  const limitedRows = rows.map(row => {
    if (row.status !== 'eligible' || options.maxFiles == null) return row;
    eligibleSeen++;
    if (eligibleSeen <= options.maxFiles) return row;
    return {
      ...row,
      status: 'skipped_chunk_limit' as const,
      reason: `not processed in this chunk; max-files=${options.maxFiles}`,
    };
  });

  const report: RegistrationReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceAudit: auditPath,
    sourceExtractReport: sourceReportPath,
    outputDir,
    mode: {
      register: options.register,
      auditMobile: options.auditMobile,
      fillAttractionPhotos: options.fillAttractionPhotos,
      requireAllProductsPublishable: options.requireAllProductsPublishable,
      includeReviewNeeded: options.includeReviewNeeded,
      runAfter: options.runAfter,
    },
    dbPreflight: { status: 'skipped', reason: 'not yet checked' },
    rows: limitedRows,
    mobileAudit: {
      requested: options.auditMobile,
      status: 'skipped',
      reason: 'not run',
      packageIds: [],
      outputPath: null,
    },
    summary: {
      sourceFiles: limitedRows.length,
      eligibleFiles: limitedRows.filter(row => row.status === 'eligible').length,
      skippedBlockedFiles: limitedRows.filter(row => row.status === 'skipped_blocked').length,
      skippedReviewNeededFiles: limitedRows.filter(row => row.status === 'skipped_review_needed').length,
      skippedChunkLimitFiles: limitedRows.filter(row => row.status === 'skipped_chunk_limit').length,
      registeredFiles: 0,
      registrationFailedFiles: 0,
      savedPackageIds: 0,
      mobileLandingVerified: false,
      mobileLandingVerificationReason: options.auditMobile
        ? 'registration has not run yet'
        : 'mobile audit was not requested; this report is not customer-ready proof',
    },
  };

  report.dbPreflight = await waitForDbPreflight(options);
  if (options.register && report.dbPreflight.status !== 'pass' && !options.forceDb) {
    report.summary.mobileLandingVerificationReason = `DB preflight failed: ${report.dbPreflight.reason}`;
    await writeJson(join(outputDir, 'report.json'), report);
    console.error(`[register-from-report] DB preflight failed: ${report.dbPreflight.reason}`);
    console.error(`[register-from-report] report: ${join(outputDir, 'report.json')}`);
    process.exit(1);
  }

  if (options.register) {
    for (const row of report.rows.filter(candidate => candidate.status === 'eligible' && candidate.extractedTextPath)) {
      const rawText = await readTextFile(row.extractedTextPath as string);
      const deferredTasks: Array<() => Promise<void> | void> = [];
      try {
        const result = await runUploadRegistrationPipeline({
          intake: buildIntake({ rawText, fileName: row.sourceFile, options }),
          supabase: supabaseAdmin,
          isSupabaseConfigured,
          safeAfter: task => deferredTasks.push(task),
          postAlert: async () => ({}),
          requestBaseUrl: options.baseUrl,
          publicBaseUrl: options.baseUrl,
        });
        if (options.runAfter && deferredTasks.length > 0) await runDeferredTasks(deferredTasks);
        row.savedIds = Array.isArray(result.payload.dbIds) ? result.payload.dbIds.map(String) : [];
        if (result.status >= 200 && result.status < 300 && row.savedIds.length > 0) {
          row.status = 'registered';
          report.summary.registeredFiles++;
        } else {
          row.status = 'registration_failed';
          row.reason = JSON.stringify(result.payload.errors ?? result.payload.failureDiagnostics ?? result.payload).slice(0, 2000);
          report.summary.registrationFailedFiles++;
        }
      } catch (error) {
        row.status = 'registration_failed';
        row.reason = error instanceof Error ? error.message : String(error);
        report.summary.registrationFailedFiles++;
      }
    }
  }

  const packageIds = [...new Set(report.rows.flatMap(row => row.savedIds))];
  report.summary.savedPackageIds = packageIds.length;
  report.mobileAudit.packageIds = packageIds;

  if (options.fillAttractionPhotos && packageIds.length > 0) {
    runCommandToFile('npx', [
      'tsx',
      'scripts/fill-attraction-photos.ts',
      `--package-ids=${packageIds.join(',')}`,
      '--limit=200',
      '--json',
    ], join(outputDir, 'fill-attraction-photos.log'));
  }

  if (options.auditMobile) {
    if (packageIds.length === 0) {
      report.mobileAudit.status = 'skipped';
      report.mobileAudit.reason = 'no saved package ids';
    } else {
      const outputPath = join(outputDir, 'mobile-a4-audit.log');
      const audit = runCommandToFile('node', [
        'scripts/audit-product-mobile-landing-readiness.mjs',
        `--package-ids=${packageIds.join(',')}`,
        '--strict',
        '--json',
      ], outputPath);
      report.mobileAudit.outputPath = outputPath;
      report.mobileAudit.status = audit.ok ? 'pass' : 'fail';
      report.mobileAudit.reason = audit.reason;
    }
  }

  report.summary.mobileLandingVerified = report.mobileAudit.requested && report.mobileAudit.status === 'pass';
  report.summary.mobileLandingVerificationReason = report.summary.mobileLandingVerified
    ? 'targeted mobile/A4 audit passed for saved package ids'
    : report.mobileAudit.requested
      ? report.mobileAudit.reason
      : 'mobile audit was not requested; this report is not customer-ready proof';

  await writeJson(join(outputDir, 'report.json'), report);
  await writeJson(join(outputDir, 'summary.json'), report.summary);

  console.log(`[register-from-report] report: ${join(outputDir, 'report.json')}`);
  console.log(`[register-from-report] eligible=${report.summary.eligibleFiles}/${report.summary.sourceFiles} registered=${report.summary.registeredFiles} savedIds=${packageIds.length}`);
  console.log(`[register-from-report] mobileLandingVerified=${report.summary.mobileLandingVerified} (${report.summary.mobileLandingVerificationReason})`);

  if (options.auditMobile && !report.summary.mobileLandingVerified) process.exit(1);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
