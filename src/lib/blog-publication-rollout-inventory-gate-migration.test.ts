import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260820113000_blog_publication_rollout_inventory_gate_v1.sql',
), 'utf8');

describe('manual rollout inventory gate migration', () => {
  it('recomputes approved inventory inside the locked RPC', () => {
    expect(migration).toContain('v_actual_approved_inventory integer');
    expect(migration).toContain('select count(*)::integer into v_actual_approved_inventory');
    expect(migration).toContain("where status = 'approved_for_slot'");
    expect(migration).toContain('manual_rollout_actual_approved_inventory_below_60');
    expect(migration).toContain('v_actual_approved_inventory,');
    expect(migration).toContain('caller inventory is not trusted');
  });

  it('keeps the RPC service-role-only and preserves CAS locking', () => {
    expect(migration).toContain('for update;');
    expect(migration).toContain('security invoker');
    expect(migration).toContain('revoke all on function public.transition_blog_publication_rollout_stage_v1');
    expect(migration).toContain('grant execute on function public.transition_blog_publication_rollout_stage_v1');
  });
});
