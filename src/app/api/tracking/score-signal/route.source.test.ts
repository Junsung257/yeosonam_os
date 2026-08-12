import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SIGNAL_TYPES = [
  'view',
  'click',
  'booking',
  'recommend_badge_view',
  'recommend_reason_open',
  'comparison_open',
  'intent_chip_select',
  'lead_sheet_open',
];

describe('package score signal database contract', () => {
  it('keeps every API-accepted signal type in the database constraint', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/tracking/score-signal/route.ts'), 'utf8');
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260812082107_expand_package_score_signal_types.sql'),
      'utf8',
    );

    for (const signalType of SIGNAL_TYPES) {
      expect(route).toContain(`'${signalType}'`);
      expect(migration).toContain(`'${signalType}'`);
    }
    expect(migration).toContain('package_score_signals_signal_type_check');
  });
});
