import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  evaluateBlogInformationEngineV2Fixtures,
  formatBlogInformationEngineV2EvalSummary,
} from '../src/lib/blog-informational-engine-v2-eval';

const outputDirectory = resolve(
  process.cwd(),
  'docs/specs/20260715-informational-content-engine-v2/reports',
);
const jsonPath = resolve(outputDirectory, 'r14-safety-evaluation.json');
const summaryPath = resolve(outputDirectory, 'r14-safety-summary.md');

async function main(): Promise<void> {
  const report = await evaluateBlogInformationEngineV2Fixtures();
  const summary = formatBlogInformationEngineV2EvalSummary(report);
  await mkdir(dirname(jsonPath), { recursive: true });
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(summaryPath, summary, 'utf8'),
  ]);
  process.stdout.write(`${summary}\nMachine report: ${jsonPath}\n`);
  if (!report.ok) process.exitCode = 1;
}

void main();
