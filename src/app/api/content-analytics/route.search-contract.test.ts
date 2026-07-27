import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function routeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/content-analytics/route.ts'), 'utf8');
}

describe('content analytics search contract', () => {
  it('enriches content analytics from Search Console rank history', () => {
    const source = routeSource();

    expect(source).toContain(".from('rank_history')");
    expect(source).toContain(".in('source', ['gsc-page', 'gsc'])");
    expect(source).toContain('search_clicks');
    expect(source).toContain('search_impressions');
    expect(source).toContain('search_kpi');
    expect(source).toContain('improvement_queue');
  });

  it('keeps explicit improvement actions for the optimization loop', () => {
    const source = routeSource();

    expect(source).toContain('title_meta_ctr_repair');
    expect(source).toContain('intent_answer_refresh');
    expect(source).toContain('expand_winner_cluster');
    expect(source).toContain('content_depth_refresh');
  });
});
