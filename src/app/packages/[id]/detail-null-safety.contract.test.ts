import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('package detail malformed schedule safety', () => {
  it('normalizes activity before string operations', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/packages/[id]/DetailClient.tsx'), 'utf8');
    expect(source).toContain('const activity = customerVisibleText(item.activity);');
    expect(source).not.toContain('item.activity.trim()');
    expect(source).not.toMatch(/\.test\(item\.activity\)/);
    expect(source).not.toContain('item.activity.includes');
  });
});
