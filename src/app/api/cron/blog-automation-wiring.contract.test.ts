import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Blog V4 autonomous cron wiring', () => {
  it('schedules queue refill, generation, publication, and independent indexing', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    const crons = new Map((config.crons ?? []).map((cron) => [cron.path, cron.schedule]));

    expect(crons.get('/api/cron/blog-scheduler')).toBe('0 15 * * *');
    expect(crons.get('/api/cron/blog-generate')).toBe('5,15,25,35,45,55 16-21 * * *');
    expect(crons.get('/api/cron/blog-publication-controller')).toBe('0,30 0-13 * * *');
    expect(crons.get('/api/cron/blog-indexing-worker')).toBe('*/5 * * * *');
  });
});
