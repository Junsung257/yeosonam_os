#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';

import {
  type OcrBenchmarkCandidate,
  type OcrBenchmarkInput,
  sha256OcrBenchmarkText,
  validateOcrBenchmarkCandidate,
} from '../src/lib/product-registration/ocr-benchmark';

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function requiredArg(name: string): string {
  const value = argValue(name)?.trim();
  if (!value) throw new Error(`MISSING_ARGUMENT:${name}`);
  return value;
}

function sha256Buffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function readExistingManifest(outputPath: string, append: boolean): OcrBenchmarkInput {
  if (!existsSync(outputPath)) return { candidates: [] };
  if (!append) throw new Error('OUTPUT_EXISTS_USE_APPEND');
  const parsed = JSON.parse(readFileSync(outputPath, 'utf8')) as OcrBenchmarkInput;
  if (!Array.isArray(parsed.candidates)) throw new Error('EXISTING_MANIFEST_INVALID');
  return parsed;
}

function assertLocalOutputPath(outputPath: string): void {
  const safeRoot = resolve(process.cwd(), 'data', 'product-registration', 'ocr-shadow');
  const relativePath = relative(safeRoot, outputPath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`OUTPUT_PATH_OUTSIDE_LOCAL_SHADOW_ROOT:${safeRoot}`);
  }
}

function main(): void {
  const engine = requiredArg('--engine');
  const engineVersion = requiredArg('--engine-version');
  const caseId = requiredArg('--case-id');
  const sourcePath = resolve(requiredArg('--source'));
  const extractedTextPath = resolve(requiredArg('--text'));
  const durationMs = Number(requiredArg('--duration-ms'));
  const outputPath = resolve(argValue('--output') ?? 'data/product-registration/ocr-shadow/candidates.json');
  const append = process.argv.includes('--append');

  assertLocalOutputPath(outputPath);
  if (!existsSync(sourcePath)) throw new Error('SOURCE_FILE_NOT_FOUND');
  if (!existsSync(extractedTextPath)) throw new Error('EXTRACTED_TEXT_FILE_NOT_FOUND');
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('DURATION_MS_INVALID');

  const sourceBuffer = readFileSync(sourcePath);
  const extractedText = readFileSync(extractedTextPath, 'utf8');
  const candidate: OcrBenchmarkCandidate = {
    engine,
    engineVersion,
    caseId,
    extractedText,
    sourceFile: basename(sourcePath),
    sourceSha256: sha256Buffer(sourceBuffer),
    extractedTextSha256: sha256OcrBenchmarkText(extractedText),
    durationMs,
  };
  const validationFailures = validateOcrBenchmarkCandidate(candidate);
  if (validationFailures.length > 0) {
    throw new Error(`INVALID_CANDIDATE:${validationFailures.join(',')}`);
  }

  const manifest = readExistingManifest(outputPath, append);
  const duplicate = manifest.candidates.some(existing => (
    existing.engine === candidate.engine
    && existing.engineVersion === candidate.engineVersion
    && existing.caseId === candidate.caseId
    && existing.sourceSha256 === candidate.sourceSha256
  ));
  if (duplicate) throw new Error('DUPLICATE_CANDIDATE_IDENTITY');

  mkdirSync(dirname(outputPath), { recursive: true });
  manifest.candidates.push(candidate);
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    output: relative(process.cwd(), outputPath).replaceAll('\\', '/'),
    engine,
    engineVersion,
    caseId,
    sourceFile: candidate.sourceFile,
    sourceSha256: candidate.sourceSha256,
    extractedTextSha256: candidate.extractedTextSha256,
    durationMs,
    candidateCount: manifest.candidates.length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
