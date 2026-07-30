import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Threads full autopilot wiring', () => {
  it('wires the expected Vercel schedules', () => {
    const vercel = JSON.parse(
      readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'),
    ) as { crons?: Array<{ path: string; schedule: string }> };
    const schedules = new Map(
      (vercel.crons ?? []).map((cron) => [cron.path, cron.schedule]),
    );

    expect(schedules.get('/api/cron/threads-content-autopilot')).toBe('5 22 * * *');
    expect(schedules.get('/api/cron/threads-engagement')).toBe('*/5 * * * *');
    expect(schedules.get('/api/cron/auto-publish-loop')).toBe('0 */2 * * *');
    expect(schedules.get('/api/cron/publish-scheduled')).toBe('*/15 * * * *');
    expect(schedules.get('/api/cron/sync-engagement')).toBe('*/30 * * * *');
  });

  it('keeps cron and readiness routes behind their guards', () => {
    const cronSource = readFileSync(
      join(process.cwd(), 'src/app/api/cron/threads-engagement/route.ts'),
      'utf8',
    );
    const contentCronSource = readFileSync(
      join(process.cwd(), 'src/app/api/cron/threads-content-autopilot/route.ts'),
      'utf8',
    );
    const readinessSource = readFileSync(
      join(
        process.cwd(),
        'src/app/api/admin/marketing/threads-autopilot-readiness/route.ts',
      ),
      'utf8',
    );

    expect(cronSource).toContain('isCronAuthorized(request)');
    expect(contentCronSource).toContain('isCronAuthorized(request)');
    expect(readinessSource).toContain('requireAdminRequest(request)');
  });

  it('requires full scopes and claims external publish work before mutation', () => {
    const readinessSource = readFileSync(
      join(
        process.cwd(),
        'src/app/api/admin/marketing/threads-autopilot-readiness/route.ts',
      ),
      'utf8',
    );
    const publishLoopSource = readFileSync(
      join(process.cwd(), 'src/app/api/cron/auto-publish-loop/route.ts'),
      'utf8',
    );
    const contentSource = readFileSync(
      join(process.cwd(), 'src/lib/threads-content-autopilot.ts'),
      'utf8',
    );

    expect(readinessSource).toContain('missing_full_automation_scope:');
    expect(publishLoopSource).toContain(
      "status.eq.approved,generation_agent.eq.threads-full-autopilot-v1",
    );
    expect(publishLoopSource).toContain(
      ".update({ status: 'scheduled', scheduled_for: claimUntil })",
    );
    expect(contentSource).toContain('threads_content_autopilot:');
    expect(contentSource).toContain("action_type: GENERATION_ACTION_TYPE");
  });

  it('does not let handled replies starve the backlog and routes blocked output to review', () => {
    const runnerSource = readFileSync(
      join(process.cwd(), 'src/lib/threads-engagement/runner.ts'),
      'utf8',
    );

    expect(runnerSource).toContain('for (const item of uniqueInbox)');
    expect(runnerSource).not.toContain('uniqueInbox.slice(');
    expect(runnerSource).toContain('actionType: REVIEW_ACTION_TYPE');
  });
});
