import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Inngest blog autopilot V4 contract', () => {
  it('uses a stable event id, a three-retry ceiling, and per-queue concurrency', () => {
    const dispatcher = source('src/app/api/cron/blog-generate/route.ts');
    const workflow = source('src/inngest/functions/blog-autopilot-v4.ts');
    expect(dispatcher).toContain('createBlogPipelineEventId');
    expect(dispatcher).toContain('contentVersion');
    expect(workflow).toContain('retries: 3');
    expect(workflow).toContain("idempotency: 'event.id'");
    expect(workflow).toContain("key: 'event.data.queueId'");
  });

  it('keeps deterministic browser failure terminal instead of retrying it', () => {
    const workflow = source('src/inngest/functions/blog-autopilot-v4.ts');
    expect(workflow).toContain('if (!preview.passed)');
    expect(workflow).toContain('publicationDispatched: false');
    expect(workflow).not.toContain("throw new Error('blog_browser_preview_gate_not_passed')");
  });
});
