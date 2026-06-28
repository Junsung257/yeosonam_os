#!/usr/bin/env tsx

import { evaluateFreeTravel100Scenarios } from '../src/lib/free-travel/eval/scenario-evaluator';

type CliOptions = {
  json: boolean;
  strict: boolean;
};

function parseCliOptions(args: string[]): CliOptions {
  return {
    json: args.includes('--json'),
    strict: args.includes('--strict'),
  };
}

function printText(payload: ReturnType<typeof evaluateFreeTravel100Scenarios>): void {
  console.log(
    `Free-travel 100 scenarios: ${payload.status.toUpperCase()} ` +
    `${payload.score}/100 (${payload.passed}/${payload.total} scenarios, P0 ${payload.p0Passed}/${payload.p0Total})`,
  );

  for (const section of payload.sectionScores) {
    console.log(`- ${section.category}: ${section.score}/100 (${section.passed}/${section.total})`);
  }

  for (const result of payload.results.filter((item) => !item.passed).slice(0, 10)) {
    console.log(`- FAIL ${result.id} [${result.priority}] ${result.title}`);
    for (const check of result.checks.filter((item) => !item.passed)) {
      console.log(`  - ${check.name}: ${check.message}`);
    }
  }
}

const options = parseCliOptions(process.argv.slice(2));
const payload = evaluateFreeTravel100Scenarios();
const strictOk = payload.score === 100 && payload.p0Failures.length === 0;
const ok = options.strict ? strictOk : payload.ok;

if (options.json) {
  console.log(JSON.stringify({ ...payload, ok, strict: options.strict }, null, 2));
} else {
  printText(payload);
}

if (!ok) {
  process.exitCode = 1;
}
