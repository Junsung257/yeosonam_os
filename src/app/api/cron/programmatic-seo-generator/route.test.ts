import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('programmatic SEO compatibility endpoint', () => {
  it('delegates all queue creation to the demand and evidence gated service', () => {
    const source = readFileSync(join(
      process.cwd(),
      'src/app/api/cron/programmatic-seo-generator/route.ts',
    ), 'utf8');

    expect(source).toContain('promotePendingTopics({');
    expect(source).not.toContain("llmCall<");
    expect(source).not.toContain(".from('blog_topic_queue').insert");
  });
});
