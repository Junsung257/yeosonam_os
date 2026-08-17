import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { extractSourceDocumentToIR } from '@/lib/product-registration-v4/extractions';

type CorpusEntry = {
  sourcePath: string;
  filename: string;
  sourceHash: string | null;
  lineageHash: string;
  split: 'development' | 'calibration' | 'frozen';
  duplicateOf: string | null;
  documentClass: string;
};

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hash(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function clipboardLikeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \u00a0]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

async function main(): Promise<void> {
  const manifestPath = resolve(arg('--manifest') ?? (() => { throw new Error('CORPUS_MANIFEST_REQUIRED'); })());
  const outputPath = resolve(arg('--out', 'C:/Users/admin/Downloads/코덱스테스트/product-registration-generated-paste-review-queue.json')!);
  const limit = Math.max(1, Number(arg('--limit', '100')));
  const split = arg('--split', 'development');
  if (split === 'frozen') throw new Error('GENERATED_PASTE_CANNOT_ENTER_FROZEN_HOLDOUT');
  if (!['development', 'calibration'].includes(split ?? '')) throw new Error('PASTE_CANDIDATE_SPLIT_INVALID');
  const manifest = JSON.parse((await readFile(manifestPath)).toString('utf8')) as {
    schemaVersion?: string;
    entries?: CorpusEntry[];
  };
  if (manifest.schemaVersion !== 'product-registration-private-corpus-1') throw new Error('CORPUS_MANIFEST_SCHEMA_INVALID');
  const sourceEntries = (manifest.entries ?? [])
    .filter(entry => !entry.duplicateOf && entry.documentClass === 'travel_product' && entry.split === split)
    .slice(0, limit);
  const cases = [];
  for (const [index, entry] of sourceEntries.entries()) {
    process.stdout.write(`\r[${index + 1}/${sourceEntries.length}] ${entry.filename.slice(0, 65).padEnd(65)}`);
    const buffer = await readFile(entry.sourcePath);
    if (entry.sourceHash && hash(buffer) !== entry.sourceHash) throw new Error(`SOURCE_HASH_MISMATCH:${entry.filename}`);
    const ir = await extractSourceDocumentToIR({ buffer, filename: entry.filename, sourceType: 'hwp' });
    const rawText = clipboardLikeText(ir.text);
    cases.push({
      caseId: `generated-paste:${hash(rawText)}`,
      rawText,
      sourceHash: hash(rawText),
      lineageHash: entry.lineageHash,
      inputKind: 'text' as const,
      pasteOrigin: 'generated_ir' as const,
      split: entry.split,
      filename: `${entry.filename}.generated-paste.txt`,
      supplierKey: null,
      documentFamily: null,
      approvedCancellationPolicyHash: null,
      first: null,
      second: null,
      adjudicator: null,
    });
  }
  process.stdout.write('\n');
  const queue = {
    schemaVersion: 'product-registration-review-queue-1',
    corpusVersion: `${manifestPath}#generated-paste#${split}`,
    generatedAt: new Date().toISOString(),
    privateArtifact: true,
    engineOutputsIncluded: false,
    warning: 'generated_ir cases are regression candidates only. They do not count toward the 100-case operational/manual paste customer-open gate.',
    cases,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath, caseCount: cases.length, countsTowardCustomerOpenGate: false }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
