#!/usr/bin/env tsx

import { evaluateJarvisGoldenSet } from '../src/lib/jarvis/eval/offline-evaluator';
import { evaluateRagGoldenSet } from '../src/lib/jarvis/eval/rag-evaluator';
import { TRACE_GOLDEN_CASES } from '../src/lib/jarvis/eval/trace-golden-cases';
import { gradeJarvisTraceSet } from '../src/lib/jarvis/eval/trace-grader';

type CliOptions = {
  json: boolean;
  strict: boolean;
  minPassRate: number;
};

function readNumberArg(args: string[], name: string, fallback: number): number {
  const prefix = `${name}=`;
  const raw = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parseCliOptions(args: string[]): CliOptions {
  return {
    json: args.includes('--json'),
    strict: args.includes('--strict'),
    minPassRate: readNumberArg(args, '--min-pass-rate', 1),
  };
}

const options = parseCliOptions(process.argv.slice(2));
const summary = evaluateJarvisGoldenSet();
const ragSummary = evaluateRagGoldenSet();
const traceSummary = gradeJarvisTraceSet(TRACE_GOLDEN_CASES);
const requiredPassRate = options.strict ? 1 : options.minPassRate;
const ok = (
  summary.passRate >= requiredPassRate &&
  ragSummary.passRate >= requiredPassRate &&
  traceSummary.passRate >= requiredPassRate
);

if (options.json) {
  console.log(JSON.stringify({ ok, requiredPassRate, deterministic: summary, rag: ragSummary, trace: traceSummary }, null, 2));
} else {
  console.log(`Jarvis golden-set: ${summary.passed}/${summary.total} passed (${Math.round(summary.passRate * 100)}%)`);
  for (const result of summary.results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(`- ${status} ${result.id} [${result.category}] ${result.description}`);
    for (const check of result.checks) {
      if (check.passed) continue;
      console.log(`  - ${check.name}: expected=${JSON.stringify(check.expected)} actual=${JSON.stringify(check.actual)}`);
    }
  }

  console.log(`Jarvis RAG golden-set: ${ragSummary.passed}/${ragSummary.total} passed (${Math.round(ragSummary.passRate * 100)}%)`);
  console.log(
    `RAG averages: recall=${ragSummary.average.contextRecall.toFixed(2)}, ` +
    `relevancy=${ragSummary.average.answerRelevancy.toFixed(2)}, ` +
    `faithfulness=${ragSummary.average.faithfulness.toFixed(2)}, ` +
    `citation=${ragSummary.average.citationCoverage.toFixed(2)}`,
  );
  for (const result of ragSummary.results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(`- ${status} ${result.id} ${result.description}`);
    if (result.passed) continue;
    console.log(`  - missingExpectedFacts=${JSON.stringify(result.missingExpectedFacts)}`);
    console.log(`  - missingAnswerFacts=${JSON.stringify(result.missingAnswerFacts)}`);
    console.log(`  - unsupportedClaims=${JSON.stringify(result.unsupportedClaims)}`);
    console.log(`  - missingCitations=${JSON.stringify(result.missingCitations)}`);
  }

  console.log(`Jarvis trace golden-set: ${traceSummary.passed}/${traceSummary.total} passed (${Math.round(traceSummary.passRate * 100)}%), avgScore=${traceSummary.averageScore.toFixed(1)}`);
  for (const result of traceSummary.results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(`- ${status} ${result.traceId} score=${result.score}`);
    for (const check of result.checks) {
      if (check.passed) continue;
      console.log(`  - ${check.severity} ${check.name}: ${check.message}`);
    }
  }
}

if (!ok) {
  process.exitCode = 1;
}
