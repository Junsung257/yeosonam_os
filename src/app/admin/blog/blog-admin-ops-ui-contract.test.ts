import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('blog admin ops UI contract', () => {
  it('surfaces split blog health sections on the system page', () => {
    const source = readSource('src/app/admin/blog/system/page.tsx');

    expect(source).toContain('ops.health_sections');
    expect(source).toContain('운영 건강도 분해');
    expect(source).toContain('ops.queue.failure_groups');
    expect(source).toContain('ops.quality?.failure_buckets');
    expect(source).toContain('ops.indexing.failure_buckets');
    expect(source).toContain('발행·색인 연결');
    expect(source).toContain('ops.indexing.outbox_coverage');
    expect(source).toContain('indexingBridgeLevel');
  });

  it('shows recent quality status in the sticky blog ops strip', () => {
    const source = readSource('src/app/admin/blog/BlogOpsStatusStrip.tsx');

    expect(source).toContain('ops.health_sections?.quality?.level');
    expect(source).toContain('ops.quality?.non_slug_failures');
    expect(source).toContain('품질 정상');
  });
});
