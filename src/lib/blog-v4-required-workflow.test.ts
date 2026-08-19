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
    expect(source).toContain('scripts/.*blog');
  });
});
