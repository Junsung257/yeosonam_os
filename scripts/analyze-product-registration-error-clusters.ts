import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  learningBlockerRiskWeight,
  normalizeLearningBlocker,
} from '@/lib/product-registration-v6/learning-loop';

type Entry = {
  filename: string;
  sourceHash: string | null;
  lineageHash: string;
  split: 'development' | 'calibration' | 'frozen';
  documentClass: string;
  duplicateOf: string | null;
  prelabel: {
    sectionCount: number;
    kernelBlockers?: string[];
    blockers?: string[];
    kernelSectionBlockers?: string[][];
    sectionBlockers?: string[][];
    sourceSalePriceDispositions?: string[];
    departureDatePolicy?: { sectionDispositions?: string[] };
  };
};

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function clusterKey(blocker: string): string {
  return normalizeLearningBlocker(blocker);
}

async function main(): Promise<void> {
  const manifestPath = resolve(arg('--manifest') ?? (() => { throw new Error('ERROR_CLUSTER_MANIFEST_REQUIRED'); })());
  const outputPath = resolve(arg('--out', 'C:/Users/admin/Downloads/코덱스테스트/product-registration-development-error-clusters.json')!);
  const split = arg('--split', 'development');
  if (!['development', 'calibration'].includes(split ?? '')) throw new Error('ERROR_CLUSTER_FROZEN_INSPECTION_FORBIDDEN');
  const manifest = JSON.parse((await readFile(manifestPath)).toString('utf8')) as { entries?: Entry[]; generatedAt?: string };
  const selected = (manifest.entries ?? []).filter(entry => (
    !entry.duplicateOf && entry.split === split && entry.documentClass === 'travel_product'
  ));
  const clusters = new Map<string, {
    layer: 'kernel' | 'terminal';
    blocker: string;
    occurrences: number;
    sourceHashes: Set<string>;
    lineages: Set<string>;
    samples: string[];
  }>();
  for (const entry of selected) {
    const hasSectionDetail = Array.isArray(entry.prelabel.sectionBlockers)
      && Array.isArray(entry.prelabel.kernelSectionBlockers);
    const findings = hasSectionDetail
        ? (entry.prelabel.sectionBlockers ?? []).flatMap((terminalBlockers, index) => {
          if (entry.prelabel.departureDatePolicy?.sectionDispositions?.[index] === 'past_only_excluded') return [];
          if (entry.prelabel.sourceSalePriceDispositions?.[index] === 'source_price_absent') return [];
          const kernelBlockers = entry.prelabel.kernelSectionBlockers?.[index] ?? [];
          const kernelBlockerKeys = new Set(kernelBlockers.map(clusterKey));
          return [
            ...kernelBlockers.map(blocker => ({ layer: 'kernel' as const, blocker })),
            ...terminalBlockers
              .filter(blocker => !kernelBlockerKeys.has(clusterKey(blocker)))
              .map(blocker => ({ layer: 'terminal' as const, blocker })),
          ];
        })
      : (() => {
          const kernelBlockerKeys = new Set((entry.prelabel.kernelBlockers ?? []).map(clusterKey));
          return [
            ...(entry.prelabel.kernelBlockers ?? []).map(blocker => ({ layer: 'kernel' as const, blocker })),
            ...(entry.prelabel.blockers ?? [])
              .filter(blocker => !kernelBlockerKeys.has(clusterKey(blocker)))
              .map(blocker => ({ layer: 'terminal' as const, blocker })),
          ];
        })();
    const seenInSource = new Set<string>();
    for (const finding of findings) {
      const normalizedBlocker = clusterKey(finding.blocker);
      const key = `${finding.layer}:${normalizedBlocker}`;
      if (seenInSource.has(key)) continue;
      seenInSource.add(key);
      const cluster = clusters.get(key) ?? {
        layer: finding.layer,
        blocker: normalizedBlocker,
        occurrences: 0,
        sourceHashes: new Set<string>(),
        lineages: new Set<string>(),
        samples: [],
      };
      cluster.occurrences += 1;
      if (entry.sourceHash) cluster.sourceHashes.add(entry.sourceHash);
      cluster.lineages.add(entry.lineageHash);
      if (cluster.samples.length < 10 && !cluster.samples.includes(entry.filename)) cluster.samples.push(entry.filename);
      clusters.set(key, cluster);
    }
  }
  const ranked = [...clusters.values()].map(cluster => {
    const weight = learningBlockerRiskWeight(cluster.blocker);
    return {
      layer: cluster.layer,
      blocker: cluster.blocker,
      riskWeight: weight,
      occurrences: cluster.occurrences,
      sourceCount: cluster.sourceHashes.size,
      lineageCount: cluster.lineages.size,
      priorityScore: cluster.occurrences * weight * Math.max(1, cluster.lineages.size),
      samples: cluster.samples,
    };
  }).sort((left, right) => right.priorityScore - left.priorityScore || right.occurrences - left.occurrences);
  const artifact = {
    schemaVersion: 'product-registration-development-error-clusters-1',
    privateArtifact: true,
    generatedAt: new Date().toISOString(),
    sourceManifest: manifestPath,
    sourceManifestGeneratedAt: manifest.generatedAt ?? null,
    split,
    frozenDataInspected: false,
    selectedSourceCount: selected.length,
    clusters: ranked,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath, top: ranked.slice(0, 12) }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
