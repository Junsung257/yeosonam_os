#!/usr/bin/env tsx

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { AttractionOwnerReviewPack } from '@/lib/attraction-owner-review-pack';
import {
  buildUploadBatchOperatorChecklist,
  buildUploadBatchOperatorChecklistCsv,
  buildUploadBatchOperatorChecklistMarkdown,
  type UploadChecklistSourceReport,
} from '@/lib/upload-batch-operator-checklist';

type CliArgs = {
  audit: string;
  attractionPack: string;
  outputJson: string;
  outputCsv: string;
  outputMarkdown: string;
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
  const attractionPack = values.get('attraction-pack');
  if (!audit || !attractionPack) {
    throw new Error(
      '사용법: tsx scripts/generate-upload-batch-operator-checklist.ts '
      + '--audit <offline-source-audit.json> '
      + '--attraction-pack <attraction-owner-review-pack.json> '
      + '[--output-json <checklist.json>] [--output-csv <checklist.csv>] '
      + '[--output-markdown <checklist.md>]',
    );
  }

  const resolvedAudit = resolve(audit);
  const outputDir = dirname(resolvedAudit);
  return {
    audit: resolvedAudit,
    attractionPack: resolve(attractionPack),
    outputJson: resolve(
      values.get('output-json') ?? `${outputDir}/upload-one-by-one-checklist.json`,
    ),
    outputCsv: resolve(
      values.get('output-csv') ?? `${outputDir}/upload-one-by-one-checklist.csv`,
    ),
    outputMarkdown: resolve(
      values.get('output-markdown') ?? `${outputDir}/upload-one-by-one-checklist.md`,
    ),
  };
}

async function readJson<T>(path: string): Promise<T> {
  const contents = await readFile(path);
  return JSON.parse(contents.toString('utf8')) as T;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [audit, attractionPack] = await Promise.all([
    readJson<UploadChecklistSourceReport>(args.audit),
    readJson<AttractionOwnerReviewPack>(args.attractionPack),
  ]);
  const checklist = buildUploadBatchOperatorChecklist(audit, attractionPack);
  const csv = buildUploadBatchOperatorChecklistCsv(checklist);
  const markdown = buildUploadBatchOperatorChecklistMarkdown(checklist);

  await Promise.all([
    mkdir(dirname(args.outputJson), { recursive: true }),
    mkdir(dirname(args.outputCsv), { recursive: true }),
    mkdir(dirname(args.outputMarkdown), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(args.outputJson, `${JSON.stringify(checklist, null, 2)}\n`, 'utf8'),
    writeFile(args.outputCsv, csv, 'utf8'),
    writeFile(args.outputMarkdown, markdown, 'utf8'),
  ]);

  console.log(JSON.stringify({
    outputJson: args.outputJson,
    outputCsv: args.outputCsv,
    outputMarkdown: args.outputMarkdown,
    summary: checklist.summary,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
