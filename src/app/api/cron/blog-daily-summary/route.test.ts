import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { getClosedKstDailySummaryRange } from '@/lib/blog-daily-summary-window';

describe('blog daily summary report day', () => {
  it('reports the previous KST day before the 22:45 close window', () => {
    const range = getClosedKstDailySummaryRange(new Date('2026-06-30T13:39:31.443Z'));

    expect(range.dayKey).toBe('2026-06-29');
    expect(range.usedPreviousDay).toBe(true);
    expect(range.closeMinuteKst).toBe(22 * 60 + 45);
  });

  it('reports the current KST day after the 22:45 close window', () => {
    const range = getClosedKstDailySummaryRange(new Date('2026-07-01T13:50:00.000Z'));

    expect(range.dayKey).toBe('2026-07-01');
    expect(range.usedPreviousDay).toBe(false);
  });

  it('keeps search visibility warnings out of cron failure errors', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/cron/blog-daily-summary/route.ts'), 'utf8');
    const searchIssueBlock = source.slice(
      source.indexOf('if (searchHealthIssues.length > 0)'),
      source.indexOf('for (const issue of opsWatcher.issues)'),
    );

    expect(searchIssueBlock).toContain("refType: 'blog_search_indexing'");
    expect(searchIssueBlock).not.toContain('errors.push(message)');
  });

  it('does not flag publisher cron observation when the selected report day already met quota', () => {
    const routeSource = readFileSync(join(process.cwd(), 'src/app/api/cron/blog-daily-summary/route.ts'), 'utf8');
    const diagnoseSource = readFileSync(join(process.cwd(), 'scripts/diagnose-blog-autopublish.ts'), 'utf8');

    expect(routeSource).toContain('summary.publisher_cron.ran_today === false && summary.under_daily_target');
    expect(diagnoseSource).toContain('!publisherRanToday && selectedDayUnderTarget');
  });

  it('escalates missed quota when publishable candidates were still available', () => {
    const routeSource = readFileSync(join(process.cwd(), 'src/app/api/cron/blog-daily-summary/route.ts'), 'utf8');

    expect(routeSource).toContain("code: 'catchup_publishable_candidates_available'");
    expect(routeSource).toContain('publishable_candidate_count');
    expect(routeSource).toContain('run blog-publisher until remainingAfterRun is 0');
  });

  it('keeps final publisher and indexing recovery slots before the daily close summary', () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/blog-external-cron.yml'), 'utf8');
    const workflowDoc = parse(workflow) as {
      on: { schedule: Array<{ cron: string }> };
      jobs: { trigger: { 'timeout-minutes': number; steps: Array<{ name?: string; run?: string }> } };
    };
    const selectStep = workflowDoc.jobs.trigger.steps.find(step => step.name === 'Select endpoint')?.run ?? '';
    const triggerStep = workflowDoc.jobs.trigger.steps.find(step => step.name === 'Trigger blog cron')?.run ?? '';
    const publisher = vercel.crons.find((cron) => cron.path === '/api/cron/blog-publisher');
    const summary = vercel.crons.find((cron) => cron.path === '/api/cron/blog-daily-summary');

    expect(workflowDoc.jobs.trigger['timeout-minutes']).toBe(45);
    expect(workflowDoc.on.schedule.map(item => item.cron)).toEqual([
      '10 21 * * *',
      '40 21 * * *',
      '50 23 * * *',
      '40 2 * * *',
      '10 3 * * *',
      '7 0,3,6,9,12,13 * * *',
      '27 0,3,6,9,12,13 * * *',
      '40 13 * * *',
      '50 12 * * *',
      '45 13 * * *',
    ]);
    expect((triggerStep.match(/node <<'NODE'/g) ?? []).length).toBe(3);
    expect((triggerStep.match(/^NODE$/gm) ?? []).length).toBe(3);
    expect(selectStep).toContain('"27 0,3,6,9,12,13 * * *"|"40 13 * * *")');
    expect(selectStep).toContain('endpoint="trend-topic-miner"');
    expect(publisher?.schedule).toBe('5 0,3,6,9,12,13 * * *');
    expect(summary?.schedule).toBe('45 13 * * *');
    expect(workflow).toContain("cron: '7 0,3,6,9,12,13 * * *'");
    expect(workflow).toContain("cron: '27 0,3,6,9,12,13 * * *'");
    expect(workflow).toContain("cron: '40 13 * * *'");
    expect(workflow).toContain('"27 0,3,6,9,12,13 * * *"|"40 13 * * *")');
    expect(workflow).toContain("cron: '45 13 * * *'");
    expect(workflow).toContain('MAX_PUBLISHER_ATTEMPTS: 4');
    expect(workflow).toContain('private_queue_id:');
    expect(selectStep).toContain('private_queue_id is allowed only with blog-publisher');
    expect(selectStep).toContain('private_queue_id must be a UUID');
    expect(selectStep).toContain('query="${query}&privateQueueId=${private_queue_id}"');
    expect(workflow).toContain('while [ "$attempt" -lt "${MAX_PUBLISHER_ATTEMPTS}" ]; do');
    expect(workflow).toContain('timeout-minutes: 45');
    expect(workflow).toContain('Running pre-summary publisher catch-up before daily summary.');
    expect(workflow).toContain('${BASE_URL}/api/cron/blog-publisher?force=true');
    expect(workflow).toContain('pre-summary-publisher-response.json');
    expect(workflow).toContain('pre_summary_publisher_hard_failed=0');
    expect(workflow).toContain('pre_summary_publisher_hard_failed=1');
    expect(workflow).toContain('indexing drain already ran');
    expect(workflow).toContain('__parse_error__');
    expect(workflow).toContain('Pre-summary publisher response JSON could not be parsed');
    expect(workflow).toContain('Pre-summary publisher underfilled the daily quota after retries');
    expect(workflow).toContain('Running pre-summary indexing drain before daily summary.');
    expect(workflow).toContain('${BASE_URL}/api/cron/blog-indexing-worker?force=true');
    expect(workflow).toContain('pre-summary-indexing-response.json');
    expect(workflow).toContain('Pre-summary indexing drain reported failures');
    expect(workflow).toContain("const failed = Number(data?.failed ?? 0);");
    expect(workflow).toContain('failed > 0 || errors.length > 0');
    expect(workflow.indexOf('Running pre-summary indexing drain before daily summary.')).toBeLessThan(
      workflow.indexOf('Pre-summary publisher underfilled the daily quota after retries'),
    );
    expect(13 * 60 + 40).toBeLessThan(13 * 60 + 45);
  });

  it('refreshes product blog proof well before scheduler and first publisher slots', () => {
    const proofRefreshWorkflow = readFileSync(
      join(process.cwd(), '.github/workflows/blog-mobile-proof-refresh.yml'),
      'utf8',
    );
    const externalCronWorkflow = readFileSync(
      join(process.cwd(), '.github/workflows/blog-external-cron.yml'),
      'utf8',
    );

    expect(proofRefreshWorkflow).toContain("cron: '30 22 * * *'");
    expect(externalCronWorkflow).toContain("cron: '50 23 * * *'");

    const proofRefreshMinuteUtc = 22 * 60 + 30;
    const schedulerMinuteUtc = 23 * 60 + 50;
    expect(schedulerMinuteUtc - proofRefreshMinuteUtc).toBeGreaterThanOrEqual(60);
  });

  it('records fleet-level phrase drift in the daily summary watcher', () => {
    const routeSource = readFileSync(join(process.cwd(), 'src/app/api/cron/blog-daily-summary/route.ts'), 'utf8');

    expect(routeSource).toContain('inspectBlogFleetPhraseDrift');
    expect(routeSource).toContain('fleet_phrase_drift: fleetPhraseDrift');
    expect(routeSource).toContain("code: 'fleet_phrase_drift'");
    expect(routeSource).toContain("summary.fleet_phrase_drift.status !== 'pass'");
    expect(routeSource).toContain('.slice(0, 100)');
  });
});
