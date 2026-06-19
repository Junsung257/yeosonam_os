#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, normalize, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const ts = require('typescript');

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const json = args.has('--json');
const knownArgs = new Set([
  '--json',
  '--local-script-syntax-timeout-ms',
  '--workflow-smoke-timeout-ms',
]);

function argValue(name, fallback = '') {
  let value = fallback;
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === name && rawArgs[index + 1] !== undefined) value = rawArgs[index + 1];
    if (arg.startsWith(`${name}=`)) value = arg.slice(name.length + 1);
  }
  return value;
}

function argKey(arg) {
  return String(arg || '').split('=')[0];
}

function exitConfigFailure(errors) {
  const checks = errors.map((error) => ({
    name: 'project-automation-wiring:config',
    status: 'fail',
    error,
  }));
  const report = {
    status: 'fail',
    passed: 0,
    failed: checks.length,
    warnings: 0,
    checks,
  };
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const error of errors) console.error(error);
  }
  process.exit(1);
}

const valueArgs = new Set(['--local-script-syntax-timeout-ms', '--workflow-smoke-timeout-ms']);
const unknownArgs = rawArgs.filter((arg, index) => {
  if (index > 0 && valueArgs.has(rawArgs[index - 1])) return false;
  return !knownArgs.has(argKey(arg));
});

if (unknownArgs.length > 0) {
  exitConfigFailure(unknownArgs.map((arg) => `unknown project automation wiring argument: ${arg}`));
}

const localScriptSyntaxTimeoutMs = Number(argValue(
  '--local-script-syntax-timeout-ms',
  process.env.PROJECT_AUTOMATION_LOCAL_SCRIPT_SYNTAX_TIMEOUT_MS || '30000',
));
const workflowSmokeTimeoutMs = Number(argValue(
  '--workflow-smoke-timeout-ms',
  process.env.PROJECT_AUTOMATION_WORKFLOW_SMOKE_TIMEOUT_MS || '30000',
));

if (!Number.isFinite(localScriptSyntaxTimeoutMs) || localScriptSyntaxTimeoutMs <= 0) {
  exitConfigFailure(['--local-script-syntax-timeout-ms must be a positive number of milliseconds.']);
}
if (!Number.isFinite(workflowSmokeTimeoutMs) || workflowSmokeTimeoutMs <= 0) {
  exitConfigFailure(['--workflow-smoke-timeout-ms must be a positive number of milliseconds.']);
}

const checks = [];
const workflowHelperSmokeTargets = [
  'scripts/analyze-api-perf.js',
  'scripts/analyze-changes.js',
  'scripts/analyze-trends.js',
  'scripts/check-ai-cost.js',
  'scripts/check-alerts.js',
  'scripts/check-api-health.js',
  'scripts/check-bundle.js',
  'scripts/check-db-health.js',
  'scripts/check-db-perf.js',
  'scripts/check-integrity.js',
  'scripts/check-practices.js',
  'scripts/check-review-needed.js',
  'scripts/check-rollback.js',
  'scripts/check-rto.js',
  'scripts/check-services.js',
  'scripts/check-supabase-cost.js',
  'scripts/check-vercel-cost.js',
  'scripts/collect-vitals.js',
  'scripts/generate-availability.js',
  'scripts/generate-dr-report.js',
  'scripts/lighthouse-check.js',
  'scripts/monitor-errors.js',
  'scripts/scan-secrets.js',
  'scripts/track-trends.js',
  'scripts/verify-backup-schedule.js',
  'scripts/verify-headers.js',
];

function addCheck(name, status, detail = {}) {
  checks.push({ name, status, ...detail });
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function cleanTarget(value) {
  return String(value || '')
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .replace(/[`,.;)]+$/g, '')
    .replace(/\\$/g, '');
}

function pathExists(target) {
  return existsSync(normalize(target));
}

function workflowFiles() {
  const dir = '.github/workflows';
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /\.ya?ml$/i.test(file))
    .sort()
    .map((file) => join(dir, file));
}

function packageScriptRefs(command) {
  const refs = [];
  const pattern = /npm\s+run(?:\s+--silent)?\s+([A-Za-z0-9:_-]+)/g;
  for (const match of command.matchAll(pattern)) {
    refs.push(match[1]);
  }
  return refs;
}

function localCommandTargets(command) {
  const targets = [];
  const patterns = [
    /\bnode(?:\s+--[^\s]+)*\s+((?:scripts|db)\/[^\s`"'|&;)]+)/g,
    /\bnpx\s+tsx\s+((?:scripts|db)\/[^\s`"'|&;)]+)/g,
    /\btsx\s+((?:scripts|db)\/[^\s`"'|&;)]+)/g,
    /\bpowershell(?:\.exe)?\b[^\n]*?\s-File\s+((?:scripts|db)\/[^\s`"'|&;)]+)/g,
  ];

  for (const pattern of patterns) {
    for (const match of command.matchAll(pattern)) {
      const target = cleanTarget(match[1]);
      if (target) targets.push(target);
    }
  }
  return [...new Set(targets)];
}

function generatedTargets(workflowText) {
  const targets = [];
  const pattern = /\bcat\s*>\s*((?:scripts|db)\/[^\s`"'|&;)]+)\s*<<\s*['"]?EOF['"]?/g;
  for (const match of workflowText.matchAll(pattern)) {
    const target = cleanTarget(match[1]);
    if (target) targets.push(target);
  }
  return new Set(targets);
}

function checkPackageScripts(packageJson) {
  const scriptNames = new Set(Object.keys(packageJson.scripts || {}));
  const missingNpmRefs = [];
  const missingTargets = [];

  for (const [scriptName, command] of Object.entries(packageJson.scripts || {})) {
    for (const ref of packageScriptRefs(command)) {
      if (!scriptNames.has(ref)) {
        missingNpmRefs.push({ script: scriptName, ref });
      }
    }

    for (const target of localCommandTargets(command)) {
      if (!pathExists(target)) {
        missingTargets.push({ script: scriptName, target });
      }
    }
  }

  addCheck(
    'package:scripts-reference-existing-scripts',
    missingNpmRefs.length === 0 ? 'pass' : 'fail',
    { missing: missingNpmRefs },
  );
  addCheck(
    'package:scripts-reference-existing-files',
    missingTargets.length === 0 ? 'pass' : 'fail',
    { missing: missingTargets },
  );
}

function checkWorkflowReferences(packageJson) {
  const scriptNames = new Set(Object.keys(packageJson.scripts || {}));
  const missingNpmRefs = [];
  const missingDirectTargets = [];
  const inlineGeneratedTargets = [];

  for (const workflow of workflowFiles()) {
    const text = readText(workflow);
    const generated = generatedTargets(text);

    for (const ref of packageScriptRefs(text)) {
      if (!scriptNames.has(ref)) {
        missingNpmRefs.push({ workflow, ref });
      }
    }

    for (const target of localCommandTargets(text)) {
      const generatedInWorkflow = generated.has(target);
      if (generatedInWorkflow) {
        inlineGeneratedTargets.push({ workflow, target });
      }
      if (pathExists(target)) continue;
      if (generatedInWorkflow) {
        continue;
      }
      missingDirectTargets.push({ workflow, target });
    }
  }

  addCheck(
    'workflow:npm-run-references-existing-scripts',
    missingNpmRefs.length === 0 ? 'pass' : 'fail',
    { missing: missingNpmRefs },
  );
  addCheck(
    'workflow:direct-local-command-targets-exist',
    missingDirectTargets.length === 0 ? 'pass' : 'fail',
    { missing: missingDirectTargets },
  );
  addCheck(
    'workflow:inline-generated-script-targets-inventoried',
    'pass',
    {
      count: inlineGeneratedTargets.length,
      generated: inlineGeneratedTargets,
      notes: inlineGeneratedTargets.length
        ? 'These workflow scripts are generated during the workflow run; prefer moving durable automation into versioned scripts.'
        : 'No inline-generated workflow scripts detected.',
    },
  );
}

function checkWorkflowNextOutputAssumptions() {
  const stale = [];
  const stalePatterns = [
    { token: 'du -sh build/', reason: 'Next.js writes production output to .next, not build/.' },
  ];

  for (const workflow of workflowFiles()) {
    const text = readText(workflow);
    for (const pattern of stalePatterns) {
      if (text.includes(pattern.token)) {
        stale.push({ workflow, token: pattern.token, reason: pattern.reason });
      }
    }
  }

  addCheck(
    'workflow:next-output-assumptions-current',
    stale.length === 0 ? 'pass' : 'fail',
    { stale },
  );
}

function checkWorkflowTeeStepsUsePipefail() {
  const missing = [];

  for (const workflow of workflowFiles()) {
    let parsed = null;
    try {
      parsed = yaml.load(readText(workflow));
    } catch {
      continue;
    }

    const jobs = parsed?.jobs && typeof parsed.jobs === 'object' ? parsed.jobs : {};
    for (const [jobName, job] of Object.entries(jobs)) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      for (const [index, step] of steps.entries()) {
        const run = String(step?.run || '');
        if (!/\|\s*tee\b/.test(run)) continue;
        if (/\bpipefail\b/.test(run)) continue;
        missing.push({
          workflow,
          job: jobName,
          step: step.name || `step-${index + 1}`,
          reason: 'Steps that pipe readiness commands through tee must enable pipefail so failed checks are not hidden.',
        });
      }
    }
  }

  addCheck(
    'workflow:tee-steps-use-pipefail',
    missing.length === 0 ? 'pass' : 'fail',
    { missing },
  );
}

function checkWorkflowExternalActionsPinned() {
  const floatingRefs = new Set(['main', 'master', 'latest', 'head']);
  const floating = [];

  for (const workflow of workflowFiles()) {
    let parsed = null;
    try {
      parsed = yaml.load(readText(workflow));
    } catch {
      continue;
    }

    const jobs = parsed?.jobs && typeof parsed.jobs === 'object' ? parsed.jobs : {};
    for (const [jobName, job] of Object.entries(jobs)) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      for (const [index, step] of steps.entries()) {
        const uses = String(step?.uses || '').trim();
        if (!uses || uses.startsWith('./') || uses.startsWith('docker://')) continue;

        const atIndex = uses.lastIndexOf('@');
        if (atIndex === -1) continue;
        const ref = uses.slice(atIndex + 1).toLowerCase();
        if (!floatingRefs.has(ref)) continue;

        floating.push({
          workflow,
          job: jobName,
          step: step.name || `step-${index + 1}`,
          uses,
          reason: 'External GitHub Actions must be pinned to an immutable commit SHA or a version tag, not a moving branch.',
        });
      }
    }
  }

  addCheck(
    'workflow:external-actions-pinned',
    floating.length === 0 ? 'pass' : 'fail',
    { floating },
  );
}

function combinedEnv(job, step) {
  return {
    ...(job?.env && typeof job.env === 'object' && !Array.isArray(job.env) ? job.env : {}),
    ...(step?.env && typeof step.env === 'object' && !Array.isArray(step.env) ? step.env : {}),
  };
}

function checkWorkflowNextBuildEnv() {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_BASE_URL',
  ];
  const missing = [];

  for (const workflow of workflowFiles()) {
    let parsed = null;
    try {
      parsed = yaml.load(readText(workflow));
    } catch {
      continue;
    }

    const jobs = parsed?.jobs && typeof parsed.jobs === 'object' ? parsed.jobs : {};
    for (const [jobName, job] of Object.entries(jobs)) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      for (const [index, step] of steps.entries()) {
        const run = String(step?.run || '');
        if (!/\bnpm\s+run\s+build\b/.test(run)) continue;
        const env = combinedEnv(job, step);
        const missingKeys = required.filter((key) => !(key in env));
        if (missingKeys.length > 0) {
          missing.push({
            workflow,
            job: jobName,
            step: step.name || `step-${index + 1}`,
            missing: missingKeys,
          });
        }
      }
    }
  }

  addCheck(
    'workflow:next-build-env-complete',
    missing.length === 0 ? 'pass' : 'fail',
    { missing },
  );
}

function checkWorkflowNextDevEnv() {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_BASE_URL',
  ];
  const missing = [];

  for (const workflow of workflowFiles()) {
    let parsed = null;
    try {
      parsed = yaml.load(readText(workflow));
    } catch {
      continue;
    }

    const jobs = parsed?.jobs && typeof parsed.jobs === 'object' ? parsed.jobs : {};
    for (const [jobName, job] of Object.entries(jobs)) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      for (const [index, step] of steps.entries()) {
        const run = String(step?.run || '');
        if (!/\bnpm\s+run\s+dev\b/.test(run)) continue;
        const env = combinedEnv(job, step);
        const missingKeys = required.filter((key) => !(key in env));
        if (missingKeys.length > 0) {
          missing.push({
            workflow,
            job: jobName,
            step: step.name || `step-${index + 1}`,
            missing: missingKeys,
          });
        }
      }
    }
  }

  addCheck(
    'workflow:next-dev-env-complete',
    missing.length === 0 ? 'pass' : 'fail',
    { missing },
  );
}

function permissionValue(permissions, key) {
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) return '';
  return String(permissions[key] || '').toLowerCase();
}

function hasWritePermission(workflowPermissions, jobPermissions, key) {
  return permissionValue(jobPermissions, key) === 'write' || permissionValue(workflowPermissions, key) === 'write';
}

function stepContinueOnError(step) {
  return step?.['continue-on-error'] === true || step?.['continue-on-error'] === 'true';
}

function workflowTriggers(parsed) {
  const rawOn = parsed?.on || parsed?.true;
  if (typeof rawOn === 'string') return new Set([rawOn]);
  if (Array.isArray(rawOn)) return new Set(rawOn.map(String));
  if (rawOn && typeof rawOn === 'object') return new Set(Object.keys(rawOn).map(String));
  return new Set();
}

function referencedGithubEvents(value) {
  const text = String(value || '');
  const events = new Set();
  const patterns = [
    /github\.event_name\s*==\s*['"]([^'"]+)['"]/g,
    /github\.event_name\s*!=\s*['"]([^'"]+)['"]/g,
    /github\.eventName\s*===\s*['"]([^'"]+)['"]/g,
    /github\.eventName\s*!==\s*['"]([^'"]+)['"]/g,
    /context\.eventName\s*===\s*['"]([^'"]+)['"]/g,
    /context\.eventName\s*!==\s*['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      events.add(match[1]);
    }
  }
  return [...events].sort();
}

function checkWorkflowReferencedEventTriggers() {
  const missing = [];

  for (const workflow of workflowFiles()) {
    let parsed = null;
    try {
      parsed = yaml.load(readText(workflow));
    } catch {
      continue;
    }

    const triggers = workflowTriggers(parsed);
    const jobs = parsed?.jobs && typeof parsed.jobs === 'object' ? parsed.jobs : {};
    for (const [jobName, job] of Object.entries(jobs)) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      for (const [index, step] of steps.entries()) {
        const refs = new Set([
          ...referencedGithubEvents(step?.if),
          ...referencedGithubEvents(step?.with?.script),
          ...referencedGithubEvents(step?.run),
        ]);
        for (const eventName of refs) {
          if (triggers.has(eventName)) continue;
          missing.push({
            workflow,
            job: jobName,
            step: step.name || `step-${index + 1}`,
            eventName,
            triggers: [...triggers].sort(),
          });
        }
      }
    }
  }

  addCheck(
    'workflow:referenced-events-have-triggers',
    missing.length === 0 ? 'pass' : 'fail',
    { missing },
  );
}

function checkScheduledReadinessWorkflowsStrict() {
  const missing = [];
  const readinessScriptPattern = /\bnpm\s+run\s+(verify:all|verify:local-release|verify:marketing-release)\b/;

  for (const workflow of workflowFiles()) {
    let parsed = null;
    try {
      parsed = yaml.load(readText(workflow));
    } catch {
      continue;
    }

    if (!workflowTriggers(parsed).has('schedule')) continue;

    const jobs = parsed?.jobs && typeof parsed.jobs === 'object' ? parsed.jobs : {};
    for (const [jobName, job] of Object.entries(jobs)) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      for (const [index, step] of steps.entries()) {
        const run = String(step?.run || '');
        const match = run.match(readinessScriptPattern);
        if (!match) continue;
        const hasStrict = run.includes('--strict');
        const handlesSchedule = /github\.event_name[^]*schedule/.test(run);
        if (hasStrict && handlesSchedule) continue;

        missing.push({
          workflow,
          job: jobName,
          step: step.name || `step-${index + 1}`,
          script: match[1],
          missing: [
            ...(!handlesSchedule ? ['schedule event branch'] : []),
            ...(!hasStrict ? ['--strict'] : []),
          ],
          reason: 'Scheduled readiness workflows must fail on blocked checks so production/staging gaps are not silently green.',
        });
      }
    }
  }

  addCheck(
    'workflow:scheduled-readiness-runs-strict',
    missing.length === 0 ? 'pass' : 'fail',
    { missing },
  );
}

function checkWorkflowGithubScriptWriteGuards() {
  const missing = [];

  for (const workflow of workflowFiles()) {
    let parsed = null;
    try {
      parsed = yaml.load(readText(workflow));
    } catch {
      continue;
    }

    const workflowPermissions = parsed?.permissions;
    const jobs = parsed?.jobs && typeof parsed.jobs === 'object' ? parsed.jobs : {};
    for (const [jobName, job] of Object.entries(jobs)) {
      const jobPermissions = job?.permissions;
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      for (const [index, step] of steps.entries()) {
        if (!String(step?.uses || '').includes('actions/github-script')) continue;
        const script = String(step?.with?.script || '');
        const needsPullRequestWrite = /github\.rest\.pulls\./.test(script);
        const needsIssuesWrite = /github\.rest\.issues\./.test(script);
        if (!needsPullRequestWrite && !needsIssuesWrite) continue;

        const missingPermissions = [];
        if (needsPullRequestWrite && !hasWritePermission(workflowPermissions, jobPermissions, 'pull-requests')) {
          missingPermissions.push('pull-requests: write');
        }
        if (needsIssuesWrite && !hasWritePermission(workflowPermissions, jobPermissions, 'issues')) {
          missingPermissions.push('issues: write');
        }

        if (missingPermissions.length > 0 || !stepContinueOnError(step)) {
          missing.push({
            workflow,
            job: jobName,
            step: step.name || `step-${index + 1}`,
            missingPermissions,
            missingContinueOnError: !stepContinueOnError(step),
          });
        }
      }
    }
  }

  addCheck(
    'workflow:github-script-write-guards',
    missing.length === 0 ? 'pass' : 'fail',
    { missing },
  );
}

function checkWorkflowGithubScriptSyntax() {
  const invalid = [];

  for (const workflow of workflowFiles()) {
    let parsed = null;
    try {
      parsed = yaml.load(readText(workflow));
    } catch {
      continue;
    }

    const jobs = parsed?.jobs && typeof parsed.jobs === 'object' ? parsed.jobs : {};
    for (const [jobName, job] of Object.entries(jobs)) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      for (const [index, step] of steps.entries()) {
        if (!String(step?.uses || '').includes('actions/github-script')) continue;
        const source = String(step?.with?.script || '');
        if (!source.trim()) continue;

        const result = ts.transpileModule(source, {
          fileName: `${workflow}#${jobName}:${step.name || `step-${index + 1}`}.js`,
          reportDiagnostics: true,
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            allowJs: true,
          },
        });
        const errors = (result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
        if (errors.length > 0) {
          invalid.push({
            workflow,
            job: jobName,
            step: step.name || `step-${index + 1}`,
            error: errors
              .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
              .join('; ')
              .slice(0, 1200),
          });
        }
      }
    }
  }

  addCheck(
    'workflow:github-script-syntax',
    invalid.length === 0 ? 'pass' : 'fail',
    { invalid },
  );
}

function inlineNodeScripts(run) {
  const scripts = [];
  const text = String(run || '');
  const pattern = /\bnode\s+(?:-\s+)?<<\s*['"]?([A-Za-z_][A-Za-z0-9_-]*)['"]?\s*\r?\n([\s\S]*?)\r?\n\s*\1\b/g;
  for (const match of text.matchAll(pattern)) {
    scripts.push({ delimiter: match[1], source: match[2] });
  }
  return scripts;
}

function checkWorkflowInlineNodeScriptSyntax() {
  const invalid = [];
  let checked = 0;

  for (const workflow of workflowFiles()) {
    let parsed = null;
    try {
      parsed = yaml.load(readText(workflow));
    } catch {
      continue;
    }

    const jobs = parsed?.jobs && typeof parsed.jobs === 'object' ? parsed.jobs : {};
    for (const [jobName, job] of Object.entries(jobs)) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      for (const [index, step] of steps.entries()) {
        for (const [scriptIndex, script] of inlineNodeScripts(step?.run).entries()) {
          checked += 1;
          const result = ts.transpileModule(script.source, {
            fileName: `${workflow}#${jobName}:${step.name || `step-${index + 1}`}:inline-node-${scriptIndex + 1}.js`,
            reportDiagnostics: true,
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.CommonJS,
              allowJs: true,
            },
          });
          const errors = (result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
          if (errors.length > 0) {
            invalid.push({
              workflow,
              job: jobName,
              step: step.name || `step-${index + 1}`,
              delimiter: script.delimiter,
              error: errors
                .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
                .join('; ')
                .slice(0, 1200),
            });
          }
        }
      }
    }
  }

  addCheck(
    'workflow:inline-node-script-syntax',
    invalid.length === 0 ? 'pass' : 'fail',
    { checked, invalid },
  );
}

function checkWorkflowYamlSyntax() {
  const invalid = [];

  for (const workflow of workflowFiles()) {
    try {
      const parsed = yaml.load(readText(workflow));
      if (!parsed || typeof parsed !== 'object') {
        invalid.push({ workflow, error: 'workflow did not parse to an object' });
        continue;
      }
      if (!parsed.name) invalid.push({ workflow, error: 'missing name' });
      if (!parsed.on && !parsed.true) invalid.push({ workflow, error: 'missing on trigger' });
      if (!parsed.jobs || typeof parsed.jobs !== 'object') {
        invalid.push({ workflow, error: 'missing jobs' });
      }
    } catch (err) {
      invalid.push({ workflow, error: err instanceof Error ? err.message : String(err) });
    }
  }

  addCheck(
    'workflow:yaml-syntax',
    invalid.length === 0 ? 'pass' : 'fail',
    { invalid },
  );
}

function addTarget(targets, target, source) {
  if (!pathExists(target)) return;
  if (!targets.has(target)) targets.set(target, new Set());
  targets.get(target).add(source);
}

function nodeCheckable(target) {
  return /\.(?:cjs|mjs|js)$/i.test(target);
}

function typeScriptCheckable(target) {
  return /\.(?:cts|mts|ts|tsx)$/i.test(target);
}

function checkLocalScriptSyntax(packageJson) {
  const targets = new Map();

  for (const [scriptName, command] of Object.entries(packageJson.scripts || {})) {
    for (const target of localCommandTargets(command)) {
      addTarget(targets, target, `package:${scriptName}`);
    }
  }

  for (const workflow of workflowFiles()) {
    const text = readText(workflow);
    for (const target of localCommandTargets(text)) {
      addTarget(targets, target, `workflow:${workflow}`);
    }
  }

  const invalid = [];
  for (const [target, sources] of targets.entries()) {
    if (!nodeCheckable(target)) continue;
    const result = spawnSync(process.execPath, ['--check', target], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: localScriptSyntaxTimeoutMs,
      windowsHide: true,
    });
    const timedOut = result.error?.code === 'ETIMEDOUT';
    if (result.status !== 0 || timedOut) {
      invalid.push({
        target,
        sources: [...sources].sort(),
        timedOut,
        timeoutMs: localScriptSyntaxTimeoutMs,
        error: timedOut
          ? `node syntax check timed out after ${localScriptSyntaxTimeoutMs}ms`
          : (result.stderr || result.stdout || result.error?.message || '').trim().slice(0, 1200),
      });
    }
  }

  addCheck(
    'local-script:node-syntax',
    invalid.length === 0 ? 'pass' : 'fail',
    { invalid, checked: [...targets.keys()].filter(nodeCheckable).sort().length },
  );

  const tsInvalid = [];
  for (const [target, sources] of targets.entries()) {
    if (!typeScriptCheckable(target)) continue;
    const source = readText(target);
    const result = ts.transpileModule(source, {
      fileName: target,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });
    const errors = (result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    if (errors.length > 0) {
      tsInvalid.push({
        target,
        sources: [...sources].sort(),
        error: errors
          .map((diagnostic) => {
            const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
            return diagnostic.start === undefined ? message : `${message} @${diagnostic.start}`;
          })
          .join('; ')
          .slice(0, 1200),
      });
    }
  }

  addCheck(
    'local-script:typescript-syntax',
    tsInvalid.length === 0 ? 'pass' : 'fail',
    { invalid: tsInvalid, checked: [...targets.keys()].filter(typeScriptCheckable).sort().length },
  );
}

function checkWorkflowHelperSmoke() {
  const smokeDir = resolve('.tmp', `workflow-helper-smoke-${process.pid}-${Date.now()}`);
  mkdirSync(smokeDir, { recursive: true });

  const env = {
    ...process.env,
    MONITOR_HEALTH_ENDPOINTS: '[]',
    INTEGRITY_CHECKS_JSON: JSON.stringify([{ name: 'smoke', status: 'pass' }]),
    SUPABASE_URL: '',
    NEXT_PUBLIC_SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    FORCE_COLOR: '0',
  };

  const failed = [];
  try {
    for (const target of workflowHelperSmokeTargets) {
      if (!pathExists(target)) {
        failed.push({ target, error: 'script is missing' });
        continue;
      }
      const result = spawnSync(process.execPath, [resolve(target)], {
        cwd: smokeDir,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: workflowSmokeTimeoutMs,
        windowsHide: true,
      });
      const timedOut = result.error?.code === 'ETIMEDOUT';
      if (result.status !== 0 || timedOut) {
        failed.push({
          target,
          exitCode: result.status,
          timedOut,
          timeoutMs: workflowSmokeTimeoutMs,
          error: timedOut
            ? `workflow helper smoke timed out after ${workflowSmokeTimeoutMs}ms`
            : (result.stderr || result.stdout || result.error?.message || '').trim().slice(0, 1200),
        });
      }
    }
  } finally {
    rmSync(smokeDir, { recursive: true, force: true });
  }

  addCheck(
    'local-script:workflow-helper-smoke',
    failed.length === 0 ? 'pass' : 'fail',
    { checked: workflowHelperSmokeTargets.length, failed },
  );
}

function checkCriticalAutomationTimeoutContracts() {
  const contracts = [
    {
      file: 'scripts/run-with-vercel-env.mjs',
      needles: [
        'VERCEL_ENV_PULL_TIMEOUT_MS',
        'VERCEL_ENV_COMMAND_TIMEOUT_MS',
        'const wrapperArgs',
        "argValue(wrapperArgs, '--command-timeout-ms'",
        'Unknown wrapper argument',
        'Vercel env pull timed out after',
        'Child command timed out after',
        'timedOut',
      ],
    },
    {
      file: 'scripts/verify-product-registration-learning-engine.mjs',
      needles: [
        'PRODUCT_REGISTRATION_LEARNING_VERIFY_COMMAND_TIMEOUT_MS',
        '--command-timeout-ms',
        'Verification timed out at',
        'ETIMEDOUT',
      ],
    },
    {
      file: 'scripts/run-product-registration-mobile-quality-engine.ts',
      needles: [
        'PRODUCT_MOBILE_QUALITY_COMMAND_TIMEOUT_MS',
        'unknown argument',
        '--command-timeout-ms must be a positive number of milliseconds.',
        'timed out after',
        'timeout: commandTimeoutMs',
      ],
    },
    {
      file: 'scripts/verify-jarvis-readiness.ts',
      needles: [
        'JARVIS_READINESS_COMMAND_TIMEOUT_MS',
        'commandTimeoutMs',
        'command timed out after',
        'timedOut',
        'durationMs',
      ],
    },
    {
      file: 'scripts/verify-operational-apply-scripts.mjs',
      needles: [
        'OPERATIONAL_APPLY_VERIFY_COMMAND_TIMEOUT_MS',
        'unknown operational apply scripts argument',
        '--command-timeout-ms must be a positive number of milliseconds.',
        'command timed out after',
        'commandTimeoutMs',
      ],
    },
    {
      file: 'scripts/verify-operational-readiness-inputs.mjs',
      needles: [
        'OPERATIONAL_APPLY_COMMAND_TIMEOUT_MS',
        'timeout: commandTimeoutMs',
        'Command timed out after',
        'process.exit(124)',
      ],
    },
    {
      file: 'scripts/verify-all-readiness.mjs',
      needles: [
        'VERIFY_ALL_STAGE_TIMEOUT_MS',
        'VERIFY_ALL_COMMAND_TIMEOUT_MS',
        'cleanupTimedOutStageProcesses',
        'taskkill.exe',
        'stage timed out after',
        'timedOut',
      ],
    },
    {
      file: 'scripts/verify-local-release-readiness.mjs',
      needles: [
        'LOCAL_RELEASE_COMMAND_TIMEOUT_MS',
        'open-readiness-local-full',
        '`--command-timeout-ms=${commandTimeoutMs}`',
        '`--marketing-runtime-command-timeout-ms=${commandTimeoutMs}`',
        '`--marketing-runtime-hard-timeout-ms=${',
        'command timed out after',
        'timedOut',
      ],
    },
    {
      file: 'scripts/verify-open-readiness-local.mjs',
      needles: [
        'OPEN_READINESS_LOCAL_COMMAND_TIMEOUT_MS',
        '--command-timeout-ms',
        'open readiness command timed out after',
        'ETIMEDOUT',
      ],
    },
    {
      file: 'scripts/verify-marketing-runtime-local.mjs',
      needles: [
        'MARKETING_RUNTIME_COMMAND_TIMEOUT_MS',
        '--command-timeout-ms',
        'marketing readiness command timed out after',
        'ETIMEDOUT',
      ],
    },
  ];

  const missing = [];
  for (const contract of contracts) {
    if (!pathExists(contract.file)) {
      missing.push({ file: contract.file, missing: ['file missing'] });
      continue;
    }
    const text = readText(contract.file);
    const missingNeedles = contract.needles.filter((needle) => !text.includes(needle));
    if (missingNeedles.length > 0) {
      missing.push({ file: contract.file, missing: missingNeedles });
    }
  }

  addCheck(
    'automation:critical-command-timeouts',
    missing.length === 0 ? 'pass' : 'fail',
    { checked: contracts.length, missing },
  );
}

function listProjectFiles(root, predicate = () => true) {
  const files = [];
  if (!existsSync(root)) return files;

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const target = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.next')) continue;
        walk(target);
      } else if (entry.isFile() && predicate(target, entry)) {
        files.push(target.replace(/\\/g, '/'));
      }
    }
  }

  walk(root);
  return files.sort();
}

function appRouteFromConventionFile(file, convention) {
  const pattern = convention === 'api' ? /\/route\.tsx?$/ : /\/page\.tsx?$/;
  const relativePath = file.replace(/^src\/app\//, '').replace(pattern, '');
  const segments = relativePath
    .split('/')
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    .filter((segment) => !segment.startsWith('@'));
  return `/${segments.join('/')}`;
}

function routePattern(route) {
  if (route === '/') return /^\/$/;
  const segments = route.split('/').filter(Boolean).map((segment) => {
    if (/^\[\[\.\.\..+\]\]$/.test(segment)) return '.*';
    if (/^\[\.\.\..+\]$/.test(segment)) return '.+';
    if (/^\[.+\]$/.test(segment)) return '[^/]+';
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp(`^/${segments.join('/')}/?$`);
}

function normalizeInternalReference(raw) {
  const withoutTemplateExpressions = String(raw || '').replace(/\$\{[^}]+\}/g, (_match, offset, full) => (
    full[offset - 1] === '/' ? '[dynamic]' : ''
  ));
  const withoutQuery = withoutTemplateExpressions.split('?')[0].split('#')[0];
  return withoutQuery.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function collectAppRouteReferences() {
  const sourceFiles = listProjectFiles('src', (file) => (
    /\.(?:ts|tsx)$/.test(file) &&
    !/\.test\./.test(file) &&
    !/\.spec\./.test(file) &&
    !file.includes('/__tests__/')
  ));
  const references = [];

  function add(kind, file, raw) {
    const route = normalizeInternalReference(raw);
    if (!route.startsWith('/')) return;
    if (/\.[A-Za-z0-9]{2,5}$/.test(route)) return;
    if (
      kind === 'page' &&
      /^\/(?:api|_next|static|images|icons|favicon|robots|sitemap|manifest)(?:\/|$)/.test(route)
    ) {
      return;
    }
    references.push({ kind, route, file });
  }

  const quotedApiPatterns = [
    /fetch\(\s*(['"])(\/api\/[^'"?#)]+)(?:[^'"]*)\1/g,
    /new\s+URL\(\s*(['"])(\/api\/[^'"?#)]+)(?:[^'"]*)\1/g,
  ];
  const templateApiPatterns = [
    /fetch\(\s*`([^`]+)`/g,
    /new\s+URL\(\s*`([^`]+)`/g,
  ];
  const quotedPagePatterns = [
    /href=\{?\s*(['"])(\/[^'"?#\s]+)(?:[^'"]*)\1/g,
    /router\.(?:push|replace|prefetch)\(\s*(['"])(\/[^'"?#\s]+)(?:[^'"]*)\1/g,
    /(?:redirect|permanentRedirect)\(\s*(['"])(\/[^'"?#\s]+)(?:[^'"]*)\1/g,
    /\bhref\s*:\s*(['"])(\/[^'"?#\s]+)(?:[^'"]*)\1/g,
  ];
  const templatePagePatterns = [
    /href=\{?\s*`([^`]+)`/g,
    /router\.(?:push|replace|prefetch)\(\s*`([^`]+)`/g,
    /(?:redirect|permanentRedirect)\(\s*`([^`]+)`/g,
    /\bhref\s*:\s*`([^`]+)`/g,
  ];

  for (const file of sourceFiles) {
    const source = readText(file);
    for (const pattern of quotedApiPatterns) {
      for (const match of source.matchAll(pattern)) add('api', file, match[2]);
    }
    for (const pattern of templateApiPatterns) {
      for (const match of source.matchAll(pattern)) {
        if (match[1].startsWith('/api/')) add('api', file, match[1]);
      }
    }
    for (const pattern of quotedPagePatterns) {
      for (const match of source.matchAll(pattern)) add('page', file, match[2]);
    }
    for (const pattern of templatePagePatterns) {
      for (const match of source.matchAll(pattern)) {
        if (match[1].startsWith('/')) add('page', file, match[1]);
      }
    }
  }

  return [...new Map(references.map((ref) => [`${ref.kind}:${ref.route}:${ref.file}`, ref])).values()]
    .sort((a, b) => `${a.kind}:${a.route}:${a.file}`.localeCompare(`${b.kind}:${b.route}:${b.file}`));
}

function checkAppRouteReferences() {
  const pageRoutes = listProjectFiles('src/app', (_file, entry) => entry.name === 'page.ts' || entry.name === 'page.tsx')
    .map((file) => ({ file, route: appRouteFromConventionFile(file, 'page') }));
  const apiRoutes = listProjectFiles('src/app', (_file, entry) => entry.name === 'route.ts' || entry.name === 'route.tsx')
    .map((file) => ({ file, route: appRouteFromConventionFile(file, 'api') }));
  const pagePatterns = pageRoutes.map((item) => ({ ...item, pattern: routePattern(item.route) }));
  const apiPatterns = apiRoutes.map((item) => ({ ...item, pattern: routePattern(item.route) }));
  const references = collectAppRouteReferences();
  const missing = references.filter((ref) => {
    const patterns = ref.kind === 'api' ? apiPatterns : pagePatterns;
    return !patterns.some((item) => item.pattern.test(ref.route));
  });

  addCheck(
    'app-route:literal-internal-references',
    missing.length === 0 ? 'pass' : 'fail',
    {
      checked: references.length,
      pages: pageRoutes.length,
      apiRoutes: apiRoutes.length,
      missing,
    },
  );
}

const packageJson = readJson('package.json');
checkPackageScripts(packageJson);
checkWorkflowYamlSyntax();
checkWorkflowReferences(packageJson);
checkWorkflowNextOutputAssumptions();
checkWorkflowTeeStepsUsePipefail();
checkWorkflowExternalActionsPinned();
checkWorkflowNextBuildEnv();
checkWorkflowNextDevEnv();
checkWorkflowReferencedEventTriggers();
checkScheduledReadinessWorkflowsStrict();
checkWorkflowGithubScriptWriteGuards();
checkWorkflowGithubScriptSyntax();
checkWorkflowInlineNodeScriptSyntax();
checkLocalScriptSyntax(packageJson);
checkWorkflowHelperSmoke();
checkCriticalAutomationTimeoutContracts();
checkAppRouteReferences();

const failed = checks.filter((check) => check.status === 'fail');
const report = {
  status: failed.length === 0 ? 'pass' : 'fail',
  passed: checks.filter((check) => check.status === 'pass').length,
  failed: failed.length,
  warnings: checks.reduce((sum, check) => sum + Number(check.count || 0), 0),
  localScriptSyntaxTimeoutMs,
  workflowSmokeTimeoutMs,
  checks,
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const check of checks) {
    const suffix = check.missing?.length
      ? ` missing=${check.missing.length}`
      : check.count
        ? ` generated=${check.count}`
        : '';
    console.log(`${check.status.toUpperCase()} ${check.name}${suffix}`);
  }
}

if (failed.length > 0) process.exit(1);
