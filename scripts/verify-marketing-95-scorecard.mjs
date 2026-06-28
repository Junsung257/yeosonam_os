#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const tsxCli = path.join(cwd, 'node_modules', 'tsx', 'dist', 'cli.mjs');

if (!existsSync(tsxCli)) {
  console.error('tsx is not installed. Run npm install before verifying the marketing scorecard.');
  process.exit(1);
}

const inline = String.raw`
import {
  MARKETING_DEEP_SCORE_TARGET,
  MARKETING_DEEP_SOURCE_TARGET,
  MARKETING_SOURCE_LEDGER_REVIEWS,
  buildMarketingDeepScorecard,
} from './src/lib/marketing-deep-scorecard.ts';

const args = new Set(process.argv.slice(1));
const strictCurrent = args.has('--strict-current');
const json = args.has('--json');
const scorecard = buildMarketingDeepScorecard({
  summary: {},
  sourceLedgerCount: 0,
  generatedAt: '2026-06-28T00:00:00.000Z',
});
const subcategories = scorecard.domains.flatMap((domain) => domain.subcategories);
const failures = [];
const urls = new Set(MARKETING_SOURCE_LEDGER_REVIEWS.map((source) => source.source_url));

if (scorecard.domains.length < 15) failures.push('expected at least 15 marketing domains');
if (subcategories.length < 70) failures.push('expected at least 70 marketing subcategories');
if (MARKETING_SOURCE_LEDGER_REVIEWS.length < MARKETING_DEEP_SOURCE_TARGET) failures.push('expected at least 100 source review seeds');
if (urls.size !== MARKETING_SOURCE_LEDGER_REVIEWS.length) failures.push('source review URLs must be unique');
if (subcategories.some((item) => item.target_score < MARKETING_DEEP_SCORE_TARGET)) failures.push('all target scores must be 95+');
if (subcategories.some((item) => item.post_repair_score < MARKETING_DEEP_SCORE_TARGET)) failures.push('all post-repair scores must be 95+');
if (subcategories.some((item) => item.score < MARKETING_DEEP_SCORE_TARGET && item.repair_action.length < 10)) failures.push('every gap needs a concrete repair action');
if (scorecard.repair_queue.some((item) => item.safety.external_api_write !== false || item.safety.live_spend_krw !== 0)) failures.push('repair queue must not allow external writes or live spend');
if (scorecard.safety.external_api_write !== false || scorecard.safety.live_spend_krw !== 0 || scorecard.safety.full_auto_allowed !== false) failures.push('scorecard safety flags must block external writes, live spend, and full auto');
if (strictCurrent && subcategories.some((item) => item.score < MARKETING_DEEP_SCORE_TARGET)) failures.push('--strict-current failed: at least one current score is below 95');

const result = {
  ok: failures.length === 0,
  failures,
  domains: scorecard.domains.length,
  subcategories: subcategories.length,
  source_reviews: MARKETING_SOURCE_LEDGER_REVIEWS.length,
  target_score: MARKETING_DEEP_SCORE_TARGET,
  current_lowest_score: scorecard.score_gate.lowest_score,
  current_gap_subcategories: scorecard.summary.gap_subcategories,
  strict_current: strictCurrent,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(
    [
      'Marketing 95 scorecard verification',
      'ok=' + result.ok,
      'domains=' + result.domains,
      'subcategories=' + result.subcategories,
      'source_reviews=' + result.source_reviews,
      'target_score=' + result.target_score,
      'current_lowest_score=' + result.current_lowest_score,
      'current_gap_subcategories=' + result.current_gap_subcategories,
      ...failures.map((failure) => 'FAIL ' + failure),
    ].join('\n'),
  );
}

process.exit(failures.length === 0 ? 0 : 1);
`;

const child = spawnSync(process.execPath, [tsxCli, '-e', inline, '--', ...process.argv.slice(2)], {
  cwd,
  stdio: 'inherit',
});

if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}

process.exit(child.status ?? 1);
