import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';

import {
  buildCanonicalNormalization,
  PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION,
} from '@/lib/product-registration-v4/canonical-worker';
import { extractSourceDocumentToIR } from '@/lib/product-registration-v4/extractions';
import { PRODUCT_REGISTRATION_V4_PARSER_VERSION } from '@/lib/product-registration-v4/types';
import { classifyProductSourceDocument, classifyProductSourceFilename } from '@/lib/product-registration-v6/document-classifier';
import { partitionProductSectionsBySalePrice } from '@/lib/product-registration-v6/source-sale-price-disposition';
import { evaluateRegistrationPublicationPolicy } from '@/lib/product-registration-kernel/publication-policy';
import {
  PRODUCT_REGISTRATION_V6_POLICY_VERSION,
  PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
} from '@/lib/product-registration-v6/types';
import {
  assertProductDepartureReferenceDate,
  PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION,
  PRODUCT_SOURCE_DEPARTURE_TIMEZONE,
} from '@/lib/product-registration/future-departure-date-policy';
import {
  assertApprovedBenchmarkCancellationPolicy,
  type ApprovedBenchmarkCancellationPolicy,
} from '@/lib/product-registration-v6/benchmark-policy';

type Split = 'development' | 'calibration' | 'frozen';

type InspectionRegistry = {
  schemaVersion: 'product-registration-inspection-registry-1';
  inspectedSources: Array<{
    sourceHash: string;
    lineageHash?: string;
    reason?: string;
    inspectedAt?: string;
  }>;
};

type CorpusEntry = {
  sourcePath: string;
  filename: string;
  bytes: number;
  sourceHash: string | null;
  normalizedTextHash: string | null;
  lineageHash: string;
  split: Split;
  duplicateOf: string | null;
  documentClass: string;
  classificationReason: string;
  extraction: {
    skipped: boolean;
    succeeded: boolean;
    parser: string | null;
    pages: number;
    tables: number;
    characters: number;
    nativeFallbackUsed: boolean;
    error: string | null;
  };
  prelabel: {
    sectionCount: number;
    status: string | null;
    sectionHashes: string[];
    kernelOutcomes: string[];
    kernelBlockers: string[];
    kernelSectionBlockers?: string[][];
    outcomes: string[];
    terminalOutcomes?: string[];
    blockers: string[];
    sectionBlockers?: string[][];
    sourceSalePriceDispositions?: string[];
    departureDatePolicy?: {
      referenceDate: string;
      inferredDateCount: number;
      excludedPastDateCount: number;
      futureDepartureCount: number;
      pastOnlySectionCount: number;
      sectionDispositions: string[];
    };
    generatedForReviewOnly: true;
  };
};

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function args(name: string): string[] {
  return process.argv.flatMap((value, index) => value === name && process.argv[index + 1]
    ? [process.argv[index + 1]!]
    : []);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function listHwpFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.hwp') output.push(path);
    }
  }
  await visit(root);
  return output.sort((left, right) => left.localeCompare(right, 'ko'));
}

function lineageText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\b20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/g, '<date>')
    .replace(/\b\d{1,2}[./-]\d{1,2}\b/g, '<date>')
    .replace(/\b\d{1,2}:\d{2}\b/g, '<time>')
    .replace(/\d{1,3}(?:,\d{3})+(?:\s*원)?/g, '<money>')
    .replace(/\d{1,3}\.\d{3}\s*원/g, '<money>')
    .replace(/\s+/g, '')
    .slice(0, 200_000);
}

function splitForLineage(lineageHash: string): Split {
  const bucket = Number.parseInt(lineageHash.slice(0, 8), 16) / 0xffffffff;
  if (bucket < 0.7) return 'development';
  if (bucket < 0.85) return 'calibration';
  return 'frozen';
}

async function processFile(
  path: string,
  buffer: Buffer,
  duplicateOf: string | null,
  approvedCancellationPolicyHash: string | null,
  operationalReferenceDate: string | null,
): Promise<CorpusEntry> {
  const sourceHash = sha256(buffer);
  const base: CorpusEntry = {
    sourcePath: path,
    filename: basename(path),
    bytes: buffer.byteLength,
    sourceHash,
    normalizedTextHash: null,
    lineageHash: sourceHash,
    split: splitForLineage(sourceHash),
    duplicateOf,
    documentClass: 'corrupt',
    classificationReason: 'CORRUPT_SOURCE_DOCUMENT',
    extraction: {
      skipped: false,
      succeeded: false,
      parser: null,
      pages: 0,
      tables: 0,
      characters: 0,
      nativeFallbackUsed: false,
      error: null,
    },
    prelabel: {
      sectionCount: 0,
      status: null,
      sectionHashes: [],
      kernelOutcomes: [],
      kernelBlockers: [],
      outcomes: [],
      blockers: [],
      generatedForReviewOnly: true,
    },
  };
  if (duplicateOf) return base;

  const filenameClassification = classifyProductSourceFilename({ sourceType: 'hwp', filename: base.filename });
  if (filenameClassification) {
    base.documentClass = filenameClassification.documentClass;
    base.classificationReason = filenameClassification.reasonCode;
    base.extraction.skipped = true;
    return base;
  }

  try {
    const ir = await extractSourceDocumentToIR({ buffer, filename: base.filename, sourceType: 'hwp' });
    base.normalizedTextHash = sha256(ir.text.normalize('NFKC').replace(/\s+/g, ' ').trim());
    base.lineageHash = sha256(lineageText(ir.text));
    base.split = splitForLineage(base.lineageHash);
    base.extraction = {
      skipped: false,
      succeeded: true,
      parser: `${ir.parser.engine}@${ir.parser.version}`,
      pages: ir.pages,
      tables: ir.tables.length,
      characters: ir.text.length,
      nativeFallbackUsed: ir.assets.some(asset => asset.id === 'rhwp-native-fallback'),
      error: null,
    };
    const classification = classifyProductSourceDocument({ sourceType: 'hwp', documentIr: ir });
    base.documentClass = classification.documentClass;
    base.classificationReason = classification.reasonCode;
    if (classification.documentClass !== 'travel_product') return base;

    const normalized = await buildCanonicalNormalization({
      allowEvidenceAiSegmentation: true,
      documentIr: ir,
      sourceDocumentId: `private-corpus:${sourceHash}`,
      extractionId: `private-extraction:${base.normalizedTextHash}`,
      departureDateReference: operationalReferenceDate ? {
        referenceDate: operationalReferenceDate,
        rollingInferenceEligible: true,
      } : null,
    });
    const sections = Array.isArray(normalized.canonicalPayload.sections)
      ? normalized.canonicalPayload.sections as Array<Record<string, unknown>>
      : [];
    const salePricePartition = partitionProductSectionsBySalePrice({
      sections: normalized.sections,
      canonicalSections: sections,
      documentText: ir.text,
      sourceSectionCount: normalized.sections.length,
    });
    const sourceSalePriceDispositionBySection = new Map(
      salePricePartition.dispositions.map(item => [item.sectionIndex, item.disposition]),
    );
    const decisions = sections.map((section, index) => evaluateRegistrationPublicationPolicy({
      canonicalPayload: { sections: [section] },
      sourceTexts: [normalized.sections[index]?.rawText ?? ''],
      precomputedSourceSalePriceDispositions: sourceSalePriceDispositionBySection.has(index)
        ? [sourceSalePriceDispositionBySection.get(index)!]
        : undefined,
      sourceHash,
      expectedSourceHash: sourceHash,
      cancellationCoverage: approvedCancellationPolicyHash ? [{
        revisionId: `private-corpus:${sourceHash}:${index}`,
        catalogProductId: `private-corpus:${sourceHash}:${index}`,
        covered: true,
        policyHash: approvedCancellationPolicyHash,
      }] : undefined,
      departureDateReference: operationalReferenceDate ? {
        referenceDate: operationalReferenceDate,
        timezone: PRODUCT_SOURCE_DEPARTURE_TIMEZONE,
        policyVersion: PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION,
        rollingInferenceEligible: true,
      } : undefined,
    }));
    base.prelabel = {
      sectionCount: normalized.sections.length,
      status: normalized.status,
      sectionHashes: normalized.sections.map(section => section.rawTextHash),
      kernelOutcomes: sections.map(section => String((section.completeness as Record<string, unknown> | undefined)?.publicationOutcome ?? 'blocked')),
      kernelBlockers: sections.flatMap(section => {
        const completeness = section.completeness as Record<string, unknown> | undefined;
        return Array.isArray(completeness?.blockers) ? completeness.blockers.map(String) : [];
      }),
      kernelSectionBlockers: sections.map(section => {
        const completeness = section.completeness as Record<string, unknown> | undefined;
        return Array.isArray(completeness?.blockers) ? completeness.blockers.map(String) : [];
      }),
      outcomes: decisions.map(decision => decision.outcome),
      terminalOutcomes: decisions.map(decision => decision.terminalOutcome),
      blockers: decisions.flatMap(decision => decision.blockers),
      sectionBlockers: decisions.map(decision => decision.blockers),
      sourceSalePriceDispositions: decisions.map(decision =>
        decision.sourceSalePriceDispositions[0]?.disposition.state ?? 'unknown'),
      ...(operationalReferenceDate ? {
        departureDatePolicy: {
          referenceDate: operationalReferenceDate,
          inferredDateCount: normalized.qualityDiagnostics.departureDatePolicy.inferredDateCount,
          excludedPastDateCount: normalized.qualityDiagnostics.departureDatePolicy.excludedPastDateCount,
          futureDepartureCount: normalized.qualityDiagnostics.departureDatePolicy.futureDepartureCount,
          pastOnlySectionCount: normalized.qualityDiagnostics.departureDatePolicy.pastOnlySectionIndexes.length,
          sectionDispositions: sections.map(section => {
            const policy = section.departureDatePolicy;
            return policy && typeof policy === 'object'
              ? String((policy as Record<string, unknown>).disposition ?? 'undated_or_invalid')
              : 'undated_or_invalid';
          }),
        },
      } : {}),
      generatedForReviewOnly: true,
    };
  } catch (error) {
    base.extraction.error = error instanceof Error ? error.message : String(error);
  }
  return base;
}

function unreadableEntry(path: string, error: unknown): CorpusEntry {
  return {
    sourcePath: path,
    filename: basename(path),
    bytes: 0,
    sourceHash: null,
    normalizedTextHash: null,
    lineageHash: sha256(`unreadable:${path}`),
    split: 'development',
    duplicateOf: null,
    documentClass: 'corrupt',
    classificationReason: 'CORRUPT_SOURCE_DOCUMENT',
    extraction: {
      skipped: false,
      succeeded: false,
      parser: null,
      pages: 0,
      tables: 0,
      characters: 0,
      nativeFallbackUsed: false,
      error: error instanceof Error ? error.message : String(error),
    },
    prelabel: {
      sectionCount: 0,
      status: 'blocked_action_required',
      sectionHashes: [],
      kernelOutcomes: [],
      kernelBlockers: [],
      outcomes: [],
      blockers: ['SOURCE_FILE_UNREADABLE'],
      generatedForReviewOnly: true,
    },
  };
}

async function main(): Promise<void> {
  const roots = (args('--dir').length > 0 ? args('--dir') : ['C:/Users/admin/Downloads/코덱스테스트'])
    .map(value => resolve(value));
  const output = resolve(arg('--out', 'C:/Users/admin/Downloads/코덱스테스트/product-registration-private-corpus-manifest.json')!);
  const seenManifestPaths = args('--seen-manifest').map(value => resolve(value));
  const reuseSplitManifestPath = arg('--reuse-splits-from');
  const allowNewLineages = hasFlag('--allow-new-lineages');
  const policyPath = arg('--policy');
  const inspectionRegistryPath = arg('--inspection-registry');
  const operationalReferenceDateArg = arg('--operational-reference-date');
  const operationalReferenceDate = operationalReferenceDateArg
    ? assertProductDepartureReferenceDate(operationalReferenceDateArg)
    : null;
  if (operationalReferenceDate && !hasFlag('--simulate-current-upload')) {
    throw new Error('OPERATIONAL_REFERENCE_DATE_REQUIRES_SIMULATE_CURRENT_UPLOAD');
  }
  let approvedCancellationPolicy: ApprovedBenchmarkCancellationPolicy | null = null;
  if (policyPath) {
    const policyArtifact = JSON.parse((await readFile(resolve(policyPath))).toString('utf8')) as {
      schemaVersion?: string;
      policy?: unknown;
    };
    if (policyArtifact.schemaVersion !== 'product-registration-approved-cancellation-policy-1') {
      throw new Error('BENCHMARK_CANCELLATION_POLICY_ARTIFACT_INVALID');
    }
    assertApprovedBenchmarkCancellationPolicy(policyArtifact.policy);
    approvedCancellationPolicy = policyArtifact.policy;
  }
  const limit = Number(arg('--limit', '0'));
  const quiet = hasFlag('--quiet');
  const allFiles = [...new Set((await Promise.all(roots.map(listHwpFiles))).flat())]
    .sort((left, right) => left.localeCompare(right, 'ko'));
  const files = limit > 0 ? allFiles.slice(0, limit) : allFiles;
  const seen = new Map<string, string>();
  const entries: CorpusEntry[] = [];
  for (const [index, path] of files.entries()) {
    if (!quiet) process.stdout.write(`\r[${index + 1}/${files.length}] ${basename(path).slice(0, 60).padEnd(60)}`);
    try {
      const buffer = await readFile(path);
      const hash = sha256(buffer);
      const duplicateOf = seen.get(hash) ?? null;
      if (!duplicateOf) seen.set(hash, path);
      entries.push(await processFile(
        path,
        buffer,
        duplicateOf,
        approvedCancellationPolicy?.policy_hash ?? null,
        operationalReferenceDate,
      ));
    } catch (error) {
      entries.push(unreadableEntry(path, error));
    }
  }
  if (!quiet) process.stdout.write('\n');

  const unique = entries.filter(entry => !entry.duplicateOf);
  const travel = unique.filter(entry => entry.documentClass === 'travel_product');
  if (reuseSplitManifestPath) {
    const prior = JSON.parse((await readFile(resolve(reuseSplitManifestPath))).toString('utf8')) as {
      entries?: Array<{ sourcePath?: string; lineageHash?: string; split?: Split; duplicateOf?: string | null }>;
      sourceRoots?: string[];
    };
    const priorRoots = (prior.sourceRoots ?? []).map(value => resolve(value)).sort();
    const currentRoots = [...roots].sort();
    if (priorRoots.length !== currentRoots.length
      || priorRoots.some((value, index) => value !== currentRoots[index])) {
      throw new Error(`REUSED_SPLIT_SOURCE_ROOT_MISMATCH:${priorRoots.join('|')}:${currentRoots.join('|')}`);
    }
    const pinned = new Map<string, Split>();
    const pinnedByPath = new Map<string, Split>();
    for (const entry of prior.entries ?? []) {
      if (entry.duplicateOf || !entry.lineageHash || !entry.split) continue;
      const existing = pinned.get(entry.lineageHash);
      if (existing && existing !== entry.split) throw new Error(`REUSED_SPLIT_LINEAGE_LEAKAGE:${entry.lineageHash}`);
      pinned.set(entry.lineageHash, entry.split);
      if (entry.sourcePath) pinnedByPath.set(resolve(entry.sourcePath).toLowerCase(), entry.split);
    }
    for (const entry of travel) {
      // A supplier may overwrite a file in place. Keep that source family in
      // its prior split even when its content/lineage hash changes, otherwise
      // a revised document can leak from frozen evaluation into development.
      const split = pinned.get(entry.lineageHash)
        ?? pinnedByPath.get(resolve(entry.sourcePath).toLowerCase());
      if (!split) {
        if (!allowNewLineages) throw new Error(`REUSED_SPLIT_LINEAGE_MISSING:${entry.lineageHash}`);
        entry.split = splitForLineage(entry.lineageHash);
      } else {
        entry.split = split;
      }
    }
  }
  const seenSourceHashes = new Set<string>();
  for (const path of seenManifestPaths) {
    const seenManifest = JSON.parse((await readFile(path)).toString('utf8')) as { entries?: Array<{ sourceHash?: string | null }> };
    for (const entry of seenManifest.entries ?? []) {
      if (entry.sourceHash) seenSourceHashes.add(entry.sourceHash);
    }
  }
  if (!reuseSplitManifestPath && seenSourceHashes.size > 0) {
    const byLineage = new Map<string, CorpusEntry[]>();
    for (const entry of travel) {
      const values = byLineage.get(entry.lineageHash) ?? [];
      values.push(entry);
      byLineage.set(entry.lineageHash, values);
    }
    const frozenTarget = Math.max(300, Math.ceil(travel.reduce((sum, entry) => sum + entry.prelabel.sectionCount, 0) * 0.15));
    const unseenGroups = [...byLineage.entries()]
      .filter(([, values]) => !values.some(entry => entry.sourceHash && seenSourceHashes.has(entry.sourceHash)))
      .sort(([left], [right]) => sha256(`frozen:${left}`).localeCompare(sha256(`frozen:${right}`)));
    const frozenLineages = new Set<string>();
    let selectedSections = 0;
    for (const [lineage, values] of unseenGroups) {
      if (selectedSections >= frozenTarget) break;
      frozenLineages.add(lineage);
      selectedSections += values.reduce((sum, entry) => sum + entry.prelabel.sectionCount, 0);
    }
    for (const [lineage, values] of byLineage) {
      const forcedDevelopment = values.some(entry => entry.sourceHash && seenSourceHashes.has(entry.sourceHash));
      const split: Split = forcedDevelopment
        ? 'development'
        : frozenLineages.has(lineage)
          ? 'frozen'
          : Number.parseInt(sha256(`calibration:${lineage}`).slice(0, 8), 16) / 0xffffffff < 0.18
            ? 'calibration'
            : 'development';
      for (const entry of values) entry.split = split;
    }
  }
  let inspectionRegistry: InspectionRegistry | null = null;
  if (inspectionRegistryPath) {
    inspectionRegistry = JSON.parse(
      (await readFile(resolve(inspectionRegistryPath))).toString('utf8'),
    ) as InspectionRegistry;
    if (inspectionRegistry.schemaVersion !== 'product-registration-inspection-registry-1') {
      throw new Error('PRODUCT_REGISTRATION_INSPECTION_REGISTRY_INVALID');
    }
    const inspectedSourceHashes = new Set(inspectionRegistry.inspectedSources.map(item => item.sourceHash));
    const inspectedLineageHashes = new Set(
      inspectionRegistry.inspectedSources.map(item => item.lineageHash).filter(Boolean),
    );
    for (const entry of travel) {
      if (!entry.sourceHash) continue;
      if (inspectedSourceHashes.has(entry.sourceHash) || inspectedLineageHashes.has(entry.lineageHash)) {
        // Once a calibration case has been opened for diagnosis, it becomes
        // development data permanently. Frozen inspection remains forbidden
        // and is never silently repaired by this mechanism.
        if (entry.split === 'frozen') {
          throw new Error(`FROZEN_SOURCE_INSPECTION_RECORDED:${entry.sourceHash}`);
        }
        entry.split = 'development';
      }
    }
  }
  const sectionCounts = travel.reduce<Record<Split, number>>((counts, entry) => {
    counts[entry.split] += entry.prelabel.sectionCount;
    return counts;
  }, { development: 0, calibration: 0, frozen: 0 });
  const corpusHash = sha256(unique.map(entry => [
    entry.sourceHash ?? '',
    entry.lineageHash,
    entry.split,
    entry.documentClass,
  ].join('|')).sort((left, right) => left.localeCompare(right)).join('\n'));
  const manifest = {
    schemaVersion: 'product-registration-private-corpus-1',
    generatedAt: new Date().toISOString(),
    sourceRoots: roots,
    seenManifests: seenManifestPaths,
    reusedSplitsFrom: reuseSplitManifestPath ? resolve(reuseSplitManifestPath) : null,
    inspectionRegistry: inspectionRegistryPath ? resolve(inspectionRegistryPath) : null,
    privateArtifact: true,
    approvedCancellationPolicyHash: approvedCancellationPolicy?.policy_hash ?? null,
    operationalUploadSimulation: operationalReferenceDate ? {
      referenceDate: operationalReferenceDate,
      timezone: PRODUCT_SOURCE_DEPARTURE_TIMEZONE,
      datePolicyVersion: PRODUCT_SOURCE_DEPARTURE_DATE_POLICY_VERSION,
      warning: 'Simulation only. This is not reviewed ground truth or customer-open evidence.',
    } : null,
    warning: 'Engine prelabels are not ground truth. Critical fields require two independent blinded reviews.',
    engineRelease: {
      buildId: arg('--build-id', process.env.VERCEL_GIT_COMMIT_SHA ?? 'working-tree-uncommitted'),
      parserVersion: PRODUCT_REGISTRATION_V4_PARSER_VERSION,
      normalizationVersion: PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION,
      workflowVersion: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
      policyVersion: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
      corpusHash,
      referenceDate: operationalReferenceDate,
    },
    totals: {
      files: entries.length,
      uniqueSources: unique.length,
      duplicateSources: entries.length - unique.length,
      extractionAttempted: unique.filter(entry => !entry.extraction.skipped).length,
      extractionSuccess: unique.filter(entry => !entry.extraction.skipped && entry.extraction.succeeded).length,
      filenamePreclassifiedNonTravel: unique.filter(entry => entry.extraction.skipped && entry.documentClass === 'non_travel').length,
      travelSources: travel.length,
      travelSections: travel.reduce((sum, entry) => sum + entry.prelabel.sectionCount, 0),
      frozenTravelSections: sectionCounts.frozen,
      frozenMinimumMet: sectionCounts.frozen >= 300,
      sectionCounts,
    },
    entries,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output, totals: manifest.totals }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
