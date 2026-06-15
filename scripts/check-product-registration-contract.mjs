#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';

const strict = process.argv.includes('--strict');

const required = [
  {
    file: 'docs/product-registration-current-ssot.md',
    checks: [
      {
        label: 'truth status section',
        pattern: /Implementation Truth Status/i,
      },
      {
        label: 'micro QA limitation is explicit',
        pattern: /records the four phases but does not re-run the entire parser three times/i,
      },
      {
        label: 'structured failure code rule',
        pattern: /structured failure diagnostics/i,
      },
      {
        label: 'failure-to-fixture candidate rule',
        pattern: /upload_review_queue.*fixture candidate/i,
      },
    ],
  },
  {
    file: 'docs/ai-agent-doc-automation.md',
    checks: [
      {
        label: 'failed sample to fixture rule',
        pattern: /Every previous failure becomes a reproducible dataset item when feasible/i,
      },
      {
        label: 'documents cannot be the only fix',
        pattern: /Never make the document the only fix/i,
      },
    ],
  },
  {
    file: 'docs/product-mobile-landing-quality-runbook.md',
    checks: [
      {
        label: 'actual mobile page proof requirement',
        pattern: /A product is not customer-ready until the actual mobile page is checked/i,
      },
      {
        label: 'source to mobile and A4 chain',
        pattern: /supplier raw source[\s\S]*\/packages\/\{id\} mobile customer render[\s\S]*A4 render contract/i,
      },
    ],
  },
  {
    file: 'src/lib/product-registration/failure-diagnostics.ts',
    checks: [
      {
        label: 'price date disagreement code',
        pattern: /PRICE_DATE_DISAGREEMENT/,
      },
      {
        label: 'flight mismatch code',
        pattern: /FLIGHT_TIME_MISMATCH/,
      },
      {
        label: 'classifier export',
        pattern: /export function classifyProductRegistrationFailure/,
      },
    ],
  },
  {
    file: 'src/lib/product-registration/upload-review-queue.ts',
    checks: [
      {
        label: 'review queue persists diagnostics',
        pattern: /_product_registration_failure_diagnostics/,
      },
    ],
  },
  {
    file: 'src/lib/product-registration/upload-response.ts',
    checks: [
      {
        label: 'upload response exposes diagnostics',
        pattern: /failureDiagnostics/,
      },
    ],
  },
  {
    file: 'src/lib/product-registration/review-queue-fixture-candidates.ts',
    checks: [
      {
        label: 'review queue fixture candidate builder',
        pattern: /buildUploadReviewFixtureCandidateReport/,
      },
    ],
  },
  {
    file: 'scripts/export-upload-review-fixture-candidates.ts',
    checks: [
      {
        label: 'fixture candidate export script',
        pattern: /upload_review_queue/,
      },
    ],
  },
  {
    file: 'src/lib/product-registration/auto-qa.ts',
    checks: [
      {
        label: 'micro QA capped at three repair attempts',
        pattern: /Math\.min\(3,\s*input\.maxAttempts \?\? 3\)/,
      },
    ],
  },
];

const failures = [];

for (const item of required) {
  if (!fs.existsSync(item.file)) {
    failures.push(`${item.file}: missing file`);
    continue;
  }
  const content = fs.readFileSync(item.file, 'utf8');
  for (const check of item.checks) {
    if (!check.pattern.test(content)) {
      failures.push(`${item.file}: missing ${check.label}`);
    }
  }
}

if (failures.length > 0) {
  console.error('[product-registration-contract] failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(strict ? 1 : 0);
}

console.log('[product-registration-contract] passed');
