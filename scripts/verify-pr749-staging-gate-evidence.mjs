#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const json = args.has('--json');
const selfTest = args.has('--self-test');
const requirePass = args.has('--require-pass');
const allowBlocked = args.has('--allow-blocked') || !requirePass;

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] ?? fallback : fallback;
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function get(path, source) {
  return path.split('.').reduce((current, key) => current?.[key], source);
}

function isoTime(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : null;
}

function normalizeSha(value) {
  return String(value || '').trim().toLowerCase();
}

function validateEvidence(evidence, options = {}) {
  const blockers = [];
  const warnings = [];
  const expectedHead = normalizeSha(options.expectedHead);
  const now = options.now ?? Date.now();

  const assert = (condition, code, message) => {
    if (!condition) blockers.push({ code, message });
  };
  const warn = (condition, code, message) => {
    if (!condition) warnings.push({ code, message });
  };

  assert(evidence && typeof evidence === 'object' && !Array.isArray(evidence), 'schema.invalid_root', 'Evidence must be a JSON object.');
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { status: 'fail', verdict: 'EVIDENCE_INVALID', blockers, warnings };
  }

  assert(evidence.schema_version === 1, 'schema.version', 'schema_version must be 1.');
  assert(evidence.pr_number === 749, 'identity.pr_number', 'pr_number must be 749.');
  assert(Boolean(normalizeSha(evidence.head_sha)), 'identity.head_sha_missing', 'head_sha is required.');
  if (expectedHead) {
    assert(normalizeSha(evidence.head_sha) === expectedHead, 'identity.head_sha_mismatch', 'head_sha must match the expected current PR HEAD.');
  }
  warn(Boolean(normalizeSha(evidence.base_sha)), 'identity.base_sha_missing', 'base_sha should be present for traceability.');

  const generatedAt = isoTime(evidence.generated_at);
  const expiresAt = isoTime(evidence.expires_at);
  assert(Boolean(generatedAt), 'time.generated_at_missing', 'generated_at must be a valid ISO timestamp.');
  assert(Boolean(expiresAt), 'time.expires_at_missing', 'expires_at must be a valid ISO timestamp.');
  if (generatedAt && expiresAt) {
    assert(expiresAt > generatedAt, 'time.ttl_invalid', 'expires_at must be after generated_at.');
    assert(options.allowExpired || expiresAt > now, 'time.expired', 'Evidence is expired.');
  }

  const verdict = String(evidence.verdict || '').trim();
  const activationEligible = evidence.activation_eligible === true;
  const blockedVerdict = verdict === 'STAGING_IDENTITY_NOT_VERIFIED' || activationEligible === false;

  assert(Boolean(verdict), 'verdict.missing', 'verdict is required.');

  if (blockedVerdict && allowBlocked && !requirePass) {
    return {
      status: blockers.length === 0 ? 'blocked' : 'fail',
      verdict: verdict || 'STAGING_IDENTITY_NOT_VERIFIED',
      activationEligible: false,
      blockers,
      warnings,
      checks: { mode: 'blocked-evidence-shape' },
    };
  }

  assert(evidence.activation_eligible === true, 'activation.not_eligible', 'activation_eligible must be true for rollout activation.');
  assert(get('environment.kind', evidence) === 'staging', 'environment.kind', 'environment.kind must be staging.');
  assert(get('environment.production_identity_mismatch', evidence) === true, 'environment.production_mismatch', 'production_identity_mismatch must be true.');
  assert(get('environment.mutation_opt_in', evidence) === true, 'environment.mutation_opt_in', 'mutation_opt_in must be true.');
  assert(get('migration.status', evidence) === 'success', 'migration.status', 'migration.status must be success.');
  assert(asNumber(get('security.blockers', evidence)) === 0, 'security.blockers', 'security blockers must be 0.');
  assert(asNumber(get('snapshots.rows', evidence)) > 0, 'snapshots.rows', 'snapshot rows must be greater than 0.');
  assert(asNumber(get('snapshots.gate_pass', evidence)) > 0, 'snapshots.gate_pass', 'gate-pass snapshots must be greater than 0.');
  assert(asNumber(get('proofs.fresh', evidence)) > 0, 'proofs.fresh', 'fresh exact proofs must be greater than 0.');
  assert(asNumber(get('projections.required_coverage', evidence)) >= 100, 'projections.required_coverage', 'required projection coverage must be 100%.');
  assert(asNumber(get('pollution.active_unresolved_public', evidence)) === 0, 'pollution.active_unresolved_public', 'active unresolved public pollution must be 0.');
  assert(asNumber(get('pollution.quarantined_but_active', evidence)) === 0, 'pollution.quarantined_but_active', 'quarantined-but-active must be 0.');
  assert(asNumber(get('egress.raw_fallback', evidence)) === 0, 'egress.raw_fallback', 'external raw fallback must be 0.');
  assert(asNumber(get('egress.blocked_exposure', evidence)) === 0, 'egress.blocked_exposure', 'blocked external exposure must be 0.');
  assert(asNumber(get('egress.stale_outbound_publication', evidence)) === 0, 'egress.stale_outbound_publication', 'stale outbound publication must be 0.');
  assert(asNumber(get('selection_only.invalid', evidence)) === 0, 'selection_only.invalid', 'invalid selection_only entries must be 0.');
  assert(asNumber(get('selection_only.raw_copy_in_dto', evidence)) === 0, 'selection_only.raw_copy_in_dto', 'selection_only raw copy DTO leaks must be 0.');
  assert(get('admin_smoke.status', evidence) === 'success', 'admin_smoke.status', 'admin smoke must be success.');
  assert(get('audit_500.status', evidence) === 'success', 'audit_500.status', '500-package audit must be success.');
  assert(asNumber(get('audit_500.false_generated', evidence)) === 0, 'audit_500.false_generated', 'false-generated count must be 0.');
  assert(asNumber(get('audit_500.wrong_price_exposure', evidence)) === 0, 'audit_500.wrong_price_exposure', 'wrong price exposure must be 0.');
  assert(get('build.vercel.status', evidence) === 'success', 'build.vercel.status', 'Vercel build must be success.');
  assert(
    verdict === 'STAGING_GATES_PASSED_READY_FOR_REVIEW_RECOMMENDED',
    'verdict.not_ready',
    'verdict must be STAGING_GATES_PASSED_READY_FOR_REVIEW_RECOMMENDED for activation.',
  );

  return {
    status: blockers.length === 0 ? 'pass' : 'fail',
    verdict,
    activationEligible,
    blockers,
    warnings,
    checks: {
      mode: 'activation-evidence',
      snapshotRows: asNumber(get('snapshots.rows', evidence)),
      gatePassSnapshots: asNumber(get('snapshots.gate_pass', evidence)),
      freshProofs: asNumber(get('proofs.fresh', evidence)),
      projectionCoverage: asNumber(get('projections.required_coverage', evidence)),
    },
  };
}

function passingFixture(now) {
  return {
    schema_version: 1,
    pr_number: 749,
    head_sha: '475975d10d624f98f100b6bccd9979d8bb4a40e9',
    base_sha: '170dd1b400000000000000000000000000000000',
    generated_at: new Date(now - 1000).toISOString(),
    expires_at: new Date(now + 86_400_000).toISOString(),
    activation_eligible: true,
    environment: {
      kind: 'staging',
      project_ref_hash: 'hash_only',
      api_host: 'stageref.supabase.co',
      db_host_hash: 'db_hash_only',
      production_identity_mismatch: true,
      mutation_opt_in: true,
    },
    migration: { status: 'success' },
    security: { blockers: 0 },
    snapshots: { rows: 3, gate_pass: 2 },
    proofs: { fresh: 4 },
    pollution: { active_unresolved_public: 0, quarantined_but_active: 0 },
    projections: { required_coverage: 100 },
    egress: { raw_fallback: 0, blocked_exposure: 0, stale_outbound_publication: 0 },
    selection_only: { invalid: 0, raw_copy_in_dto: 0 },
    admin_smoke: { status: 'success' },
    audit_500: { status: 'success', false_generated: 0, wrong_price_exposure: 0 },
    build: { vercel: { status: 'success' } },
    verdict: 'STAGING_GATES_PASSED_READY_FOR_REVIEW_RECOMMENDED',
  };
}

function blockedFixture(now) {
  return {
    schema_version: 1,
    pr_number: 749,
    head_sha: '475975d10d624f98f100b6bccd9979d8bb4a40e9',
    base_sha: null,
    generated_at: new Date(now - 1000).toISOString(),
    expires_at: new Date(now + 86_400_000).toISOString(),
    activation_eligible: false,
    environment: {
      kind: 'unknown',
      production_identity_mismatch: false,
      mutation_opt_in: false,
    },
    verdict: 'STAGING_IDENTITY_NOT_VERIFIED',
    unavailable_reason: 'No verified protected staging identity is available.',
  };
}

function runSelfTest() {
  const now = Date.now();
  const pass = validateEvidence(passingFixture(now), {
    expectedHead: '475975d10d624f98f100b6bccd9979d8bb4a40e9',
    now,
  });
  if (pass.status !== 'pass') {
    throw new Error(`passing fixture failed: ${pass.blockers.map((item) => item.code).join(',')}`);
  }

  const blocked = validateEvidence(blockedFixture(now), {
    expectedHead: '475975d10d624f98f100b6bccd9979d8bb4a40e9',
    now,
  });
  if (blocked.status !== 'blocked') {
    throw new Error('blocked fixture should validate as blocked evidence shape');
  }

  const wrongHead = validateEvidence(passingFixture(now), {
    expectedHead: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    now,
  });
  if (wrongHead.status !== 'fail' || !wrongHead.blockers.some((item) => item.code === 'identity.head_sha_mismatch')) {
    throw new Error('wrong head fixture must fail');
  }

  const expired = validateEvidence({
    ...passingFixture(now),
    expires_at: new Date(now - 1000).toISOString(),
  }, {
    expectedHead: '475975d10d624f98f100b6bccd9979d8bb4a40e9',
    now,
  });
  if (expired.status !== 'fail' || !expired.blockers.some((item) => item.code === 'time.expired')) {
    throw new Error('expired fixture must fail');
  }
}

function main() {
  if (selfTest) {
    runSelfTest();
    const report = { status: 'pass', selfTest: true };
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log('self-test passed');
    return;
  }

  const file = argValue('--file', '');
  const expectedHead = argValue('--expected-head', process.env.EXPECTED_HEAD_SHA || process.env.GITHUB_SHA || '');
  if (!file) {
    const report = {
      status: 'fail',
      verdict: 'EVIDENCE_FILE_MISSING',
      blockers: [{ code: 'file.missing', message: '--file is required.' }],
      warnings: [],
    };
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log('FAIL evidence file is required');
    process.exit(1);
    return;
  }

  let evidence;
  try {
    evidence = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const report = {
      status: 'fail',
      verdict: 'EVIDENCE_READ_FAILED',
      blockers: [{ code: 'file.read_failed', message: error instanceof Error ? error.message : String(error) }],
      warnings: [],
    };
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log(`FAIL ${report.blockers[0].message}`);
    process.exit(1);
    return;
  }

  const report = validateEvidence(evidence, {
    expectedHead,
    allowExpired: args.has('--allow-expired'),
  });
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(`${report.status.toUpperCase()} ${report.verdict}`);

  if (requirePass ? report.status !== 'pass' : report.status === 'fail') process.exit(1);
}

main();
