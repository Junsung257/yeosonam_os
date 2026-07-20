import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx)$/.test(entry)) files.push(path);
  }
  return files;
}

describe('JSON-LD script sink inventory', () => {
  it('uses the shared script-safe serializer at every in-scope JSON-LD sink', () => {
    const roots = [join(process.cwd(), 'src/app'), join(process.cwd(), 'src/components')];
    const sinks = roots
      .flatMap(sourceFiles)
      .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
      .filter(({ source }) => source.includes('application/ld+json'));

    expect(sinks.length).toBeGreaterThan(0);
    for (const sink of sinks) {
      const label = relative(process.cwd(), sink.path);
      expect(sink.source, label).toContain("from '@/lib/json-ld'");
      expect(sink.source, label).toContain('serializeJsonLdForScript');
      expect(sink.source, label).not.toMatch(/__html\s*:\s*JSON\.stringify/);
    }
  }, 20_000);
});
