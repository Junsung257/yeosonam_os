#!/usr/bin/env tsx

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import {
  buildAttractionOwnerReviewPack,
  type ActiveAttractionCatalogRow,
  type AttractionOwnerReviewDecision,
  type AttractionRemediationReport,
} from '@/lib/attraction-owner-review-pack';

type CliArgs = {
  report: string;
  decisions: string;
  outputJson: string;
  outputCsv: string;
  activeCatalog: string | null;
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

  const report = values.get('report');
  const decisions = values.get('decisions');
  if (!report || !decisions) {
    throw new Error(
      '사용법: tsx scripts/generate-attraction-owner-review-pack.ts '
      + '--report <operator-remediation-report.json> --decisions <decisions.json> '
      + '[--active-catalog <active-attractions.json>] '
      + '[--output-json <pack.json>] [--output-csv <candidates.csv>]',
    );
  }

  const resolvedReport = resolve(report);
  const outputDir = dirname(resolvedReport);
  return {
    report: resolvedReport,
    decisions: resolve(decisions),
    outputJson: resolve(values.get('output-json') ?? `${outputDir}/attraction-owner-review-pack.json`),
    outputCsv: resolve(values.get('output-csv') ?? `${outputDir}/attraction-owner-review-candidates.csv`),
    activeCatalog: values.get('active-catalog') ? resolve(values.get('active-catalog')!) : null,
  };
}

async function readJson<T>(path: string): Promise<T> {
  const contents = await readFile(path);
  return JSON.parse(contents.toString('utf8')) as T;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [report, decisions] = await Promise.all([
    readJson<AttractionRemediationReport & { generatedAt?: string }>(args.report),
    readJson<AttractionOwnerReviewDecision[]>(args.decisions),
  ]);
  const activeCatalogPayload = args.activeCatalog
    ? await readJson<ActiveAttractionCatalogRow[] | { attractions: ActiveAttractionCatalogRow[] }>(
      args.activeCatalog,
    )
    : [];
  const activeCatalog = Array.isArray(activeCatalogPayload)
    ? activeCatalogPayload
    : activeCatalogPayload.attractions;
  const { pack, candidateCsv } = buildAttractionOwnerReviewPack(
    report,
    decisions,
    new Date().toISOString(),
    activeCatalog,
  );

  await Promise.all([
    mkdir(dirname(args.outputJson), { recursive: true }),
    mkdir(dirname(args.outputCsv), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(args.outputJson, `${JSON.stringify(pack, null, 2)}\n`, 'utf8'),
    writeFile(args.outputCsv, candidateCsv, 'utf8'),
  ]);

  console.log(JSON.stringify({
    report: basename(args.report),
    decisions: basename(args.decisions),
    outputJson: args.outputJson,
    outputCsv: args.outputCsv,
    activeCatalog: args.activeCatalog ? basename(args.activeCatalog) : null,
    summary: pack.summary,
    safeguards: pack.safeguards,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
