#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const jsonOutput = args.has('--json');
const selfTest = args.has('--self-test');
const strict = args.has('--strict') || process.env.VERIFY_ALL_STRICT === '1';
const runId = `${process.pid}-${Date.now()}`;
const fullOperationalTemplatePath = argValue(
  '--operational-template',
  process.env.VERIFY_ALL_OPERATIONAL_TEMPLATE || '.tmp/full-project-operational-inputs.env.example',
);
const fullOperationalPlanPath = argValue(
  '--operational-plan',
  process.env.VERIFY_ALL_OPERATIONAL_PLAN || '.tmp/full-project-operational-inputs-action-plan.md',
);
const fullOperationalApplyScriptPath = argValue(
  '--operational-apply-script',
  process.env.VERIFY_ALL_OPERATIONAL_APPLY_SCRIPT || '.tmp/full-project-operational-inputs-apply.sh',
);
const fullOperationalVercelScriptPath = argValue(
  '--operational-vercel-script',
  process.env.VERIFY_ALL_OPERATIONAL_VERCEL_SCRIPT || '.tmp/full-project-operational-inputs-vercel-env.sh',
);
const fullOperationalNodeApplyScriptPath = argValue(
  '--operational-node-apply-script',
  process.env.VERIFY_ALL_OPERATIONAL_NODE_APPLY_SCRIPT || '.tmp/full-project-operational-inputs-apply.mjs',
);
const fullOperationalNodeVercelScriptPath = argValue(
  '--operational-node-vercel-script',
  process.env.VERIFY_ALL_OPERATIONAL_NODE_VERCEL_SCRIPT || '.tmp/full-project-operational-inputs-vercel-env.mjs',
);
const fullOperationalEnvFilePath = argValue(
  '--operational-env-file',
  process.env.VERIFY_ALL_OPERATIONAL_ENV_FILE || '',
);

function hasFlag(name) {
  return args.has(name) || process.env[`VERIFY_ALL_${name.replace(/^--/, '').replace(/-/g, '_').toUpperCase()}`] === '1';
}

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  let value = fallback;
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg.startsWith(prefix)) {
      value = arg.slice(prefix.length);
      continue;
    }
    if (arg === name) {
      const next = rawArgs[index + 1];
      if (next && !next.startsWith('--')) value = next;
    }
  }
  return value;
}

function validateArgs() {
  const valueArgs = new Set([
    '--report',
    '--local-report',
    '--marketing-report',
    '--stage-timeout-ms',
    '--command-timeout-ms',
    '--command-timeout-kill-grace-ms',
    '--operational-template',
    '--operational-plan',
    '--operational-apply-script',
    '--operational-vercel-script',
    '--operational-node-apply-script',
    '--operational-node-vercel-script',
    '--operational-env-file',
  ]);
  const flagArgs = new Set([
    '--json',
    '--self-test',
    '--strict',
    '--include-ux-smoke',
    '--skip-readiness-contracts',
    '--skip-ux-masterplan',
    '--skip-event-taxonomy',
    '--skip-design-system',
    '--skip-ux-smoke',
    '--skip-local-release',
    '--skip-marketing-release',
    '--skip-build',
    '--keep-build-dist',
    '--skip-operational-inputs',
    '--skip-operational-discovery',
    '--skip-tests',
    '--skip-a11y',
    '--skip-sensitive-api-guards',
    '--skip-dependency-circular',
    '--skip-open-readiness',
    '--skip-app-route-runtime',
    '--strict-open',
    '--skip-type-check',
    '--skip-lint',
    '--skip-runtime',
    '--skip-marketing-automation',
  ]);
  const invalid = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith('--')) continue;

    const [name] = arg.split('=');
    if (flagArgs.has(name)) continue;
    if (valueArgs.has(name)) {
      if (arg.includes('=')) continue;
      const next = rawArgs[index + 1];
      if (!next || next.startsWith('--')) {
        invalid.push(`${name} requires a value`);
      } else {
        index += 1;
      }
      continue;
    }

    invalid.push(`unknown verify:all argument: ${arg}`);
  }

  return invalid;
}

function exitConfigFailure(errors) {
  const report = {
    status: 'fail',
    passed: 0,
    blocked: 0,
    failed: errors.length,
    errors,
  };
  if (jsonOutput) console.log(JSON.stringify(report, null, 2));
  else {
    for (const error of errors) console.error(`[verify-all-readiness] ${error}`);
  }
  process.exit(1);
}

const invalidArgs = validateArgs();
if (invalidArgs.length > 0) exitConfigFailure(invalidArgs);

const reportPath = argValue('--report', process.env.VERIFY_ALL_REPORT_PATH || '');
const stageTimeoutMs = Number(argValue('--stage-timeout-ms', process.env.VERIFY_ALL_STAGE_TIMEOUT_MS || '1800000'));
if (!Number.isFinite(stageTimeoutMs) || stageTimeoutMs <= 0) {
  exitConfigFailure(['--stage-timeout-ms must be a positive number of milliseconds.']);
}
const commandTimeoutMs = Number(argValue(
  '--command-timeout-ms',
  process.env.VERIFY_ALL_COMMAND_TIMEOUT_MS || '1500000',
));
if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) {
  exitConfigFailure(['--command-timeout-ms must be a positive number of milliseconds.']);
}
const commandTimeoutKillGraceMs = Number(argValue(
  '--command-timeout-kill-grace-ms',
  process.env.VERIFY_ALL_COMMAND_TIMEOUT_KILL_GRACE_MS || '5000',
));
if (!Number.isFinite(commandTimeoutKillGraceMs) || commandTimeoutKillGraceMs <= 0) {
  exitConfigFailure(['--command-timeout-kill-grace-ms must be a positive number of milliseconds.']);
}
const skipContracts = hasFlag('--skip-readiness-contracts');
const skipUxMasterplan = hasFlag('--skip-ux-masterplan');
const skipEventTaxonomy = hasFlag('--skip-event-taxonomy');
const skipDesignSystem = hasFlag('--skip-design-system');
const skipA11y = hasFlag('--skip-a11y');
const skipTypeCheck = hasFlag('--skip-type-check');
const includeUxSmoke = hasFlag('--include-ux-smoke');
const skipUxSmoke = hasFlag('--skip-ux-smoke') || !includeUxSmoke;
const skipLocalRelease = hasFlag('--skip-local-release');
const skipMarketingRelease = hasFlag('--skip-marketing-release');
const skipOperationalInputs = hasFlag('--skip-operational-inputs');

function ensureParent(path) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
}

function parseJsonFromOutput(value) {
  const text = String(value || '').replace(/\u0000/g, '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first < 0 || last < first) return null;
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch {
      return null;
    }
  }
}

function uniqueAttentionItems(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = [
      item.stage,
      item.source,
      item.name,
      item.status,
      Array.isArray(item.missing) ? item.missing.join(',') : '',
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function attentionItemsFromReport(stageId, report, limit = 12) {
  const items = [];
  const add = (item, fallbackStatus = 'blocked') => {
    if (!item || typeof item !== 'object') return;
    const status = String(item.status || fallbackStatus || '').trim() || 'blocked';
    if (!['blocked', 'fail', 'warn'].includes(status)) return;
    const missing = Array.isArray(item.missing) ? item.missing.slice(0, 32) : [];
    const notes = String(item.notes || item.error || '').trim().slice(0, 280);
    if (missing.length === 0 && !notes) return;
    items.push({
      stage: stageId,
      source: item.source || item.id || '',
      name: item.name || item.id || item.label || 'attention',
      status,
      missing,
      notes,
    });
  };

  for (const item of Array.isArray(report?.releaseBlockers) ? report.releaseBlockers : []) {
    add(item, 'blocked');
  }
  for (const item of Array.isArray(report?.releaseWarnings) ? report.releaseWarnings : []) {
    add(item, 'warn');
  }
  for (const check of Array.isArray(report?.checks) ? report.checks : []) {
    if (check?.status === 'blocked' || check?.status === 'fail' || check?.status === 'warn') {
      add({
        source: check.id || check.name,
        name: check.id || check.name,
        status: check.status,
        missing: check.missing,
        notes: check.notes || check.error,
      }, check.status);
    }
    for (const nested of Array.isArray(check?.attention?.checks) ? check.attention.checks : []) {
      add({
        source: check.id || check.name,
        name: nested.name || nested.id,
        status: nested.status,
        missing: nested.missing,
        notes: nested.notes || nested.error,
      }, nested.status);
    }
  }

  return uniqueAttentionItems(items).slice(0, limit);
}

function firstArtifactPath(report, artifactKey, checkKey) {
  const direct = report?.artifacts?.[artifactKey];
  if (direct) return direct;
  for (const check of Array.isArray(report?.checks) ? report.checks : []) {
    if (check?.[checkKey]) return check[checkKey];
  }
  return undefined;
}

function operationalArtifactFieldsFromReport(report) {
  const envFilePath = report?.operationalEnvFile?.path
    || firstArtifactPath(report, 'operationalEnvFile', 'envFilePath');
  return {
    templatePath: firstArtifactPath(report, 'operationalTemplate', 'templatePath'),
    actionPlanPath: firstArtifactPath(report, 'operationalPlan', 'actionPlanPath'),
    applyScriptPath: firstArtifactPath(report, 'operationalApplyScript', 'applyScriptPath'),
    vercelScriptPath: firstArtifactPath(report, 'operationalVercelScript', 'vercelScriptPath'),
    nodeApplyScriptPath: firstArtifactPath(report, 'operationalNodeApplyScript', 'nodeApplyScriptPath'),
    nodeVercelScriptPath: firstArtifactPath(report, 'operationalNodeVercelScript', 'nodeVercelScriptPath'),
    envFilePath,
  };
}

function uniqueOperationalArtifactRows(checks) {
  const rows = [];
  const seen = new Set();
  const artifactFields = [
    ['templatePath', 'fill-in template'],
    ['actionPlanPath', 'action plan'],
    ['applyScriptPath', 'apply script'],
    ['vercelScriptPath', 'vercel env script'],
    ['nodeApplyScriptPath', 'node apply script'],
    ['nodeVercelScriptPath', 'node vercel env script'],
    ['envFilePath', 'env file'],
  ];
  for (const check of checks) {
    for (const [field, label] of artifactFields) {
      const path = check?.[field];
      if (!path) continue;
      const key = `${label}:${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ stage: check.id || 'unknown', label, path });
    }
  }
  return rows;
}

function printConsoleGuidance(report) {
  const attention = Array.isArray(report.attention) ? report.attention : [];
  if (attention.length > 0) {
    console.log('\nAttention items:');
    for (const item of attention.slice(0, 8)) {
      const missing = Array.isArray(item.missing) && item.missing.length > 0
        ? ` missing=${item.missing.join(',')}`
        : '';
      const notes = item.notes ? ` - ${item.notes}` : '';
      console.log(`- ${item.stage || 'stage'}:${item.name || item.source || 'attention'} [${item.status}]${missing}${notes}`);
    }
    if (attention.length > 8) {
      console.log(`- ... ${attention.length - 8} more attention item(s) in the JSON report`);
    }
  }

  const artifacts = uniqueOperationalArtifactRows(report.checks || []);
  if (artifacts.length > 0) {
    console.log('\nOperational artifacts:');
    for (const artifact of artifacts.slice(0, 10)) {
      console.log(`- ${artifact.stage} ${artifact.label}: ${artifact.path}`);
    }
    if (artifacts.length > 10) {
      console.log(`- ... ${artifacts.length - 10} more artifact(s) in the JSON report`);
    }
  }

  if (reportPath) {
    console.log(`\nReport: ${reportPath}`);
  }
}

function releasePassThroughArgs(kind) {
  const shared = [
    '--skip-build',
    '--keep-build-dist',
    '--skip-operational-inputs',
    '--skip-operational-discovery',
    '--command-timeout-ms',
    '--command-timeout-kill-grace-ms',
  ];
  const localOnly = [
    '--skip-tests',
    '--skip-type-check',
    '--skip-lint',
    '--skip-a11y',
    '--skip-sensitive-api-guards',
    '--skip-dependency-circular',
    '--skip-readiness-contracts',
    '--skip-ux-masterplan',
    '--skip-marketing-automation',
    '--skip-open-readiness',
    '--skip-app-route-runtime',
    '--strict-open',
    '--strict',
  ];
  const marketingOnly = [
    '--skip-type-check',
    '--skip-lint',
    '--skip-runtime',
    '--skip-readiness-contracts',
    '--skip-marketing-automation',
    '--strict',
  ];
  const allowed = new Set([...shared, ...(kind === 'local' ? localOnly : marketingOnly)]);
  const valuePassthrough = new Set(['--command-timeout-ms', '--command-timeout-kill-grace-ms']);
  const passthrough = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const [name] = arg.split('=');
    if (!allowed.has(name)) continue;
    passthrough.push(arg);
    if (valuePassthrough.has(name) && !arg.includes('=')) {
      const next = rawArgs[index + 1];
      if (next && !next.startsWith('--')) {
        passthrough.push(next);
        index += 1;
      }
    }
  }

  return passthrough;
}

function runStage(stage) {
  const startedAt = process.hrtime.bigint();
  const result = spawnSync(stage.command, stage.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(stage.env || {}) },
    encoding: 'utf8',
    maxBuffer: 80 * 1024 * 1024,
    timeout: stage.timeoutMs || stageTimeoutMs,
    windowsHide: true,
  });
  const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const timedOut = result.error?.code === 'ETIMEDOUT';
  if (timedOut) cleanupTimedOutStageProcesses(stage.id, result.pid);
  const stdoutLog = `.tmp/verify-all-${runId}-${stage.id}.out.log`;
  const stderrLog = `.tmp/verify-all-${runId}-${stage.id}.err.log`;
  ensureParent(stdoutLog);
  writeFileSync(stdoutLog, stdout);
  writeFileSync(stderrLog, stderr);

  const report = parseJsonFromOutput(`${stdout}\n${stderr}`);
  const passed = Number(report?.passed ?? 0);
  const blocked = Number(report?.blocked ?? 0);
  const failed = Number(report?.failed ?? (result.status === 0 ? 0 : 1));
  const warnings = Number(report?.warnings ?? report?.warned ?? 0);
  const reportStatus = report?.status || 'unknown';
  const attention = attentionItemsFromReport(stage.id, report);
  const operationalArtifacts = operationalArtifactFieldsFromReport(report);
  const childCommandTimeoutMs = Number(report?.commandTimeoutMs);
  const childCommandTimeoutKillGraceMs = Number(report?.commandTimeoutKillGraceMs);
  const status = timedOut
    ? 'fail'
    : !report
    ? 'fail'
    : failed > 0 || reportStatus === 'fail'
      ? 'fail'
      : blocked > 0 || reportStatus === 'blocked'
        ? 'blocked'
        : warnings > 0 || reportStatus === 'warn'
          ? 'warn'
          : 'pass';

  return {
    id: stage.id,
    command: [stage.command, ...stage.args].join(' '),
    status,
    exitCode: result.status,
    durationMs,
    passed,
    blocked,
    failed,
    warnings,
    reportStatus,
    stdoutLog,
    stderrLog,
    reportPath: stage.reportPath,
    timeoutMs: stage.timeoutMs || stageTimeoutMs,
    commandTimeoutMs: Number.isFinite(childCommandTimeoutMs) ? childCommandTimeoutMs : undefined,
    commandTimeoutKillGraceMs: Number.isFinite(childCommandTimeoutKillGraceMs)
      ? childCommandTimeoutKillGraceMs
      : undefined,
    timedOut,
    ...operationalArtifacts,
    attention,
    attentionCount: attention.length,
    error: status === 'fail'
      ? (timedOut
        ? `stage timed out after ${stage.timeoutMs || stageTimeoutMs}ms`
        : (stderr || stdout || result.error?.message || '').trim().slice(0, 1200))
      : '',
  };
}

function generateFullOperationalInputBundle(attention) {
  const artifacts = {
    operationalTemplate: fullOperationalTemplatePath,
    operationalPlan: fullOperationalPlanPath,
    operationalApplyScript: fullOperationalApplyScriptPath,
    operationalVercelScript: fullOperationalVercelScriptPath,
    operationalNodeApplyScript: fullOperationalNodeApplyScriptPath,
    operationalNodeVercelScript: fullOperationalNodeVercelScriptPath,
    operationalEnvFile: fullOperationalEnvFilePath || undefined,
  };

  if (skipOperationalInputs || !Array.isArray(attention) || attention.length === 0) {
    return { skipped: true, artifacts };
  }

  const startedAt = process.hrtime.bigint();
  const command = process.execPath;
  const args = [
    'scripts/verify-operational-readiness-inputs.mjs',
    '--json',
    `--template-out=${fullOperationalTemplatePath}`,
    `--plan-out=${fullOperationalPlanPath}`,
    `--apply-script-out=${fullOperationalApplyScriptPath}`,
    `--vercel-script-out=${fullOperationalVercelScriptPath}`,
    `--node-apply-script-out=${fullOperationalNodeApplyScriptPath}`,
    `--node-vercel-script-out=${fullOperationalNodeVercelScriptPath}`,
    '--inspect-vercel',
    '--inspect-github',
    '--inspect-management-auth',
    '--inspect-supabase-system-secrets',
    ...(fullOperationalEnvFilePath ? [`--env-file=${fullOperationalEnvFilePath}`] : []),
  ];
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: commandTimeoutMs,
    windowsHide: true,
  });
  const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const parsed = parseJsonFromOutput(`${result.stdout || ''}\n${result.stderr || ''}`);
  const ok = !timedOut && result.status === 0 && Boolean(parsed);

  return {
    skipped: false,
    status: ok ? parsed.status || 'unknown' : 'fail',
    command: [command, ...args].join(' '),
    exitCode: result.status,
    durationMs,
    timedOut,
    timeoutMs: commandTimeoutMs,
    passed: Number(parsed?.passed ?? 0),
    blocked: Number(parsed?.blocked ?? 0),
    warnings: Number(parsed?.warnings ?? parsed?.warned ?? 0),
    failed: ok ? Number(parsed?.failed ?? 0) : 1,
    artifacts,
    error: ok
      ? ''
      : (timedOut
        ? `full operational input bundle timed out after ${commandTimeoutMs}ms`
        : (result.stderr || result.stdout || result.error?.message || '').trim().slice(0, 1200)),
  };
}

function cleanupTimedOutStageProcesses(stageId, pid) {
  if (pid && process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      stdio: 'ignore',
      timeout: 30_000,
      windowsHide: true,
    });
  } else if (pid) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // Best effort only; the timed-out child may already have exited.
    }
  }

  if (process.platform !== 'win32') return;

  const workspace = process.cwd().replace(/'/g, "''");
  const stagePatterns = {
    'local-release': [
      'verify-local-release-readiness\\.mjs',
      'verify-open-readiness-local\\.mjs',
      'open-readiness-check\\.mjs',
      'next\\s+dev',
      'next.*dist.*bin.*next.*dev',
      'start-server\\.js',
    ],
    'marketing-release': [
      'verify-marketing-release-readiness\\.mjs',
      'verify-marketing-runtime-from-vercel\\.mjs',
      'verify-marketing-automation-readiness\\.mjs',
      'next\\s+dev',
      'next.*dist.*bin.*next.*dev',
      'start-server\\.js',
    ],
  };
  const pattern = (stagePatterns[stageId] || [`${stageId}`]).join('|').replace(/'/g, "''");
  spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `$workspace='${workspace}'; $pattern='${pattern}'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($workspace) -and $_.ProcessId -ne $PID -and ($_.CommandLine -match $pattern) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  ], {
    encoding: 'utf8',
    stdio: 'ignore',
    timeout: 30_000,
    windowsHide: true,
  });
}

function buildStages() {
  const stages = [];
  if (!skipContracts) {
    stages.push({
      id: 'readiness-contracts',
      command: process.execPath,
      args: ['scripts/verify-readiness-contracts.mjs', '--json'],
    });
  }
  if (!skipUxMasterplan) {
    stages.push({
      id: 'ux-masterplan',
      command: process.execPath,
      args: ['scripts/verify-ux-masterplan-contract.mjs', '--json'],
    });
  }
  if (!skipEventTaxonomy) {
    stages.push({
      id: 'event-taxonomy',
      command: process.execPath,
      args: ['scripts/audit-event-taxonomy.mjs', '--json'],
    });
  }
  if (!skipDesignSystem) {
    stages.push({
      id: 'design-system',
      command: process.execPath,
      args: ['scripts/verify-admin-tokens.mjs', '--json'],
    });
  }
  if (!skipA11y) {
    stages.push({
      id: 'a11y',
      command: process.execPath,
      args: ['scripts/verify-a11y.mjs', '--json'],
    });
  }
  if (!skipTypeCheck) {
    stages.push({
      id: 'type-check',
      command: process.execPath,
      args: ['scripts/verify-type-check.mjs', '--json'],
    });
  }
  if (!skipUxSmoke) {
    stages.push({
      id: 'ux-smoke',
      command: process.execPath,
      args: ['scripts/verify-ux-smoke.mjs', '--json'],
    });
  }
  if (!skipLocalRelease) {
    const localReport = argValue('--local-report', `.tmp/verify-all-local-release-${runId}.json`);
    stages.push({
      id: 'local-release',
      command: process.execPath,
      args: [
        'scripts/verify-local-release-readiness.mjs',
        '--json',
        `--report=${localReport}`,
        ...releasePassThroughArgs('local'),
      ],
      reportPath: localReport,
      env: {
        LOCAL_RELEASE_COMMAND_TIMEOUT_MS: process.env.LOCAL_RELEASE_COMMAND_TIMEOUT_MS || String(commandTimeoutMs),
        LOCAL_RELEASE_COMMAND_TIMEOUT_KILL_GRACE_MS:
          process.env.LOCAL_RELEASE_COMMAND_TIMEOUT_KILL_GRACE_MS || String(commandTimeoutKillGraceMs),
      },
    });
  }
  if (!skipMarketingRelease) {
    const marketingReport = argValue('--marketing-report', `.tmp/verify-all-marketing-release-${runId}.json`);
    stages.push({
      id: 'marketing-release',
      command: process.execPath,
      args: [
        'scripts/verify-marketing-release-readiness.mjs',
        '--json',
        `--report=${marketingReport}`,
        ...releasePassThroughArgs('marketing'),
      ],
      reportPath: marketingReport,
      env: {
        MARKETING_RELEASE_COMMAND_TIMEOUT_MS: process.env.MARKETING_RELEASE_COMMAND_TIMEOUT_MS || String(commandTimeoutMs),
        MARKETING_RELEASE_COMMAND_TIMEOUT_KILL_GRACE_MS:
          process.env.MARKETING_RELEASE_COMMAND_TIMEOUT_KILL_GRACE_MS || String(commandTimeoutKillGraceMs),
      },
    });
  }
  return stages;
}

const stages = buildStages();

if (selfTest) {
  const report = {
    status: 'pass',
    selfTest: true,
    passed: 1,
    blocked: 0,
    failed: 0,
    stageTimeoutMs,
    commandTimeoutMs,
    commandTimeoutKillGraceMs,
    stages: stages.map((stage) => ({ id: stage.id, command: [stage.command, ...stage.args].join(' ') })),
  };
  if (reportPath) {
    ensureParent(reportPath);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (jsonOutput) console.log(JSON.stringify(report, null, 2));
  else console.log('PASS verify-all-readiness self-test');
  process.exit(0);
}

if (stages.length === 0) {
  const report = {
    status: 'fail',
    strict,
    passed: 0,
    blocked: 0,
    warned: 0,
    failed: 1,
    stageTimeoutMs,
    commandTimeoutMs,
    commandTimeoutKillGraceMs,
    total: 0,
    skipped: {
      readinessContracts: skipContracts,
      uxMasterplan: skipUxMasterplan,
      eventTaxonomy: skipEventTaxonomy,
      designSystem: skipDesignSystem,
      a11y: skipA11y,
      typeCheck: skipTypeCheck,
      uxSmoke: skipUxSmoke,
      localRelease: skipLocalRelease,
      marketingRelease: skipMarketingRelease,
    },
    attention: [],
    attentionCount: 0,
    checks: [],
    errors: ['verify:all selected no stages; remove at least one --skip-* flag or use --self-test for wiring checks.'],
  };
  if (reportPath) {
    ensureParent(reportPath);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(`[verify-all-readiness] ${report.errors[0]}`);
  }
  process.exit(1);
}

const checks = [];
for (const stage of stages) {
  const check = runStage(stage);
  checks.push(check);
  if (!jsonOutput) {
    const suffix = check.status === 'fail'
      ? ` exit=${check.exitCode}`
      : check.status === 'blocked'
        ? ` blocked=${check.blocked}`
        : check.status === 'warn'
          ? ` warnings=${check.warnings}`
          : '';
    console.log(`${check.status.toUpperCase().padEnd(7)} ${check.id}${suffix} (${check.durationMs}ms)`);
  }
  if (check.status === 'fail') break;
}

const failed = checks.filter((check) => check.status === 'fail').length;
const blocked = checks.filter((check) => check.status === 'blocked').length;
const warned = checks.filter((check) => check.status === 'warn').length;
const passed = checks.filter((check) => check.status === 'pass').length;
const status = failed > 0 ? 'fail' : blocked > 0 ? 'blocked' : warned > 0 ? 'warn' : 'pass';
const attention = checks.flatMap((check) => Array.isArray(check.attention) ? check.attention : []);
const operationalBundle = generateFullOperationalInputBundle(attention);
const report = {
  kind: 'full-project',
  status,
  strict,
  passed,
  blocked,
  warned,
  failed,
  stageTimeoutMs,
  commandTimeoutMs,
  commandTimeoutKillGraceMs,
  total: checks.length,
  skipped: {
    readinessContracts: skipContracts,
    uxMasterplan: skipUxMasterplan,
    eventTaxonomy: skipEventTaxonomy,
    designSystem: skipDesignSystem,
    a11y: skipA11y,
    typeCheck: skipTypeCheck,
    uxSmoke: skipUxSmoke,
    localRelease: skipLocalRelease,
    marketingRelease: skipMarketingRelease,
  },
  attention,
  attentionCount: attention.length,
  artifacts: operationalBundle.artifacts,
  operationalBundle,
  checks,
};

if (reportPath) {
  ensureParent(reportPath);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\n[verify-all-readiness] ${status}: ${passed} passed, ${blocked} blocked, ${failed} failed, ${warned} warned`);
  printConsoleGuidance(report);
}

if (failed > 0) process.exit(1);
if (strict && blocked > 0) process.exit(2);
