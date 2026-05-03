import { describe, it, expect, afterEach } from 'vitest';
import { getVercelOpsProjectBaseUrl, VERCEL_OPS_DEFAULT_PROJECT_SLUG, VERCEL_OPS_DEFAULT_TEAM_SLUG } from './vercel-ops-defaults';

describe('getVercelOpsProjectBaseUrl', () => {
  const origTeam = process.env.VERCEL_OPS_TEAM_SLUG;
  const origProject = process.env.VERCEL_OPS_PROJECT_SLUG;

  afterEach(() => {
    if (origTeam === undefined) delete process.env.VERCEL_OPS_TEAM_SLUG;
    else process.env.VERCEL_OPS_TEAM_SLUG = origTeam;
    if (origProject === undefined) delete process.env.VERCEL_OPS_PROJECT_SLUG;
    else process.env.VERCEL_OPS_PROJECT_SLUG = origProject;
  });

  it('uses defaults when env unset', () => {
    delete process.env.VERCEL_OPS_TEAM_SLUG;
    delete process.env.VERCEL_OPS_PROJECT_SLUG;
    expect(getVercelOpsProjectBaseUrl()).toBe(
      `https://vercel.com/${VERCEL_OPS_DEFAULT_TEAM_SLUG}/${VERCEL_OPS_DEFAULT_PROJECT_SLUG}`,
    );
  });

  it('respects overrides', () => {
    process.env.VERCEL_OPS_TEAM_SLUG = 'my-team';
    process.env.VERCEL_OPS_PROJECT_SLUG = 'my-app';
    expect(getVercelOpsProjectBaseUrl()).toBe('https://vercel.com/my-team/my-app');
  });
});
