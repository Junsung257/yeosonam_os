#!/usr/bin/env tsx

import './load-script-env';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

import { analyzeUploadInputText } from '@/lib/product-registration-input-guard';
import { runUploadRegistrationPipeline } from '@/lib/product-registration/upload-registration-pipeline';
import type { UploadRequestIntakeSuccess } from '@/lib/product-registration/upload-request-intake';
import { parseUploadSourceMetadata } from '@/lib/upload-source-metadata';
import { isSupabaseAdminConfigured, isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { extractHwpxText } from '@/lib/parser/hwpx-text';

type CliOptions = {
  dir: string | null;
  limit: number;
  register: boolean;
  auditMobile: boolean;
  fillAttractionPhotos: boolean;
  forceReprocess: boolean;
  forceDb: boolean;
  runAfter: boolean;
  landOperator: string | null;
  commissionRate: number | null;
  baseUrl: string;
};

type ExtractedRow = {
  filePath: string;
  fileName: string;
  status:
    | 'extracted'
    | 'extraction_failed'
    | 'input_blocked'
    | 'duplicate_skipped'
    | 'registered'
    | 'registration_failed';
  rawTextHash: string | null;
  extractedTextPath: string | null;
  charCount: number;
  error: string | null;
  savedIds: string[];
  uploadPayload?: Record<string, unknown>;
};

type BatchReport = {
  version: 1;
  startedAt: string;
  finishedAt: string | null;
  inputDir: string;
  outputDir: string;
  mode: {
    register: boolean;
    auditMobile: boolean;
    fillAttractionPhotos: boolean;
    runAfter: boolean;
  };
  dbPreflight: {
    status: 'pass' | 'fail' | 'skipped';
    reason: string;
    responseTimeMs?: number;
  };
  rows: ExtractedRow[];
  mobileAudit: {
    requested: boolean;
    status: 'pass' | 'fail' | 'skipped';
    reason: string;
    packageIds: string[];
    outputPath: string | null;
  };
  summary: {
    totalFiles: number;
    extracted: number;
    extractionFailed: number;
    duplicateSkipped: number;
    registered: number;
    registrationFailed: number;
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

function readNumberArg(name: string, fallback: number): number {
  const value = Number(readArg(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseCli(): CliOptions {
  const dir = readArg('--dir') ?? process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? null;
  const commissionRateRaw = readArg('--commission-rate');
  const commissionRate = commissionRateRaw == null ? null : Number(commissionRateRaw);
  return {
    dir,
    limit: readNumberArg('--limit', 2000),
    register: hasArg('--register'),
    auditMobile: hasArg('--audit-mobile'),
    fillAttractionPhotos: hasArg('--fill-attraction-photos'),
    forceReprocess: hasArg('--force') || hasArg('--reprocess'),
    forceDb: hasArg('--force-db'),
    runAfter: !hasArg('--skip-after'),
    landOperator: readArg('--land-operator'),
    commissionRate: Number.isFinite(commissionRate) ? commissionRate : null,
    baseUrl: readArg('--base-url')
      ?? process.env.NEXT_PUBLIC_BASE_URL
      ?? process.env.NEXT_PUBLIC_SITE_URL
      ?? 'http://localhost:3000',
  };
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function resolveInboxDir(input: string | null): string {
  const candidates = [
    input,
    process.env.UPLOAD_INBOX_DIR,
    join(process.cwd(), '원문등록'),
    join(process.cwd(), 'scratch', 'upload-inbox'),
    join(process.env.USERPROFILE ?? '', 'Desktop', '원문등록'),
    join(process.env.USERPROFILE ?? '', 'Downloads', '원문등록'),
    join(process.env.USERPROFILE ?? '', 'Documents', '원문등록'),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const fullPath = isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
    if (existsSync(fullPath)) return fullPath;
  }

  throw new Error('Upload inbox folder was not found. Pass --dir="C:\\path\\to\\folder" or set UPLOAD_INBOX_DIR.');
}

async function listInputFiles(dir: string, limit: number): Promise<string[]> {
  const candidates: string[] = [];
  const queue = [dir];
  const supported = new Set(['.txt', '.md', '.hwpx', '.hwp', '.pdf']);

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const entries = await import('node:fs/promises').then(fs => fs.readdir(current, { withFileTypes: true }));
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', '.next', '.vercel'].includes(entry.name)) queue.push(fullPath);
        continue;
      }
      if (supported.has(extname(entry.name).toLowerCase())) candidates.push(fullPath);
    }
  }

  const companionStems = new Set(
    candidates
      .filter(filePath => ['.txt', '.md', '.hwpx', '.pdf'].includes(extname(filePath).toLowerCase()))
      .map(filePath => join(dirname(filePath), basename(filePath, extname(filePath))).toLowerCase()),
  );

  return candidates
    .filter(filePath => {
      if (extname(filePath).toLowerCase() !== '.hwp') return true;
      const stem = join(dirname(filePath), basename(filePath, extname(filePath))).toLowerCase();
      return !companionStems.has(stem);
    })
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit);
}

function extractHwpWithExternalTool(filePath: string): string | null {
  const userPythonScripts = process.env.APPDATA ? join(process.env.APPDATA, 'Python') : null;
  const hwp5ExecutableCandidates = [
    userPythonScripts && existsSync(userPythonScripts)
      ? readdirSync(userPythonScripts, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && /^Python\d+$/i.test(entry.name))
        .map(entry => join(userPythonScripts, entry.name, 'Scripts', 'hwp5txt.exe'))
      : [],
  ].flat();

  const hwp5Candidates = [
    { command: 'hwp5txt', args: [filePath] },
    ...hwp5ExecutableCandidates.map(command => ({ command, args: [filePath] })),
    process.env.PYHWP_PYTHON ? { command: process.env.PYHWP_PYTHON, args: ['-m', 'hwp5.hwp5txt', filePath] } : null,
    process.env.USERPROFILE
      ? {
          command: join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
          args: ['-m', 'hwp5.hwp5txt', filePath],
        }
      : null,
    { command: 'py', args: ['-m', 'hwp5.hwp5txt', filePath] },
    { command: 'python', args: ['-m', 'hwp5.hwp5txt', filePath] },
  ].filter((candidate): candidate is { command: string; args: string[] } => {
    if (!candidate) return false;
    return !candidate.command.endsWith('.exe') || existsSync(candidate.command);
  });

  for (const candidate of hwp5Candidates) {
    const result = spawnSync(candidate.command, candidate.args, { encoding: 'utf8', timeout: 30_000 });
    const text = normalizeExtractedText(result.stdout);
    if (result.status === 0 && isUsableHwpText(text)) return text;
  }

  const htmlText = extractHwpViaHtmlFallback(filePath, hwp5ExecutableCandidates);
  if (htmlText) return htmlText;

  return null;
}

function extractHwpViaHtmlFallback(filePath: string, hwp5TxtExecutables: string[]): string | null {
  const htmlCommands = [
    ...hwp5TxtExecutables.map(command => ({
      command: command.replace(/hwp5txt\.exe$/i, 'hwp5html.exe'),
    })),
  ].filter(candidate => existsSync(candidate.command));

  for (const candidate of htmlCommands) {
    const tempRoot = mkdtempSync(join(tmpdir(), 'upload-hwp-html-'));
    const outputDir = join(tempRoot, 'html');
    try {
      const result = spawnSync(candidate.command, ['--output', outputDir, filePath], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      if (result.status !== 0) continue;
      const indexPath = findFirstFileByName(outputDir, 'index.xhtml') ?? findFirstFileByName(tempRoot, 'index.xhtml');
      if (!indexPath || !existsSync(indexPath)) continue;
      const text = extractTextFromHwpHtml(readFileSync(indexPath, 'utf8'));
      if (isUsableHwpText(text)) return text;
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  return null;
}

function findFirstFileByName(root: string, fileName: string): string | null {
  if (!existsSync(root)) return null;
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return fullPath;
    if (entry.isDirectory()) {
      const nested = findFirstFileByName(fullPath, fileName);
      if (nested) return nested;
    }
  }
  return null;
}

function extractTextFromHwpHtml(html: string): string {
  return normalizeExtractedText(decodeHtmlEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, '\n')
      .replace(/<script[\s\S]*?<\/script>/gi, '\n')
      .replace(/<\/(?:td|th|p|tr|div|li|h[1-6])>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]{2,}/g, ' '),
  ));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

function normalizeExtractedText(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function isUsableHwpText(text: string): boolean {
  const meaningfulText = text
    .replace(/<[^>]{1,12}>/g, '')
    .replace(/\s+/g, '');
  const meaningfulLines = text
    .split('\n')
    .map(line => line.replace(/<[^>]{1,12}>/g, '').trim())
    .filter(line => line.length >= 8);

  return meaningfulText.length >= 900 && meaningfulLines.length >= 8;
}

function candidatePdfplumberPythonCommands(): string[] {
  const bundledPython = process.env.USERPROFILE
    ? join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe')
    : null;
  return [
    process.env.PDFPLUMBER_PYTHON,
    process.env.PYTHON,
    bundledPython && existsSync(bundledPython) ? bundledPython : null,
    'python',
  ].filter((command): command is string => Boolean(command));
}

function extractPdfWithPdfplumber(filePath: string): string | null {
  const script = [
    'import sys, pdfplumber',
    "sys.stdout.reconfigure(encoding='utf-8')",
    'path = sys.argv[1]',
    'parts = []',
    'with pdfplumber.open(path) as pdf:',
    '    for page in pdf.pages:',
    "        text = page.extract_text(x_tolerance=1, y_tolerance=3) or ''",
    '        parts.append(text)',
    "print('\\n\\n'.join(parts))",
  ].join('\n');

  for (const pythonCommand of candidatePdfplumberPythonCommands()) {
    const result = spawnSync(pythonCommand, ['-c', script, filePath], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    const text = normalizeExtractedText(result.stdout);
    if (result.status === 0 && text.length >= 10) return text;
  }

  return null;
}

function scoreExtractedSourceText(text: string): number {
  const compact = text.replace(/\s+/g, '');
  const readable = (text.match(/[\p{Script=Hangul}A-Za-z0-9]/gu) ?? []).length;
  const suspiciousGlyphs = (text.match(/[\uA000-\uABFF\uD7B0-\uF8FF]/gu) ?? []).length;
  const lines = text.split('\n').filter(line => line.trim().length >= 8).length;
  const travelSignals = [
    '\uCD9C\uBC1C',
    '\uB3C4\uCC29',
    '\uC0C1\uD488',
    '\uC694\uAE08',
    '\uC77C\uC815',
    '\uC2DD\uC0AC',
    '\uD638\uD154',
    '\uD3EC\uD568',
    '\uBD88\uD3EC\uD568',
    '\uC1FC\uD551',
    '\uC120\uD0DD\uAD00\uAD11',
    '\uD56D\uACF5',
    '\uAC00\uC774\uB4DC',
  ].filter(token => compact.includes(token)).length;
  const priceSignals = (text.match(/(?:[$\\]|USD|KRW)?\s*\d{1,3}(?:,\d{3})+/g) ?? []).length;

  return readable + lines * 20 + travelSignals * 350 + priceSignals * 30 - suspiciousGlyphs * 30;
}

async function extractPdfText(buffer: Buffer, filename: string, filePath: string): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default;
  const parsed = await pdfParse(buffer);
  const pdfParseText = normalizeExtractedText(parsed.text);
  const pdfplumberText = extractPdfWithPdfplumber(filePath);
  const text = pdfplumberText && scoreExtractedSourceText(pdfplumberText) > scoreExtractedSourceText(pdfParseText)
    ? pdfplumberText
    : pdfParseText;

  if (text.length < 10) {
    throw new Error(`PDF text is empty or too short. (${filename})`);
  }

  return text;
}

async function extractTextFromFile(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  const buffer = await readFile(filePath);
  if (ext === '.txt' || ext === '.md') return buffer.toString('utf8');
  if (ext === '.hwpx') return extractHwpxText(buffer, basename(filePath));
  if (ext === '.pdf') return extractPdfText(buffer, basename(filePath), filePath);
  if (ext === '.hwp') {
    const text = extractHwpWithExternalTool(filePath);
    if (text) return text;
    throw new Error('HWP binary extractor is not available. Install hwp5txt/pyhwp, convert to HWPX/PDF, or provide copied text.');
  }
  throw new Error(`Unsupported inbox file extension: ${ext}`);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readTextFile(path: string): Promise<string> {
  const value = await readFile(path, { encoding: 'utf8' });
  return String(value);
}

async function checkDbPreflight(register: boolean): Promise<BatchReport['dbPreflight']> {
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
  const buffer = Buffer.from(parserRawText, 'utf8');
  return {
    ok: true,
    buffer,
    fileHash: createHash('sha256').update(buffer).digest('hex'),
    fileName: metadata.cleanSourceLabel || input.fileName,
    directRawText: parserRawText,
    uploadSourceMetadata: metadata,
    inputAnalysisForTrust: analyzeUploadInputText(parserRawText),
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

async function main(): Promise<void> {
  const options = parseCli();
  const inputDir = resolveInboxDir(options.dir);
  const outputDir = join(process.cwd(), 'scratch', 'upload-inbox-batch-reports', timestampSlug());
  const extractedDir = join(outputDir, 'extracted-text');
  await mkdir(extractedDir, { recursive: true });

  const files = await listInputFiles(inputDir, options.limit);
  const report: BatchReport = {
    version: 1,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    inputDir,
    outputDir,
    mode: {
      register: options.register,
      auditMobile: options.auditMobile,
      fillAttractionPhotos: options.fillAttractionPhotos,
      runAfter: options.runAfter,
    },
    dbPreflight: { status: 'skipped', reason: 'not yet checked' },
    rows: [],
    mobileAudit: {
      requested: options.auditMobile,
      status: 'skipped',
      reason: 'not run',
      packageIds: [],
      outputPath: null,
    },
    summary: {
      totalFiles: files.length,
      extracted: 0,
      extractionFailed: 0,
      duplicateSkipped: 0,
      registered: 0,
      registrationFailed: 0,
      savedPackageIds: 0,
      mobileLandingVerified: false,
      mobileLandingVerificationReason: 'registration not completed',
    },
  };

  const seenRawText = new Map<string, string>();

  for (const filePath of files) {
    const fileName = basename(filePath);
    const row: ExtractedRow = {
      filePath,
      fileName,
      status: 'extraction_failed',
      rawTextHash: null,
      extractedTextPath: null,
      charCount: 0,
      error: null,
      savedIds: [],
    };

    try {
      const rawText = await extractTextFromFile(filePath);
      row.charCount = rawText.length;
      row.rawTextHash = hashText(rawText);
      const firstFileName = seenRawText.get(row.rawTextHash);
      if (firstFileName) {
        row.status = 'duplicate_skipped';
        row.error = `duplicate raw text; first file: ${firstFileName}`;
        report.summary.duplicateSkipped++;
        report.rows.push(row);
        continue;
      }
      seenRawText.set(row.rawTextHash, row.fileName);

      row.extractedTextPath = join(extractedDir, `${row.rawTextHash.slice(0, 12)}-${fileName.replace(/[^\w.-]+/g, '_')}.txt`);
      await writeFile(row.extractedTextPath, rawText, 'utf8');
      row.status = 'extracted';
      report.summary.extracted++;

      const inputQuality = analyzeUploadInputText(rawText);
      if (inputQuality.blocked) {
        row.status = 'input_blocked';
        row.error = inputQuality.issues.map(issue => `${issue.code}:${issue.message}`).join(' | ');
        report.rows.push(row);
        continue;
      }
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
      report.summary.extractionFailed++;
    }
    report.rows.push(row);
  }

  report.dbPreflight = await checkDbPreflight(options.register);
  if (options.register && report.dbPreflight.status !== 'pass' && !options.forceDb) {
    report.finishedAt = new Date().toISOString();
    report.summary.mobileLandingVerificationReason = `DB preflight failed: ${report.dbPreflight.reason}`;
    await writeJson(join(outputDir, 'report.json'), report);
    console.error(`[upload-inbox] DB preflight failed: ${report.dbPreflight.reason}`);
    console.error(`[upload-inbox] extraction report: ${join(outputDir, 'report.json')}`);
    process.exit(1);
  }

  if (options.register) {
    for (const row of report.rows.filter(candidate => candidate.status === 'extracted' && candidate.extractedTextPath)) {
      const rawText = await readTextFile(row.extractedTextPath as string);
      const deferredTasks: Array<() => Promise<void> | void> = [];
      const intake = buildIntake({ rawText, fileName: row.fileName, options });
      try {
        const result = await runUploadRegistrationPipeline({
          intake,
          supabase: supabaseAdmin,
          isSupabaseConfigured,
          safeAfter: task => deferredTasks.push(task),
          postAlert: async () => ({}),
          requestBaseUrl: options.baseUrl,
          publicBaseUrl: options.baseUrl,
        });
        if (options.runAfter && deferredTasks.length > 0) {
          await runDeferredTasks(deferredTasks);
        }
        row.uploadPayload = result.payload;
        row.savedIds = Array.isArray(result.payload.dbIds) ? result.payload.dbIds.map(String) : [];
        if (result.status >= 200 && result.status < 300 && row.savedIds.length > 0) {
          row.status = 'registered';
          report.summary.registered++;
        } else {
          row.status = 'registration_failed';
          row.error = JSON.stringify(result.payload.errors ?? result.payload.failureDiagnostics ?? result.payload).slice(0, 2000);
          report.summary.registrationFailed++;
        }
      } catch (error) {
        row.status = 'registration_failed';
        row.error = error instanceof Error ? error.message : String(error);
        report.summary.registrationFailed++;
      }
    }
  }

  const packageIds = [...new Set(report.rows.flatMap(row => row.savedIds))];
  report.summary.savedPackageIds = packageIds.length;
  report.mobileAudit.packageIds = packageIds;

  if (options.fillAttractionPhotos && packageIds.length > 0) {
    const outputPath = join(outputDir, 'fill-attraction-photos.log');
    runCommandToFile('npx', [
      'tsx',
      'scripts/fill-attraction-photos.ts',
      `--package-ids=${packageIds.join(',')}`,
      '--limit=200',
      '--json',
    ], outputPath);
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

  report.finishedAt = new Date().toISOString();
  await writeJson(join(outputDir, 'report.json'), report);
  await writeJson(join(outputDir, 'summary.json'), report.summary);

  console.log(`[upload-inbox] report: ${join(outputDir, 'report.json')}`);
  console.log(`[upload-inbox] extracted=${report.summary.extracted}/${report.summary.totalFiles} duplicateSkipped=${report.summary.duplicateSkipped} registered=${report.summary.registered} savedIds=${packageIds.length}`);
  console.log(`[upload-inbox] mobileLandingVerified=${report.summary.mobileLandingVerified} (${report.summary.mobileLandingVerificationReason})`);

  if (options.auditMobile && !report.summary.mobileLandingVerified) process.exit(1);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
