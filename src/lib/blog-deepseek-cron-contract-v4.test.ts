import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  crons: Array<{ path: string; schedule: string }>;
};
const generationRoute = readFileSync('src/app/api/cron/blog-generate/route.ts', 'utf8');
const externalWorkflow = readFileSync('.github/workflows/blog-external-cron.yml', 'utf8');

describe('blog DeepSeek V4 cron contract', () => {
  it('replenishes durable workflows every ten minutes in the KST overnight off-peak window', () => {
    expect(config.crons).toContainEqual({
      path: '/api/cron/blog-generate', schedule: '5,15,25,35,45,55 16-21 * * *',
    });
    expect(generationRoute).toContain('isBlogGenerationWindowKstV4');
    expect(generationRoute).toContain("forceValue === '1' || forceValue === 'true'");
    expect(generationRoute).toContain('BLOG_GENERATION_CRON_ENABLED');
    expect(generationRoute).toContain("reason: 'blog_generation_cron_paused'");
    expect(externalWorkflow).toContain('if [ "$endpoint" != "blog-generate" ]; then');
  });

  it('runs a model-free publication controller while its ten KST slots enforce release quota', () => {
    expect(config.crons).toContainEqual({
      path: '/api/cron/blog-publication-controller', schedule: '0,30 0-13 * * *',
    });
    expect(config.crons.some((cron) => cron.path === '/api/cron/blog-publisher')).toBe(false);
  });

  it('does not schedule legacy blog producers alongside the durable factory', () => {
    for (const path of [
      '/api/cron/blog-scheduler',
      '/api/cron/blog-regenerate-zero-click',
      '/api/cron/trend-topic-miner',
      '/api/cron/programmatic-seo-generator',
      '/api/cron/blog-orchestrator',
    ]) {
      expect(config.crons.some((cron) => cron.path === path)).toBe(false);
    }
  });

  it('stays below the Vercel cron-count ceiling', () => {
    expect(config.crons.length).toBeLessThanOrEqual(100);
  });
});
