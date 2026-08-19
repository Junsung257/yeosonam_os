import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  evaluateBlogProductionReadinessV4,
  type BlogProductionReadinessInputV4,
} from '../src/lib/blog-production-readiness-v4';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function readEvidence(path: string): BlogProductionReadinessInputV4 {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error(`readiness_evidence_missing:${absolute}`);
  const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as {
    input?: BlogProductionReadinessInputV4;
  } & Partial<BlogProductionReadinessInputV4>;
  return (parsed.input ?? parsed) as BlogProductionReadinessInputV4;
}

function main(): void {
  if (process.argv.includes('--apply')) {
    throw new Error('blog production readiness verification is permanently read-only');
  }
  const evidencePath = argument('evidence');
  if (!evidencePath) {
    throw new Error('usage: --evidence=<collected production evidence json>');
  }
  const input = readEvidence(evidencePath);
  const expectedSha = argument('expected-commit');
  if (expectedSha) input.source.expectedCommitSha = expectedSha;
  const report = evaluateBlogProductionReadinessV4(input);
  const output = { readOnly: true, evidencePath: resolve(evidencePath), input, report };
  const outputPath = argument('output');
  if (outputPath) {
    const absoluteOutputPath = resolve(outputPath);
    mkdirSync(dirname(absoluteOutputPath), { recursive: true });
    writeFileSync(absoluteOutputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write([
      `Blog Generation Readiness V4: ${report.generationReady ? 'PASS' : 'BLOCKED'}`,
      `Blog Publication Readiness V4: ${report.publicationReady ? 'PASS' : 'BLOCKED'}`,
      `Blog Production Readiness V4: ${report.safeToEnableLive ? 'PASS' : 'BLOCKED'}`,
      ...Object.entries(report.scopes).map(([scope, ready]) => `${scope}=${ready ? 'ready' : 'blocked'}`),
      ...report.checks.map((item) => `${item.status.toUpperCase()} ${item.key}: ${item.reason}`),
    ].join('\n') + '\n');
  }
  if (process.argv.includes('--strict')) {
    const passed = process.argv.includes('--generation-only')
      ? report.readyForDraftOnlyGeneration
      : report.readyForLivePublication;
    if (!passed) process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`blog production readiness v4 failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
