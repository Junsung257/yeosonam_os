import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { GOLDEN_PASTE_E2E_CASES } from '../src/lib/product-registration/golden-corpus/paste-e2e-cases';

const outputDir = join(process.cwd(), 'data', 'product-registration', 'golden-paste-e2e');
mkdirSync(outputDir, { recursive: true });

const byKind = Object.fromEntries(
  GOLDEN_PASTE_E2E_CASES.map(testCase => [testCase.kind, 1]),
);

const report = {
  generated_at: new Date().toISOString(),
  corpus_version: 'golden-paste-e2e-v1',
  total_cases: GOLDEN_PASTE_E2E_CASES.length,
  by_kind: byKind,
  metrics_to_track: {
    auto_save_success_rate: null,
    auto_customer_open_candidate_rate: null,
    review_queue_rate: null,
    missing_price_provenance_rate: null,
    inbound_next_day_success_rate: null,
    lp_stale_block_rate: null,
    option_price_misclassification_rate: null,
  },
  cases: GOLDEN_PASTE_E2E_CASES.map(testCase => ({
    id: testCase.id,
    kind: testCase.kind,
    expected: testCase.expected,
  })),
};

const outPath = join(outputDir, `golden-paste-e2e-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Golden paste E2E corpus: ${report.total_cases} cases`);
console.log(`Report: ${outPath}`);
