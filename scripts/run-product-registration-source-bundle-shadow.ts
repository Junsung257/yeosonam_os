import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { buildCanonicalNormalization } from '@/lib/product-registration-v4/canonical-worker';
import { extractSourceDocumentToIR } from '@/lib/product-registration-v4/extractions';
import { mergeSourceBundleDocumentIR } from '@/lib/product-registration-v4/source-bundle-document-ir';
import type { DocumentIR } from '@/lib/product-registration-v4/types';
import {
  assertApprovedBenchmarkCancellationPolicy,
  type ApprovedBenchmarkCancellationPolicy,
} from '@/lib/product-registration-v6/benchmark-policy';
import {
  buildSourceBundleFingerprint,
  diagnoseSourceDocumentBundlePairs,
  resolveSourceDocumentBundles,
  type SourceBundleDocument,
} from '@/lib/product-registration-v6/source-bundle-resolver';
import { evaluateProductRegistrationV6Policy } from '@/lib/product-registration-v6/terminal-policy';

type Split = 'development' | 'calibration' | 'frozen';
type CorpusEntry = {
  sourcePath: string;
  filename: string;
  sourceHash: string;
  split: Split;
  duplicateOf: string | null;
  documentClass: string;
  supplierKey?: string | null;
  prelabel: { outcomes?: string[] };
};

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function directoryShadowKey(path: string): string {
  return `shadow-directory:${sha256(dirname(resolve(path)).toLocaleLowerCase('ko-KR')).slice(0, 20)}`;
}

async function main(): Promise<void> {
  const manifestPath = resolve(arg('--manifest') ?? (() => { throw new Error('SOURCE_BUNDLE_MANIFEST_REQUIRED'); })());
  const policyPath = resolve(arg('--policy') ?? (() => { throw new Error('SOURCE_BUNDLE_POLICY_REQUIRED'); })());
  const outputPath = resolve(arg(
    '--out',
    'C:/Users/admin/Downloads/코덱스테스트/product-registration-source-bundle-shadow.json',
  )!);
  const split = arg('--split', 'development') as Split;
  const quiet = hasFlag('--quiet');
  if (!['development', 'calibration'].includes(split)) throw new Error('SOURCE_BUNDLE_FROZEN_INSPECTION_FORBIDDEN');

  const manifest = JSON.parse((await readFile(manifestPath)).toString('utf8')) as {
    schemaVersion?: string;
    entries?: CorpusEntry[];
  };
  if (manifest.schemaVersion !== 'product-registration-private-corpus-1') throw new Error('SOURCE_BUNDLE_MANIFEST_INVALID');
  const policyArtifact = JSON.parse((await readFile(policyPath)).toString('utf8')) as {
    schemaVersion?: string;
    policy?: unknown;
  };
  if (policyArtifact.schemaVersion !== 'product-registration-approved-cancellation-policy-1') {
    throw new Error('SOURCE_BUNDLE_POLICY_ARTIFACT_INVALID');
  }
  assertApprovedBenchmarkCancellationPolicy(policyArtifact.policy);
  const policy = policyArtifact.policy as ApprovedBenchmarkCancellationPolicy;

  const entries = (manifest.entries ?? []).filter(entry => (
    !entry.duplicateOf && entry.documentClass === 'travel_product' && entry.split === split
  ));
  const irById = new Map<string, DocumentIR>();
  const entryById = new Map<string, CorpusEntry>();
  const documents: SourceBundleDocument[] = [];
  for (const [index, entry] of entries.entries()) {
    if (!quiet) process.stdout.write(`\r[${index + 1}/${entries.length}] ${entry.filename.slice(0, 68).padEnd(68)}`);
    const buffer = await readFile(entry.sourcePath);
    const sourceHash = createHash('sha256').update(buffer).digest('hex');
    if (sourceHash !== entry.sourceHash) throw new Error(`SOURCE_BUNDLE_SOURCE_HASH_MISMATCH:${entry.filename}`);
    const ir = await extractSourceDocumentToIR({ buffer, filename: entry.filename, sourceType: 'hwp' });
    const id = `local:${entry.sourceHash}`;
    const shadowBatchKey = directoryShadowKey(entry.sourcePath);
    const supplierKey = entry.supplierKey ?? shadowBatchKey;
    documents.push({
      id,
      tenantId: 'local-private-corpus',
      supplierKey,
      sourceHash: entry.sourceHash,
      filename: entry.filename,
      text: ir.text,
      cohortKey: split,
      // Historical directory grouping is allowed only inside this private,
      // non-authoritative shadow experiment. Production resolution still
      // requires the real upload batch recorded at intake.
      uploadBatchKey: shadowBatchKey,
    });
    irById.set(id, ir);
    entryById.set(id, entry);
  }
  if (!quiet) process.stdout.write('\n');

  const roleCounts = documents.reduce<Record<string, number>>((counts, document) => {
    const role = buildSourceBundleFingerprint(document).role;
    counts[role] = (counts[role] ?? 0) + 1;
    return counts;
  }, {});
  const candidates = resolveSourceDocumentBundles(documents);
  const diagnostics = diagnoseSourceDocumentBundlePairs(documents);
  const results = [];
  for (const candidate of candidates) {
    const price = documents.find(document => document.id === candidate.priceDocumentId)!;
    const itinerary = documents.find(document => document.id === candidate.itineraryDocumentId)!;
    const merged = mergeSourceBundleDocumentIR({
      bundleHash: candidate.bundleHash,
      members: [price, itinerary].map(document => ({
        sourceDocumentId: document.id,
        extractionId: `shadow:${document.sourceHash}`,
        sourceHash: document.sourceHash,
        role: buildSourceBundleFingerprint(document).role as 'price_sheet' | 'itinerary_sheet',
        documentIr: irById.get(document.id)!,
      })),
    });
    const normalization = await buildCanonicalNormalization({
      allowEvidenceAiSegmentation: true,
      documentIr: merged,
      sourceDocumentId: `shadow-bundle:${candidate.bundleHash}`,
      extractionId: `shadow-bundle:${candidate.bundleHash}`,
    });
    const sections = Array.isArray(normalization.canonicalPayload.sections)
      ? normalization.canonicalPayload.sections as Array<Record<string, unknown>>
      : [];
    const decisions = sections.map((section, sectionIndex) => evaluateProductRegistrationV6Policy({
      canonicalPayload: { sections: [section] },
      sourceTexts: [normalization.sections[sectionIndex]?.rawText ?? merged.text],
      sourceHash: candidate.bundleHash,
      expectedSourceHash: candidate.bundleHash,
      cancellationCoverage: [{
        revisionId: `shadow-bundle:${candidate.bundleHash}:${sectionIndex}`,
        catalogProductId: `shadow-bundle:${candidate.bundleHash}:${sectionIndex}`,
        covered: true,
        policyHash: policy.policy_hash,
      }],
    }));
    const baselineEntries = [entryById.get(price.id)!, entryById.get(itinerary.id)!];
    const baselineSafeCount = baselineEntries.flatMap(entry => entry.prelabel.outcomes ?? [])
      .filter(outcome => outcome !== 'blocked').length;
    const bundleSafeCount = decisions.filter(decision => decision.outcome !== 'blocked').length;
    results.push({
      bundleHash: candidate.bundleHash,
      score: candidate.score,
      ambiguityMargin: candidate.ambiguityMargin,
      groupingAuthority: price.supplierKey?.startsWith('shadow-directory:') ? 'directory_shadow_only' : 'explicit_supplier',
      price: { sourceHash: price.sourceHash, filename: price.filename },
      itinerary: { sourceHash: itinerary.sourceHash, filename: itinerary.filename },
      baselineSafeCount,
      bundleSectionCount: sections.length,
      bundleSafeCount,
      recoveredBlockedPair: baselineSafeCount === 0 && bundleSafeCount > 0,
      outcomes: decisions.map(decision => decision.outcome),
      blockers: [...new Set(decisions.flatMap(decision => decision.blockers))],
    });
  }
  const artifact = {
    schemaVersion: 'product-registration-source-bundle-shadow-1',
    privateArtifact: true,
    generatedAt: new Date().toISOString(),
    sourceManifest: manifestPath,
    split,
    frozenDataInspected: false,
    authoritativeWorkflowInput: false,
    policyHash: policy.policy_hash,
    sourceCount: entries.length,
    roleCounts,
    roleSamples: Object.fromEntries(Object.keys(roleCounts).map(role => [
      role,
      documents.filter(document => buildSourceBundleFingerprint(document).role === role)
        .slice(0, 30)
        .map(document => document.filename),
    ])),
    candidateCount: results.length,
    explicitSupplierCandidateCount: results.filter(result => result.groupingAuthority === 'explicit_supplier').length,
    directoryShadowCandidateCount: results.filter(result => result.groupingAuthority === 'directory_shadow_only').length,
    recoveredBlockedPairCount: results.filter(result => result.recoveredBlockedPair).length,
    safeBundleCount: results.filter(result => result.bundleSafeCount > 0).length,
    nearMisses: diagnostics.slice(0, 50).map(diagnostic => ({
      ...diagnostic,
      priceFilename: entryById.get(diagnostic.priceDocumentId)?.filename ?? null,
      itineraryFilename: entryById.get(diagnostic.itineraryDocumentId)?.filename ?? null,
    })),
    results,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    outputPath,
    sourceCount: artifact.sourceCount,
    roleCounts,
    candidateCount: artifact.candidateCount,
    explicitSupplierCandidateCount: artifact.explicitSupplierCandidateCount,
    directoryShadowCandidateCount: artifact.directoryShadowCandidateCount,
    recoveredBlockedPairCount: artifact.recoveredBlockedPairCount,
    safeBundleCount: artifact.safeBundleCount,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
