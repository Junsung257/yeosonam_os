#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import {
  buildUploadOneByOneInputCsv,
  buildUploadOneByOneInputMarkdown,
  buildUploadOneByOneInputPack,
  type UploadInputAuditReport,
  type UploadInputSource,
} from '@/lib/product-registration/upload-one-by-one-input-pack';

type ExtractReportRow = {
  fileName?: string;
  status?: string;
  extractedTextPath?: string | null;
};

type ExtractReport = {
  rows?: ExtractReportRow[];
};

type CliArgs = {
  audit: string;
  outputDir: string;
};

function parseArgs(argv: string[]): CliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} 다음에 경로가 필요합니다.`);
    }
    values.set(argument.slice(2), value);
    index += 1;
  }

  const audit = values.get('audit');
  if (!audit) {
    throw new Error(
      '사용법: tsx scripts/generate-upload-one-by-one-input-pack.ts '
      + '--audit <offline-source-audit.json> [--output-dir <directory>]',
    );
  }
  const resolvedAudit = resolve(audit);
  return {
    audit: resolvedAudit,
    outputDir: resolve(values.get('output-dir') ?? join(dirname(resolvedAudit), 'upload-one-by-one-inputs')),
  };
}

async function readJson<T>(path: string): Promise<T> {
  const contents = await readFile(path, { encoding: 'utf8' });
  return JSON.parse(String(contents)) as T;
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function loadSources(reportPath: string): Promise<UploadInputSource[]> {
  const report = await readJson<ExtractReport>(reportPath);
  if (!Array.isArray(report.rows) || report.rows.length === 0) {
    throw new Error(`추출 보고서 rows가 비어 있습니다: ${reportPath}`);
  }

  return Promise.all(report.rows.map(async (row, index) => {
    if (row.status !== 'extracted' || !row.fileName || !row.extractedTextPath) {
      throw new Error(`추출 보고서 ${index + 1}행이 등록 입력 원문으로 사용할 수 없는 상태입니다.`);
    }
    const extractedTextPath = isAbsolute(row.extractedTextPath)
      ? row.extractedTextPath
      : resolve(dirname(reportPath), row.extractedTextPath);
    return {
      sourceFile: row.fileName,
      extractedTextPath,
      rawText: String(await readFile(extractedTextPath, { encoding: 'utf8' })),
    };
  }));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const audit = await readJson<UploadInputAuditReport>(args.audit);
  const sourceReport = isAbsolute(audit.sourceReport)
    ? audit.sourceReport
    : resolve(dirname(args.audit), audit.sourceReport);
  const sources = await loadSources(sourceReport);
  const pack = buildUploadOneByOneInputPack(audit, sources);

  const textsDir = join(args.outputDir, 'texts');
  const manifestJson = join(args.outputDir, 'upload-one-by-one-input-manifest.json');
  const manifestCsv = join(args.outputDir, 'upload-one-by-one-input-manifest.csv');
  const readme = join(args.outputDir, 'README.md');
  await mkdir(textsDir, { recursive: true });
  await Promise.all(pack.entries.map(entry => (
    writeFile(join(textsDir, entry.textFileName), entry.text, 'utf8')
  )));

  const readBackHashes = await Promise.all(pack.entries.map(async entry => ({
    expected: entry.rawTextHash,
    actual: hashText(String(await readFile(
      join(textsDir, entry.textFileName),
      { encoding: 'utf8' },
    ))),
  })));
  const mismatch = readBackHashes.find(result => result.expected !== result.actual);
  if (mismatch) {
    throw new Error(`생성된 TXT 재검증 실패: 예상 ${mismatch.expected}, 실제 ${mismatch.actual}`);
  }

  await Promise.all([
    writeFile(manifestJson, `${JSON.stringify(pack, null, 2)}\n`, 'utf8'),
    writeFile(manifestCsv, buildUploadOneByOneInputCsv(pack), 'utf8'),
    writeFile(readme, buildUploadOneByOneInputMarkdown(pack), 'utf8'),
  ]);

  console.log(JSON.stringify({
    outputDir: args.outputDir,
    manifestJson,
    manifestCsv,
    readme,
    textFiles: pack.entries.length,
    readBackHashesVerified: readBackHashes.length,
    summary: pack.summary,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
