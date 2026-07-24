import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog queue research source contract', () => {
  it('keeps the ready buffer scoped to candidates that still need a publish slot', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/blog-queue-research.ts'),
      'utf8',
    );
    const candidateQuery = source.slice(
      source.indexOf("from('blog_topic_queue')"),
      source.indexOf('if (error) throw new Error(`blog_queue_research_load:'),
    );

    expect(candidateQuery).toContain(".eq('status', 'queued')");
    expect(candidateQuery).toContain(".is('target_publish_at', null)");
  });
});
