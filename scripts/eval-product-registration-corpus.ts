#!/usr/bin/env tsx

import { evaluateProductRegistrationCorpus } from '../src/lib/product-registration-evaluator';
import { evaluateGoldenCorpus, type GoldenCorpusReport } from '../src/lib/product-registration/golden-corpus/evaluator';

type EvalReport = {
  supplierRaw: ReturnType<typeof evaluateProductRegistrationCorpus>;
  customerDeliverability: GoldenCorpusReport;
};

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

function printHuman(report: EvalReport): void {
  const supplierRaw = report.supplierRaw;
  const customerDeliverability = report.customerDeliverability;

  console.log('Product registration golden corpus');
  console.log(`- supplier raw fixtures: ${supplierRaw.passed}/${supplierRaw.total} passing`);
  console.log(`- field pass: ${pct(supplierRaw.passRate)}`);
  console.log(`- deterministic LLM skip: ${pct(supplierRaw.deterministicSkipRate)}`);
  console.log(`- duplicate second-pass skip: ${pct(supplierRaw.duplicateSecondPassSkipRate)}`);
  console.log(`- section reduce-ready: ${pct(supplierRaw.sectionReduceReadyRate)}`);
  console.log(`- reusable section chars: ${supplierRaw.sectionReusableChars.toLocaleString('ko-KR')}`);
  console.log(`- scenario coverage: ${pct(supplierRaw.scenarioCoverageRate)}`);
  if (supplierRaw.missingRequiredScenarios.length > 0) {
    console.log(`- missing scenarios: ${supplierRaw.missingRequiredScenarios.join(', ')}`);
  }
  console.log(`- customer deliverability corpus: ${customerDeliverability.passed}/${customerDeliverability.total} passing`);
  console.log(`- price rows zero: ${customerDeliverability.priceRowsZeroCount}`);
  console.log(`- price dates zero: ${customerDeliverability.priceDatesZeroCount}`);
  console.log(`- destination UNK: ${customerDeliverability.destinationUnkCount}`);
  console.log(`- optional-tour price pollution: ${customerDeliverability.optionalTourPricePollutionCount}`);
  console.log(`- deliverability blocked: ${customerDeliverability.deliverabilityBlockedCount}`);
  console.log(`- price storage mismatch: ${customerDeliverability.priceStorageMismatchCount}`);
  console.log(`- render blocked: ${customerDeliverability.renderBlockedCount}`);

  const failed = supplierRaw.fixtures.filter(fixture => !fixture.passed);
  if (failed.length > 0) {
    console.log('');
    console.log('Supplier raw failures');
    for (const fixture of failed) {
      console.log(`- ${fixture.id}: ${fixture.failures.join(', ')}`);
    }
  }

  const customerFailed = customerDeliverability.cases.filter(testCase => !testCase.ok);
  if (customerFailed.length > 0) {
    console.log('');
    console.log('Customer deliverability failures');
    for (const testCase of customerFailed) {
      console.log(`- ${testCase.id}: ${testCase.failures.join(', ')}`);
    }
  }
}

function failedThresholds(
  report: EvalReport,
  options: CliOptions,
): string[] {
  const failures: string[] = [];
  const supplierRaw = report.supplierRaw;
  const customerDeliverability = report.customerDeliverability;
  if (supplierRaw.passRate < options.minPassRate) failures.push(`passRate ${supplierRaw.passRate} < ${options.minPassRate}`);
  if (supplierRaw.deterministicSkipRate < options.minLlmSkipRate) failures.push(`deterministicSkipRate ${supplierRaw.deterministicSkipRate} < ${options.minLlmSkipRate}`);
  if (supplierRaw.duplicateSecondPassSkipRate < options.minDuplicateSkipRate) failures.push(`duplicateSecondPassSkipRate ${supplierRaw.duplicateSecondPassSkipRate} < ${options.minDuplicateSkipRate}`);
  if (supplierRaw.sectionReduceReadyRate < options.minSectionReadyRate) failures.push(`sectionReduceReadyRate ${supplierRaw.sectionReduceReadyRate} < ${options.minSectionReadyRate}`);
  if (supplierRaw.scenarioCoverageRate < options.minScenarioCoverageRate) failures.push(`scenarioCoverageRate ${supplierRaw.scenarioCoverageRate} < ${options.minScenarioCoverageRate}`);
  if (customerDeliverability.failed > 0) failures.push(`customerDeliverability.failed ${customerDeliverability.failed} > 0`);
  if (customerDeliverability.priceRowsZeroCount > 0) failures.push(`priceRowsZeroCount ${customerDeliverability.priceRowsZeroCount} > 0`);
  if (customerDeliverability.priceDatesZeroCount > 0) failures.push(`priceDatesZeroCount ${customerDeliverability.priceDatesZeroCount} > 0`);
  if (customerDeliverability.destinationUnkCount > 0) failures.push(`destinationUnkCount ${customerDeliverability.destinationUnkCount} > 0`);
  if (customerDeliverability.optionalTourPricePollutionCount > 0) failures.push(`optionalTourPricePollutionCount ${customerDeliverability.optionalTourPricePollutionCount} > 0`);
  if (customerDeliverability.deliverabilityBlockedCount > 0) failures.push(`deliverabilityBlockedCount ${customerDeliverability.deliverabilityBlockedCount} > 0`);
  if (customerDeliverability.priceStorageMismatchCount > 0) failures.push(`priceStorageMismatchCount ${customerDeliverability.priceStorageMismatchCount} > 0`);
  if (customerDeliverability.renderBlockedCount > 0) failures.push(`renderBlockedCount ${customerDeliverability.renderBlockedCount} > 0`);
  return failures;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const report: EvalReport = {
    supplierRaw: evaluateProductRegistrationCorpus(),
    customerDeliverability: await evaluateGoldenCorpus(),
  };

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
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
