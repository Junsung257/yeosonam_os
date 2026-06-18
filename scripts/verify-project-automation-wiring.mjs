#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, normalize, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const ts = require('typescript');

const args = new Set(process.argv.slice(2));
const json = args.has('--json');

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
      windowsHide: true,
    });
    if (result.status !== 0) {
      invalid.push({
        target,
        sources: [...sources].sort(),
        error: (result.stderr || result.stdout || result.error?.message || '').trim().slice(0, 1200),
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
        timeout: 30000,
        windowsHide: true,
      });
      if (result.status !== 0) {
        failed.push({
          target,
          exitCode: result.status,
          error: (result.stderr || result.stdout || result.error?.message || '').trim().slice(0, 1200),
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

const packageJson = readJson('package.json');
checkPackageScripts(packageJson);
checkWorkflowYamlSyntax();
checkWorkflowReferences(packageJson);
checkLocalScriptSyntax(packageJson);
checkWorkflowHelperSmoke();

const failed = checks.filter((check) => check.status === 'fail');
const report = {
  status: failed.length === 0 ? 'pass' : 'fail',
  passed: checks.filter((check) => check.status === 'pass').length,
  failed: failed.length,
  warnings: checks.reduce((sum, check) => sum + Number(check.count || 0), 0),
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
