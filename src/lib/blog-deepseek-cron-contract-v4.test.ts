import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  crons: Array<{ path: string; schedule: string }>;
};
const generationRoute = readFileSync('src/app/api/cron/blog-generate/route.ts', 'utf8');
const externalWorkflow = readFileSync('.github/workflows/blog-external-cron.yml', 'utf8');

describe('blog DeepSeek V4 cron contract', () => {
  it('generates in the KST overnight off-peak window', () => {
    expect(config.crons).toContainEqual({
      path: '/api/cron/blog-generate', schedule: '5 16,17,18,19,20,21 * * *',
    });
    expect(generationRoute).toContain('isBlogGenerationWindowKstV4');
    expect(generationRoute).toContain("forceValue === '1' || forceValue === 'true'");
    expect(generationRoute).toContain('BLOG_GENERATION_CRON_ENABLED');
    expect(generationRoute).toContain("reason: 'blog_generation_cron_paused'");
    expect(externalWorkflow).toContain('if [ "$endpoint" != "blog-generate" ]; then');
  });

  it('publishes without a model at five KST daytime slots', () => {
    expect(config.crons).toContainEqual({
      path: '/api/cron/blog-publication-controller', schedule: '5 0,3,6,9,12 * * *',
    });
    expect(config.crons.some((cron) => cron.path === '/api/cron/blog-publisher')).toBe(false);
  });

  it('stays below the Vercel cron-count ceiling', () => {
    expect(config.crons.length).toBeLessThanOrEqual(100);
  });
});
