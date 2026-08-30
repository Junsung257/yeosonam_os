import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog information research recheck operator script', () => {
  it('supports selecting exactly one queue row for a controlled recovery', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'scripts/recheck-blog-information-research.ts'),
      'utf8',
    );

    expect(source).toContain("const queueId = value('--queue-id')");
    expect(source).toContain("if (queueId) query = query.eq('id', queueId)");
    expect(source).toContain('loadResearchFailureRows(limitValue(), destination, queueId)');
  });
});
