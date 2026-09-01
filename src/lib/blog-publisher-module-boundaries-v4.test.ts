import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Blog publisher V4 module boundaries', () => {
  it('delegates brief, corpus, research, quality, preview, and publication responsibilities', () => {
    const route = readFileSync('src/app/api/cron/blog-publisher/route.ts', 'utf8');
    for (const dependency of [
      '@/lib/blog-publisher-brief-v4',
      '@/lib/blog-corpus-diversity-repository-v4',
      '@/lib/blog-auto-research',
      '@/lib/blog-generation-run-v4',
      '@/lib/blog-indexing-outbox',
    ]) expect(route).toContain(dependency);
    const workflowServices = readFileSync('src/lib/blog-autopilot-stage-services-v4.ts', 'utf8');
    expect(workflowServices).toContain("from '@/lib/blog-browser-preview-v4'");
    expect(route).not.toContain('async function loadBlogCorpusDiversityV3');
    expect(route).not.toContain('function buildQueueContentBrief(item');
  });
});
