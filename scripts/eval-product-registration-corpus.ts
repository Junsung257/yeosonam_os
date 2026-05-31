#!/usr/bin/env tsx

import { evaluateProductRegistrationCorpus } from '../src/lib/product-registration-evaluator';

type CliOptions = {
  json: boolean;
  strict: boolean;
  minPassRate: number;
  minLlmSkipRate: number;
  minDuplicateSkipRate: number;
  minSectionReadyRate: number;
  minScenarioCoverageRate: number;
};

function readNumberArg(args: string[], name: string, fallback: number): number {
  const prefix = `${name}=`;
  const raw = args.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parseCliOptions(args: string[]): CliOptions {
  return {
    json: args.includes('--json'),
    strict: args.includes('--strict'),
    minPassRate: readNumberArg(args, '--min-pass-rate', 1),
    minLlmSkipRate: readNumberArg(args, '--min-llm-skip-rate', 1),
    minDuplicateSkipRate: readNumberArg(args, '--min-duplicate-skip-rate', 1),
    minSectionReadyRate: readNumberArg(args, '--min-section-ready-rate', 1),
    minScenarioCoverageRate: readNumberArg(args, '--min-scenario-coverage-rate', 1),
  };
}

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function printHuman(report: ReturnType<typeof evaluateProductRegistrationCorpus>): void {
  console.log('Product registration golden corpus');
  console.log(`- fixtures: ${report.passed}/${report.total} passing`);
  console.log(`- field pass: ${pct(report.passRate)}`);
  console.log(`- deterministic LLM skip: ${pct(report.deterministicSkipRate)}`);
  console.log(`- duplicate second-pass skip: ${pct(report.duplicateSecondPassSkipRate)}`);
  console.log(`- section reduce-ready: ${pct(report.sectionReduceReadyRate)}`);
  console.log(`- reusable section chars: ${report.sectionReusableChars.toLocaleString('ko-KR')}`);
  console.log(`- scenario coverage: ${pct(report.scenarioCoverageRate)}`);
  if (report.missingRequiredScenarios.length > 0) {
    console.log(`- missing scenarios: ${report.missingRequiredScenarios.join(', ')}`);
  }

  const failed = report.fixtures.filter(fixture => !fixture.passed);
  if (failed.length > 0) {
    console.log('');
    console.log('Failures');
    for (const fixture of failed) {
      console.log(`- ${fixture.id}: ${fixture.failures.join(', ')}`);
    }
  }
}

function failedThresholds(
  report: ReturnType<typeof evaluateProductRegistrationCorpus>,
  options: CliOptions,
): string[] {
  const failures: string[] = [];
  if (report.passRate < options.minPassRate) failures.push(`passRate ${report.passRate} < ${options.minPassRate}`);
  if (report.deterministicSkipRate < options.minLlmSkipRate) failures.push(`deterministicSkipRate ${report.deterministicSkipRate} < ${options.minLlmSkipRate}`);
  if (report.duplicateSecondPassSkipRate < options.minDuplicateSkipRate) failures.push(`duplicateSecondPassSkipRate ${report.duplicateSecondPassSkipRate} < ${options.minDuplicateSkipRate}`);
  if (report.sectionReduceReadyRate < options.minSectionReadyRate) failures.push(`sectionReduceReadyRate ${report.sectionReduceReadyRate} < ${options.minSectionReadyRate}`);
  if (report.scenarioCoverageRate < options.minScenarioCoverageRate) failures.push(`scenarioCoverageRate ${report.scenarioCoverageRate} < ${options.minScenarioCoverageRate}`);
  return failures;
}

const options = parseCliOptions(process.argv.slice(2));
const report = evaluateProductRegistrationCorpus();

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHuman(report);
}

const thresholdFailures = failedThresholds(report, options);
if (options.strict && thresholdFailures.length > 0) {
  console.error('');
  console.error(`Product registration corpus gate failed: ${thresholdFailures.join('; ')}`);
  process.exit(1);
}
