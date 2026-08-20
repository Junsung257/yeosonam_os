import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

describe('Blog V4 required CI lane', () => {
  const source = readFileSync('.github/workflows/blog-v4-required.yml', 'utf8');

  it('runs on pull requests and merge queues without path-filter pending checks', () => {
    const workflow = parse(source) as Record<string, unknown>;
    expect(workflow).toBeTruthy();
    expect(source).toContain('pull_request:');
    expect(source).toContain('merge_group:');
    expect(source).not.toContain('    paths:');
    expect(source).toContain('No Blog V4 changes');
  });

  it('makes the no-change success explicit and gates the expensive lane on scope detection', () => {
    expect(source).toContain('id: scope');
    expect(source).toContain('blog_changed=false');
    expect(source).toContain("steps.scope.outputs.blog_changed == 'true'");
    expect(source).toContain('steps.scope.outputs.blog_changed != \'true\'');
    expect(source).toContain('src/(app|components|lib)/.*blog');
    expect(source).toContain('src/workflows/.*blog');
    expect(source).toContain('scripts/.*blog');
  });

  it('runs the factory exact-set, public surface, lint and Linux build contracts', () => {
    expect(source).toContain('verify:blog-content-factory-release-bundle-v4');
    expect(source).toContain('verify:blog-content-factory-supabase-dry-run-v4');
    expect(source).toContain('20260820100000_blog_publication_rollout_manual_transition_v1.sql');
    expect(source).toContain('transition-blog-publication-rollout-v4.ts');
    expect(source).toContain('src/lib/blog-content-factory');
    expect(source).toContain('src/lib/blog-public-eligibility-contract-v3.test.ts');
    expect(source).toContain('src/app/sitemap.test.ts');
    expect(source).toContain('src/lib/blog-indexing-worker.test.ts');
    expect(source).toContain('npx eslint');
    expect(source).toContain('run: npm run build');
  });
});
