import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('rank tracking publication isolation', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/api/cron/rank-tracking/route.ts'), 'utf8');

  it('stores decay observations in rank_alerts without mutating public article rows', () => {
    expect(source).toContain("supabaseAdmin.from('rank_alerts').insert(alertRows)");
    expect(source).not.toContain(".from('content_creatives')");
    expect(source).not.toContain('rank_decay_signal');
  });
});
