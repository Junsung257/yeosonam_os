#!/usr/bin/env tsx

import './load-script-env';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { runUploadToOpenAutopilot, type UploadToOpenPackageResult } from '@/lib/product-registration/upload-to-open-autopilot';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

type ExtractionRow = {
  filePath?: string;
  fileName?: string;
  status?: string;
  rawTextHash?: string | null;
  preparedTextPath?: string | null;
  charCount?: number;
  method?: string | null;
  quality?: unknown;
  error?: string | null;
};

type ExtractionReport = {
  summary?: Record<string, unknown>;
  rows?: ExtractionRow[];
};

type RegisterRow = {
  fileName?: string;
  status?: string;
  rawTextHash?: string | null;
  extractedTextPath?: string | null;
  charCount?: number;
  error?: string | null;
  savedIds?: string[];
  uploadPayload?: Record<string, unknown>;
};

type RegisterReport = {
  summary?: Record<string, unknown>;
  rows?: RegisterRow[];
};

type ProofReport = {
  summary?: {
    total?: number;
    pass?: number;
    fail?: number;
    outputDir?: string;
  };
  reportPath?: string;
};

type CopyAuditReport = {
  summary?: {
    totalPackages?: number;
    totalChecks?: number;
    pass?: number;
    fail?: number;
    blocking?: number;
    safeFixable?: number;
    outputDir?: string;
  };
  jsonPath?: string;
  mdPath?: string;
};

type FinalPackageRow = {
  id: string;
  internal_code: string | null;
  title: string | null;
  status: string | null;
  audit_status: string | null;
  updated_at: string | null;
};

type SourceOutcome = {
  fileName: string;
  filePath: string | null;
  extractionStatus: string;
  registrationStatus: string;
  rawTextHash: string | null;
  charCount: number;
  savedPackageIds: string[];
  finalState: 'active' | 'auto_fixed_active' | 'needs_human_source_review' | 'expired_ticketing_archived' | 'extraction_failed' | 'registration_failed';
  reasons: string[];
  repairs: string[];
  packageStatuses: Array<{
    id: string;
    code: string | null;
    title: string | null;
    status: string | null;
    auditStatus: string | null;
    autopilotStage: string | null;
  }>;
};

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function resolvePath(input: string): string {
  return path.isAbsolute(input) ? path.normalize(input) : path.resolve(process.cwd(), input);
}

function mkdirp(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function writeJsonFile(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseJsonFromStdout<T>(stdout: string): T | null {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

function runCommand(input: {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  allowFailure?: boolean;
}): { ok: boolean; stdout: string; stderr: string; exitCode: number | null; logPath: string } {
  console.log(`\n[schedule-hwp] ${input.name}`);
  const result = spawnSync(input.command, input.args, {
    cwd: input.cwd ?? process.cwd(),
    env: process.env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: input.timeoutMs ?? 1_800_000,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const exitCode = result.status ?? null;
  const ok = exitCode === 0;
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
  if (!ok && !input.allowFailure) {
    throw new Error(`${input.name} failed with exit ${exitCode ?? 'unknown'}: ${result.error?.message ?? stderr.slice(0, 500)}`);
  }
  return { ok, stdout, stderr, exitCode, logPath: '' };
}

function listTextFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
    .map(entry => path.join(dir, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function mergeRegisterReports(reports: RegisterReport[]): RegisterReport {
  const rows = reports.flatMap(report => report.rows ?? []);
  const savedIds = [...new Set(rows.flatMap(row => row.savedIds ?? []))];
  const summary = {
    totalFiles: rows.length,
    extracted: rows.filter(row => ['extracted', 'registered', 'registration_failed'].includes(String(row.status))).length,
    extractionFailed: rows.filter(row => row.status === 'extraction_failed').length,
    duplicateSkipped: rows.filter(row => row.status === 'duplicate_skipped').length,
    registered: rows.filter(row => row.status === 'registered').length,
    registrationFailed: rows.filter(row => row.status === 'registration_failed').length,
    savedPackageIds: savedIds.length,
    mobileLandingVerified: false,
    mobileLandingVerificationReason: 'merged from schedule-hwp chunked registration reports',
  };
  return { rows, summary };
}

function latestJsonIn(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => path.join(dir, entry.name))
    .sort((a, b) => readFileSync(b).byteLength - readFileSync(a).byteLength);
  return candidates[0] ?? null;
}

function latestUploadInboxReport(): string | null {
  const root = path.join(process.cwd(), 'scratch/upload-inbox-batch-reports');
  if (!existsSync(root)) return null;
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(root, entry.name, 'report.json'))
    .filter(candidate => existsSync(candidate))
    .sort((a, b) => {
      const aName = path.basename(path.dirname(a));
      const bName = path.basename(path.dirname(b));
      return bName.localeCompare(aName);
    });
  return candidates[0] ?? null;
}

function parseRegisterReportPath(stdout: string): string | null {
  const match = stdout.match(/\[upload-inbox\]\s+report:\s+(.+?report\.json)/);
  return match?.[1]?.trim() ?? null;
}

function safeReasonList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function resultById(results: UploadToOpenPackageResult[]): Map<string, UploadToOpenPackageResult> {
  return new Map(results.map(result => [result.id, result]));
}

async function loadFinalPackages(ids: string[]): Promise<Map<string, FinalPackageRow>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id,internal_code,title,status,audit_status,updated_at')
    .in('id', ids);
  if (error) throw error;
  return new Map((data ?? []).map(row => [String(row.id), row as FinalPackageRow]));
}

function classifySourceOutcome(input: {
  extraction: ExtractionRow;
  registrations: RegisterRow[];
  autopilotById: Map<string, UploadToOpenPackageResult>;
  finalPackages: Map<string, FinalPackageRow>;
}): SourceOutcome {
  const savedPackageIds = [...new Set(input.registrations.flatMap(row => row.savedIds ?? []))];
  const reasons = [
    ...safeReasonList(input.extraction.error),
    ...input.registrations.flatMap(row => safeReasonList(row.error)),
    ...savedPackageIds.flatMap(id => input.autopilotById.get(id)?.reasons ?? []),
  ].filter(Boolean);
  const repairs = savedPackageIds.flatMap(id => input.autopilotById.get(id)?.repairs ?? []);
  const packageStatuses = savedPackageIds.map(id => {
    const finalPackage = input.finalPackages.get(id);
    const autopilot = input.autopilotById.get(id);
    return {
      id,
      code: finalPackage?.internal_code ?? autopilot?.code ?? null,
      title: finalPackage?.title ?? autopilot?.title ?? null,
      status: finalPackage?.status ?? null,
      auditStatus: finalPackage?.audit_status ?? null,
      autopilotStage: autopilot?.stage ?? null,
    };
  });

  let finalState: SourceOutcome['finalState'] = 'needs_human_source_review';
  if (input.extraction.status !== 'extracted' && input.extraction.status !== 'duplicate_skipped') {
    finalState = 'extraction_failed';
  } else if (savedPackageIds.length === 0 || input.registrations.some(row => row.status === 'registration_failed')) {
    finalState = 'registration_failed';
  } else if (savedPackageIds.some(id => input.autopilotById.get(id)?.stage === 'expired_ticketing_deadline_archived')) {
    finalState = 'expired_ticketing_archived';
  } else if (savedPackageIds.length > 0 && savedPackageIds.every(id => input.autopilotById.get(id)?.status === 'opened')) {
    finalState = repairs.length > 0 ? 'auto_fixed_active' : 'active';
  }

  return {
    fileName: String(input.extraction.fileName ?? ''),
    filePath: input.extraction.filePath ? String(input.extraction.filePath) : null,
    extractionStatus: String(input.extraction.status ?? 'unknown'),
    registrationStatus: input.registrations.map(row => row.status ?? 'unknown').join(',') || 'not_attempted',
    rawTextHash: input.extraction.rawTextHash ?? null,
    charCount: Number(input.extraction.charCount ?? 0),
    savedPackageIds,
    finalState,
    reasons: [...new Set(reasons)].slice(0, 30),
    repairs: [...new Set(repairs)].slice(0, 50),
    packageStatuses,
  };
}

async function main(): Promise<void> {
  const rawDir = resolvePath(argValue('--raw-dir') ?? path.join(process.cwd(), '일정표'));
  const limit = Math.max(1, Math.min(Number(argValue('--limit') ?? '47') || 47, 500));
  const baseUrl = (argValue('--base') || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com').replace(/\/+$/, '');
  const outputDir = mkdirp(resolvePath(argValue('--output-dir') ?? path.join(process.cwd(), 'data/product-registration/schedule-hwp-batch', timestampSlug())));
  const extractedDir = mkdirp(path.join(outputDir, 'extracted'));
  const preparedDir = mkdirp(path.join(outputDir, 'prepared'));
  const extractionReportRoot = mkdirp(path.join(outputDir, 'hwp-extraction-reports'));
  const proofDir = mkdirp(path.join(outputDir, 'mobile-proof'));
  const copyAuditDir = mkdirp(path.join(outputDir, 'mobile-copy-audit'));
  const openActive = hasFlag('--open-active');
  const skipExtraction = hasFlag('--skip-extraction');
  const skipRegistration = hasFlag('--skip-registration');
  const skipProof = hasFlag('--skip-proof');
  const skipTextAudit = hasFlag('--skip-text-audit');
  const forceReprocess = hasFlag('--force-reprocess');
  const registerChunkSize = Math.max(1, Math.min(Number(argValue('--register-chunk-size') ?? '6') || 6, 47));

  if (!existsSync(rawDir)) {
    throw new Error(`Schedule HWP folder does not exist: ${rawDir}`);
  }

  console.log(`[schedule-hwp] rawDir=${rawDir}`);
  console.log(`[schedule-hwp] outputDir=${outputDir}`);
  console.log(`[schedule-hwp] openActive=${openActive}`);

  let extractionReportPath: string;
  if (!skipExtraction) {
    runCommand({
      name: 'HWP text extraction',
      command: 'powershell',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'scripts/extract-hwp-inbox.ps1',
        '-RawDir',
        rawDir,
        '-ExtractedDir',
        extractedDir,
        '-PreparedDir',
        preparedDir,
        '-ReportRoot',
        extractionReportRoot,
        '-Limit',
        String(limit),
        '-Force',
      ],
      timeoutMs: 1_800_000,
    });
    extractionReportPath = readFileSync(path.join(extractionReportRoot, 'latest-report.txt'), 'utf8').trim();
  } else {
    extractionReportPath = readFileSync(path.join(extractionReportRoot, 'latest-report.txt'), 'utf8').trim();
  }

  const extractionReport = readJsonFile<ExtractionReport>(extractionReportPath);
  const extractionRows = extractionReport.rows ?? [];
  const rawHashToExtraction = new Map(extractionRows.map(row => [row.rawTextHash, row]));

  let registrationReport: RegisterReport = { rows: [], summary: {} };
  let registerReportPath: string | null = null;
  if (!skipRegistration) {
    const preparedFiles = listTextFiles(preparedDir);
    const chunkReports: RegisterReport[] = [];
    const chunkReportPaths: string[] = [];
    for (let index = 0; index < preparedFiles.length; index += registerChunkSize) {
      const chunkFiles = preparedFiles.slice(index, index + registerChunkSize);
      const chunkNumber = Math.floor(index / registerChunkSize) + 1;
      const chunkDir = mkdirp(path.join(outputDir, 'registration-chunks', String(chunkNumber).padStart(3, '0')));
      for (const file of chunkFiles) {
        copyFileSync(file, path.join(chunkDir, path.basename(file)));
      }
      const register = runCommand({
        name: `central upload registration pipeline chunk ${chunkNumber}/${Math.ceil(preparedFiles.length / registerChunkSize)}`,
        command: 'npx',
        args: [
          'tsx',
          'scripts/register-upload-inbox.ts',
          `--dir=${chunkDir}`,
          '--register',
          '--fill-attraction-photos',
          ...(forceReprocess ? ['--force'] : []),
          `--base-url=${baseUrl}`,
        ],
        timeoutMs: Math.max(1_800_000, Number(argValue('--registration-timeout-ms') ?? '3_600_000') || 3_600_000),
        allowFailure: true,
      });
      const chunkReportPath = parseRegisterReportPath(register.stdout) ?? latestUploadInboxReport();
      if (chunkReportPath && existsSync(chunkReportPath)) {
        chunkReportPaths.push(chunkReportPath);
        chunkReports.push(readJsonFile<RegisterReport>(chunkReportPath));
      }
    }
    registrationReport = mergeRegisterReports(chunkReports);
    registerReportPath = path.join(outputDir, 'merged-register-report.json');
    writeJsonFile(registerReportPath, {
      ...registrationReport,
      chunkReportPaths,
    });
  }

  const registrationRows = registrationReport.rows ?? [];
  const registeredPackageIds = [...new Set(registrationRows.flatMap(row => row.savedIds ?? []))];

  let autopilotResult: Awaited<ReturnType<typeof runUploadToOpenAutopilot>> | null = null;
  if (registeredPackageIds.length > 0) {
    autopilotResult = await runUploadToOpenAutopilot({
      supabase: supabaseAdmin,
      isSupabaseConfigured,
      options: {
        packageIds: registeredPackageIds,
        limit: Math.min(registeredPackageIds.length, 50),
        autoOpen: openActive,
        baseUrl,
      },
    });
  }

  let proofReport: ProofReport | null = null;
  if (!skipProof && registeredPackageIds.length > 0) {
    const proof = runCommand({
      name: 'actual mobile browser proof packages+lp',
      command: 'npx',
      args: [
        'tsx',
        'scripts/prove-hwp-mobile-render.ts',
        `--package-ids=${registeredPackageIds.join(',')}`,
        `--base=${baseUrl}`,
        `--output-dir=${proofDir}`,
        '--apply',
        '--apply-pass-only',
        '--continue-on-fail',
        '--json',
      ],
      timeoutMs: 3_600_000,
      allowFailure: true,
    });
    proofReport = parseJsonFromStdout<ProofReport>(proof.stdout);
  }

  let copyAuditReport: CopyAuditReport | null = null;
  if (!skipTextAudit && registeredPackageIds.length > 0) {
    const copyAudit = runCommand({
      name: 'customer-visible text audit packages+lp',
      command: 'npx',
      args: [
        'tsx',
        'scripts/audit-mobile-landing-copy.ts',
        `--base=${baseUrl}`,
        `--package-ids=${registeredPackageIds.join(',')}`,
        '--surfaces=packages,lp',
        '--concurrency=4',
        `--limit=${Math.max(registeredPackageIds.length, 1)}`,
        '--page-timeout-ms=20000',
        '--text-timeout-ms=8000',
        '--retry=1',
        `--output-dir=${copyAuditDir}`,
        '--json',
      ],
      timeoutMs: 3_600_000,
      allowFailure: true,
    });
    copyAuditReport = parseJsonFromStdout<CopyAuditReport>(copyAudit.stdout);
  }

  const finalPackages = await loadFinalPackages(registeredPackageIds);
  const autopilotByPackageId = resultById(autopilotResult?.results ?? []);
  const registrationsByRawHash = new Map<string, RegisterRow[]>();
  for (const row of registrationRows) {
    const hash = row.rawTextHash ?? '';
    const list = registrationsByRawHash.get(hash) ?? [];
    list.push(row);
    registrationsByRawHash.set(hash, list);
  }

  const sourceOutcomes = extractionRows.map(extraction => {
    const registrations = registrationsByRawHash.get(extraction.rawTextHash ?? '') ?? [];
    if (registrations.length === 0 && extraction.status === 'duplicate_skipped') {
      const first = Array.from(rawHashToExtraction.values()).find(row => row.rawTextHash === extraction.rawTextHash && row.status === 'extracted');
      const firstRegistrations = first ? registrationsByRawHash.get(first.rawTextHash ?? '') ?? [] : [];
      return classifySourceOutcome({ extraction, registrations: firstRegistrations, autopilotById: autopilotByPackageId, finalPackages });
    }
    return classifySourceOutcome({ extraction, registrations, autopilotById: autopilotByPackageId, finalPackages });
  });

  const summary = {
    startedAt: extractionReport.summary ? undefined : null,
    finishedAt: new Date().toISOString(),
    rawDir,
    outputDir,
    openActive,
    extraction: extractionReport.summary ?? {},
    registration: registrationReport.summary ?? {},
    autopilot: autopilotResult ? {
      ok: autopilotResult.ok,
      scanned: autopilotResult.scanned,
      opened: autopilotResult.opened,
      ready_not_opened: autopilotResult.ready_not_opened,
      blocked: autopilotResult.blocked,
      errors: autopilotResult.errors,
    } : null,
    proof: proofReport?.summary ?? null,
    copyAudit: copyAuditReport?.summary ?? null,
    finalStates: sourceOutcomes.reduce<Record<string, number>>((acc, item) => {
      acc[item.finalState] = (acc[item.finalState] ?? 0) + 1;
      return acc;
    }, {}),
    reports: {
      extractionReportPath,
      registerReportPath,
      proofReportPath: proofReport?.reportPath ?? null,
      copyAuditJsonPath: copyAuditReport?.jsonPath ?? null,
      copyAuditMdPath: copyAuditReport?.mdPath ?? null,
    },
  };

  const finalReport = {
    version: 1,
    summary,
    sourceOutcomes,
    autopilotResults: autopilotResult?.results ?? [],
  };
  const finalReportPath = path.join(outputDir, 'schedule-hwp-customer-open-report.json');
  writeJsonFile(finalReportPath, finalReport);
  const summaryPath = path.join(outputDir, 'summary.md');
  writeFileSync(summaryPath, [
    '# Schedule HWP Customer Open Batch',
    '',
    `- Raw folder: ${rawDir}`,
    `- Open active: ${openActive}`,
    `- Extracted: ${String((extractionReport.summary ?? {}).extracted ?? 0)} / ${String((extractionReport.summary ?? {}).totalFiles ?? extractionRows.length)}`,
    `- Registered package IDs: ${registeredPackageIds.length}`,
    `- Opened: ${String(summary.autopilot?.opened ?? 0)}`,
    `- Blocked/review: ${String(summary.autopilot?.blocked ?? 0)}`,
    `- Proof pass/fail: ${String(summary.proof?.pass ?? 0)} / ${String(summary.proof?.fail ?? 0)}`,
    `- Copy audit blocking: ${String(summary.copyAudit?.blocking ?? 0)}`,
    `- Final report: ${finalReportPath}`,
    '',
    '| State | Count |',
    '|---|---:|',
    ...Object.entries(summary.finalStates).map(([state, count]) => `| ${state} | ${count} |`),
    '',
    '## Needs Review',
    '',
    ...sourceOutcomes
      .filter(item => !['active', 'auto_fixed_active', 'expired_ticketing_archived'].includes(item.finalState))
      .slice(0, 80)
      .flatMap(item => [
        `### ${item.fileName}`,
        `- State: ${item.finalState}`,
        `- Packages: ${item.savedPackageIds.join(', ') || '-'}`,
        `- Reasons: ${item.reasons.slice(0, 8).join(' | ') || '-'}`,
        '',
      ]),
  ].join('\n'), 'utf8');

  console.log(JSON.stringify({ summary, finalReportPath, summaryPath }, null, 2));

  const blockingCopy = Number(summary.copyAudit?.blocking ?? 0);
  const proofFail = Number(summary.proof?.fail ?? 0);
  const hardFailed = sourceOutcomes.filter(item => item.finalState === 'extraction_failed' || item.finalState === 'registration_failed').length;
  if (hardFailed > 0 || proofFail > 0 || blockingCopy > 0) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
