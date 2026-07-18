import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function selectedColumnLists(source: string): string[] {
  return [...source.matchAll(/\.select\('([^']+)'\)/g)].map((match) => match[1] ?? '');
}

describe('blog queue lifecycle schema contract', () => {
  it('does not query the removed blog_topic_queue.slug_hint column in recovery paths', () => {
    const lifecycleSource = readFileSync(join(process.cwd(), 'src/lib/blog-queue-lifecycle.ts'), 'utf8');
    const editorialRecheckSource = readFileSync(join(process.cwd(), 'scripts/recheck-blog-editorial-backlog.ts'), 'utf8');
    const lifecycleSelects = selectedColumnLists(lifecycleSource);
    const editorialSelects = selectedColumnLists(editorialRecheckSource);

    expect(lifecycleSelects.some((columns) => /\bslug_hint\b/.test(columns))).toBe(false);
    expect(editorialSelects.some((columns) => /\bslug_hint\b/.test(columns))).toBe(false);
  });
});
