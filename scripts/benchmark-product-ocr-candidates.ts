#!/usr/bin/env tsx

import { readFileSync } from 'node:fs';
import {
  buildDefaultOcrBenchmarkInput,
  runProductOcrBenchmark,
  type OcrBenchmarkInput,
} from '../src/lib/product-registration/ocr-benchmark';

type CliOptions = {
  inputPath: string | null;
  json: boolean;
  strict: boolean;
};

function parseCliOptions(args: string[]): CliOptions {
  const inputArg = args.find(arg => arg.startsWith('--input='));
  return {
    inputPath: inputArg ? inputArg.slice('--input='.length) : null,
    json: args.includes('--json'),
    strict: args.includes('--strict'),
  };
}

function readBenchmarkInput(path: string | null): OcrBenchmarkInput {
  if (!path) return buildDefaultOcrBenchmarkInput();
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as OcrBenchmarkInput;
  if (!Array.isArray(parsed.candidates)) {
    throw new Error('OCR benchmark input must contain candidates[]');
  }
  return parsed;
}

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const report = await runProductOcrBenchmark(readBenchmarkInput(options.inputPath));

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Product OCR/PDF candidate benchmark');
    console.log(`- candidates: ${report.passed}/${report.total} customer-ready`);
    console.log(`- table recognition proxy: ${pct(report.summary.tableRecognitionAccuracyAvg)}`);
    console.log(`- price rows preserved: ${report.summary.priceRowsPreserved}/${report.total}`);
    console.log(`- price dates preserved: ${report.summary.priceDatesPreserved}/${report.total}`);
    console.log(`- itinerary day rows preserved: ${report.summary.itineraryDayRowsPreserved}/${report.total}`);
    console.log(`- flight separated: ${report.summary.flightSeparated}/${report.total}`);
    console.log(`- hotel separated: ${report.summary.hotelSeparated}/${report.total}`);
    console.log(`- meal separated: ${report.summary.mealSeparated}/${report.total}`);
    console.log(`- evidence spans recoverable: ${report.summary.evidenceSpanRecoverable}/${report.total}`);
    console.log(`- final mobile/A4 customer outcome ready: ${report.summary.finalCustomerOutcomeReady}/${report.total}`);

    const failed = report.results.filter(result => !result.ok);
    if (failed.length > 0) {
      console.log('');
      console.log('Failures');
      for (const result of failed) {
        console.log(`- ${result.engine}/${result.caseId}: ${result.failures.join(', ')}`);
      }
    }
  }

  if (options.strict && report.failed > 0) {
    console.error(`OCR benchmark strict gate failed: ${report.failed} candidates are not customer-ready.`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
