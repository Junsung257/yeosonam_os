import fs from 'node:fs';
import path from 'node:path';

const datasetPath = process.argv[2] || path.join(process.cwd(), 'tests/evals/concierge-set.jsonl');
const threshold = Number(process.env.CONCIERGE_EVAL_THRESHOLD ?? '0.95');

if (!fs.existsSync(datasetPath)) {
  console.error(`[eval-concierge] dataset not found: ${datasetPath}`);
  process.exit(1);
}

const lines = fs
  .readFileSync(datasetPath, 'utf8')
  .split('\n')
  .map((v) => v.trim())
  .filter(Boolean);

let passed = 0;
const details = [];

for (const line of lines) {
  const row = JSON.parse(line);
  const answer = String(row.candidate_answer ?? '');
  const expected = Array.isArray(row.expected_keywords) ? row.expected_keywords : [];
  const forbidden = Array.isArray(row.forbidden_keywords) ? row.forbidden_keywords : [];

  const expectedOk = expected.every((kw) => answer.includes(kw));
  const forbiddenOk = forbidden.every((kw) => !answer.includes(kw));
  const ok = expectedOk && forbiddenOk;
  if (ok) passed += 1;

  details.push({
    id: row.id,
    ok,
    expectedOk,
    forbiddenOk,
  });
}

const total = lines.length || 1;
const score = passed / total;
const report = {
  total,
  passed,
  score,
  threshold,
  details,
  generatedAt: new Date().toISOString(),
};

const outPath = path.join(process.cwd(), 'tests/evals/concierge-eval-report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log('[eval-concierge] total=', total);
console.log('[eval-concierge] passed=', passed);
console.log('[eval-concierge] score=', score.toFixed(4));
console.log('[eval-concierge] threshold=', threshold.toFixed(4));
console.log('[eval-concierge] report=', outPath);

if (score < threshold) {
  console.error('[eval-concierge] FAIL: score below threshold');
  process.exit(2);
}

console.log('[eval-concierge] PASS');
