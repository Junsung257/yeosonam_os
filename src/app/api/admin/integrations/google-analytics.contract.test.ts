import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('admin integrations Google Analytics contract', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/api/admin/integrations/route.ts'), 'utf8');

  it('shows Google Analytics as an independently tracked integration', () => {
    expect(source).toContain("google_analytics: 'Google Analytics'");
    expect(source).toContain("['google_ads', 'google_analytics', 'meta', 'naver', 'clobe']");
  });
});
