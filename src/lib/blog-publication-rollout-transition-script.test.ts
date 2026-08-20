import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(
  process.cwd(),
  'scripts/transition-blog-publication-rollout-v4.ts',
), 'utf8');

describe('manual rollout transition script', () => {
  it('fail-closes when the RPC returns the wrong stage or state version', () => {
    expect(source).toContain('rollout_transition_result_stage_mismatch');
    expect(source).toContain('rollout_transition_result_version_mismatch');
    expect(source).toContain('Number(state.state_version) + 1');
  });
});
