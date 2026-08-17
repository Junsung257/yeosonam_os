import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'next.config.js'), 'utf8');

describe('Next development server stability', () => {
  it('does not mutate build manifests from development compiler afterEmit hooks', () => {
    expect(source).toContain('if (isServer && isProd)');
    expect(source).toContain("compiler.hooks.afterEmit.tap('EnsureNextManifestsPlugin'");
    expect(source).not.toMatch(/if \(isServer\) \{\s*config\.plugins[\s\S]{0,200}EnsureNextManifestsPlugin/);
  });
});
