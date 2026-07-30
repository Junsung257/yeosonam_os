import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { GOLDEN_PASTE_E2E_CASES } from '../src/lib/product-registration/golden-corpus/paste-e2e-cases';
import { evaluateGoldenPasteE2E } from '../src/lib/product-registration/golden-corpus/paste-e2e-evaluator';

async function main(): Promise<void> {
  const outputDir = join(process.cwd(), 'data', 'product-registration', 'golden-paste-e2e');
  mkdirSync(outputDir, { recursive: true });

  const byKind = Object.fromEntries(
    GOLDEN_PASTE_E2E_CASES.map(testCase => [testCase.kind, 1]),
  );

  const strict = process.argv.includes('--strict');
  const evaluation = await evaluateGoldenPasteE2E(0.95);
  const report = { ...evaluation, by_kind: byKind };

  const outPath = join(outputDir, `golden-paste-e2e-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Golden paste E2E corpus: ${report.total_cases} cases`);
  console.log(`Raw-only field accuracy: ${(report.metrics.field_accuracy_rate * 100).toFixed(1)}%`);
  console.log(`Registration success: ${(report.metrics.registration_success_rate * 100).toFixed(1)}%`);
  console.log(`Incomplete-source safety block: ${(report.metrics.incomplete_source_block_rate * 100).toFixed(1)}%`);
  console.log(`Option-price misclassification: ${(report.metrics.option_price_misclassification_rate * 100).toFixed(1)}%`);
  console.log(`Report: ${outPath}`);
  if (strict && !report.passed) process.exitCode = 1;
}

void main();
