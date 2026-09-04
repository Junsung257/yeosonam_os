import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AgentOfficeEntryCard', () => {
  it('uses the backend office status endpoint as its single auth boundary', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/admin/AgentOfficeEntryCard.tsx'),
      'utf8',
    );

    expect(source).toContain("fetch('/api/admin/agent/office/status'");
    expect(source).toContain('response.status === 401 || response.status === 403');
    expect(source).not.toContain("fetch('/api/admin/session'");
  });
});
