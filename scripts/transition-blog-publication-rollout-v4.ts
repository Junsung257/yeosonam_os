import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

type Stage = 'pilot_3' | 'ramp_10' | 'max_30';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}

function required(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`rollout_transition_argument_missing:${name}`);
  return value;
}

function validStage(value: string): value is Stage {
  return value === 'pilot_3' || value === 'ramp_10' || value === 'max_30';
}

function assertTransition(expected: Stage, next: Stage): void {
  if (!((expected === 'pilot_3' && next === 'ramp_10') || (expected === 'ramp_10' && next === 'max_30'))) {
    throw new Error(`rollout_transition_not_adjacent:${expected}:${next}`);
  }
}

async function main(): Promise<void> {
  const expectedStage = required('expected-from');
  const nextStage = required('next-stage');
  if (!validStage(expectedStage) || !validStage(nextStage)) throw new Error('rollout_transition_stage_invalid');
  assertTransition(expectedStage, nextStage);

  const approvalReference = required('approval-reference');
  if (approvalReference.trim().length < 8 || /^(test|ok|approved|12345678)$/i.test(approvalReference.trim())) {
    throw new Error('rollout_transition_approval_reference_invalid');
  }
  const releaseCommit = required('release-commit').toLowerCase();
  const evidenceSha256 = required('evidence-sha256').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(releaseCommit)) throw new Error('rollout_transition_release_commit_invalid');
  if (!/^[0-9a-f]{64}$/.test(evidenceSha256)) throw new Error('rollout_transition_evidence_sha256_invalid');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('rollout_transition_supabase_credentials_missing');
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: state, error: stateError } = await client
    .from('blog_publication_rollout_state')
    .select('scope,stage,status,state_version')
    .eq('scope', 'global')
    .maybeSingle();
  if (stateError || !state) throw new Error(`rollout_transition_state_unavailable:${stateError?.message || 'missing'}`);
  if (state.status !== 'active') throw new Error('rollout_transition_state_frozen');
  if (state.stage !== expectedStage) throw new Error(`rollout_transition_expected_stage_mismatch:${expectedStage}:${state.stage}`);

  const { count: approvedCount, error: approvedError } = await client
    .from('blog_generation_runs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'approved_for_slot');
  if (approvedError) throw new Error(`rollout_transition_inventory_unavailable:${approvedError.message}`);
  const approvedInventoryCount = Number(approvedCount || 0);
  if (nextStage === 'max_30' && approvedInventoryCount < 60) {
    throw new Error(`rollout_transition_approved_inventory_below_60:${approvedInventoryCount}`);
  }

  const evidence = {
    scope: 'global',
    expectedStage,
    nextStage,
    expectedStateVersion: Number(state.state_version),
    approvalReference,
    approvalValidated: true,
    approvedInventoryCount,
    githubRunId: process.env.GITHUB_RUN_ID || required('github-run-id'),
    releaseCommit,
    evidenceSha256,
    operator: process.env.GITHUB_ACTOR || required('operator'),
    applied: process.argv.includes('--apply'),
  };
  const output = argument('output');
  if (output) writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (!process.argv.includes('--apply')) {
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    return;
  }

  const { data: transitioned, error: transitionError } = await client.rpc('transition_blog_publication_rollout_stage_v1', {
    p_scope: 'global',
    p_expected_stage: expectedStage,
    p_next_stage: nextStage,
    p_expected_state_version: Number(state.state_version),
    p_approval_reference: approvalReference,
    p_approved_inventory_count: approvedInventoryCount,
    p_github_run_id: evidence.githubRunId,
    p_release_commit: releaseCommit,
    p_evidence_sha256: evidenceSha256,
    p_operator: evidence.operator,
  });
  if (transitionError || !Array.isArray(transitioned) || transitioned.length !== 1) {
    throw new Error(`rollout_transition_failed:${transitionError?.message || 'unexpected_result'}`);
  }
  const result = { ...evidence, applied: true, resultingState: transitioned[0] };
  if (output) writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`blog publication rollout transition failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
