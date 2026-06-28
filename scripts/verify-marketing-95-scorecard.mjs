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
  buildMarketingReadyFixtureSummary,
  buildMarketingDeepScorecard,
} from './src/lib/marketing-deep-scorecard.ts';

const args = new Set(JSON.parse(process.env.MARKETING_SCORECARD_ARGS || '[]'));
const strictCurrent = args.has('--strict-current');
const json = args.has('--json');
const readyFixture = args.has('--ready-fixture');
const scorecard = buildMarketingDeepScorecard({
  summary: readyFixture ? buildMarketingReadyFixtureSummary() : {},
  sourceLedgerCount: readyFixture ? MARKETING_DEEP_SOURCE_TARGET : 0,
  generatedAt: '2026-06-28T00:00:00.000Z',
});
const subcategories = scorecard.domains.flatMap((domain) => domain.subcategories);
const p0RepairQueue = scorecard.repair_queue.filter((item) => item.priority === 'P0');
const failures = [];
const urls = new Set(MARKETING_SOURCE_LEDGER_REVIEWS.map((source) => source.source_url));

if (scorecard.domains.length < 15) failures.push('expected at least 15 marketing domains');
if (subcategories.length < 70) failures.push('expected at least 70 marketing subcategories');
if (MARKETING_SOURCE_LEDGER_REVIEWS.length < MARKETING_DEEP_SOURCE_TARGET) failures.push('expected at least 100 source review seeds');
if (urls.size !== MARKETING_SOURCE_LEDGER_REVIEWS.length) failures.push('source review URLs must be unique');
if (subcategories.some((item) => item.target_score < MARKETING_DEEP_SCORE_TARGET)) failures.push('all target scores must be 95+');
if (subcategories.some((item) => item.post_repair_score < MARKETING_DEEP_SCORE_TARGET)) failures.push('all post-repair scores must be 95+');
if (subcategories.some((item) => item.score < MARKETING_DEEP_SCORE_TARGET && item.repair_action.length < 10)) failures.push('every gap needs a concrete repair action');
if (p0RepairQueue.length !== scorecard.summary.p0_gaps) failures.push('P0 repair queue count must match P0 gap count');
if (scorecard.summary.p0_gaps > 0 && scorecard.repair_queue[0]?.priority !== 'P0') failures.push('repair queue must put P0 gaps first');
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
  p0_gap_subcategories: scorecard.summary.p0_gaps,
  top_repair_focus: scorecard.repair_queue.slice(0, 3).map((item) => ({
    title: item.title,
    priority: item.priority,
    owner: item.owner,
    automation_phase: item.automation_phase,
    approval_required: item.approval_required,
  })),
  strict_current: strictCurrent,
  ready_fixture: readyFixture,
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
      'p0_gap_subcategories=' + result.p0_gap_subcategories,
      ...result.top_repair_focus.map((item, index) =>
        'top_repair_' + (index + 1) + '=' + item.priority + ' ' + item.title,
      ),
      'ready_fixture=' + result.ready_fixture,
      ...failures.map((failure) => 'FAIL ' + failure),
    ].join('\n'),
  );
}

process.exit(failures.length === 0 ? 0 : 1);
`;

const child = spawnSync(process.execPath, [tsxCli, '-e', inline], {
  cwd,
  env: {
    ...process.env,
    MARKETING_SCORECARD_ARGS: JSON.stringify(process.argv.slice(2)),
  },
  stdio: 'inherit',
});

if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}

process.exit(child.status ?? 1);
