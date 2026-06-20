#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const jsonOutput = args.has('--json');
const selfTest = args.has('--self-test');
const configPath = 'playwright.ux-smoke.config.ts';
const testDir = 'tests/ux-smoke';
const criticalRoutesPath = 'tests/ux-smoke/critical-routes.spec.ts';
const keyboardPath = 'tests/ux-smoke/keyboard.spec.ts';

const criticalRoutes = [
  '/',
  '/packages',
  '/concierge',
  '/group-inquiry',
  '/admin',
  '/admin/bookings',
  '/admin/packages',
  '/admin/payments',
];

const viewportMarkers = [
  'viewport: { width: 375, height: 812 }',
  'viewport: { width: 768, height: 1024 }',
  'viewport: { width: 1440, height: 1000 }',
];

const criticalAssertions = [
  'collectRuntimeErrors',
  'expectNoHorizontalOverflow',
  'expectAccessibleInteractiveNames',
  'captureScreenshotEvidence',
  'screenshotSignal',
  'hasVisualSignal',
];

const keyboardCoverageMarkers = [
  'package list mobile sticky CTA exposes handoff summary',
  'concierge mobile cart sheet opens from keyboard and exposes dialog state',
  'group inquiry ready summary moves keyboard users into RFQ contact actions',
  'admin dashboard today work and command links are keyboard focusable',
  'admin payment command bar opens, focuses input, and closes with keyboard',
];

function makeReport({ status, passed, failed, notes = '', checks = [] }) {
  return {
    status,
    passed,
    blocked: 0,
    failed,
    total: checks.length || 1,
    checks: checks.length > 0 ? checks : [
      {
        id: 'ux-smoke',
        name: 'Playwright UX smoke routes',
        status,
        notes,
      },
    ],
  };
}

const allowedArgs = new Set(['--json', '--self-test']);
const invalidArgs = rawArgs.filter((arg) => arg.startsWith('--') && !allowedArgs.has(arg));
if (invalidArgs.length > 0) {
  const report = makeReport({
    status: 'fail',
    passed: 0,
    failed: 1,
    notes: `unknown verify:ux-smoke argument: ${invalidArgs.join(', ')}`,
  });
  if (jsonOutput) console.log(JSON.stringify(report, null, 2));
  else console.error(report.checks[0].notes);
  process.exit(1);
}

if (selfTest) {
  const checks = buildSelfTestChecks();
  const failed = checks.filter((check) => check.status === 'fail').length;
  const report = makeReport({
    status: failed > 0 ? 'fail' : 'pass',
    passed: checks.length - failed,
    failed,
    checks,
  });
  if (jsonOutput) console.log(JSON.stringify(report, null, 2));
  else {
    for (const check of checks) {
      console.log(`${check.status.toUpperCase()} ${check.id}${check.notes ? ` - ${check.notes}` : ''}`);
    }
  }
  process.exit(report.failed > 0 ? 1 : 0);
}

const result = spawnSync(process.execPath, [
  './node_modules/playwright/cli.js',
  'test',
  '-c',
  configPath,
], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 40 * 1024 * 1024,
  windowsHide: true,
});

const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
const failed = result.status === 0 ? 0 : 1;
const report = makeReport({
  status: failed > 0 ? 'fail' : 'pass',
  passed: failed > 0 ? 0 : 1,
  failed,
  notes: output.slice(0, 1600),
});

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else if (output) {
  console.log(output);
} else {
  console.log('PASS verify:ux-smoke');
}

process.exit(failed > 0 ? 1 : 0);

function buildSelfTestChecks() {
  const configSource = readIfExists(configPath);
  const criticalRoutesSource = readIfExists(criticalRoutesPath);
  const keyboardSource = readIfExists(keyboardPath);
  const files = [
    configPath,
    testDir,
    criticalRoutesPath,
    keyboardPath,
    './node_modules/playwright/cli.js',
  ];
  const missingFiles = files.filter((filePath) => !existsSync(filePath));

  return [
    {
      id: 'ux-smoke-files',
      name: 'UX smoke files and Playwright CLI are present',
      status: missingFiles.length > 0 ? 'fail' : 'pass',
      missing: missingFiles,
      notes: missingFiles.length > 0 ? `missing: ${missingFiles.join(', ')}` : 'all required files exist',
    },
    markerCheck({
      id: 'ux-smoke-critical-routes',
      name: 'public and admin critical routes are covered',
      source: criticalRoutesSource,
      markers: criticalRoutes.map((route) => `'${route}'`),
    }),
    markerCheck({
      id: 'ux-smoke-viewports',
      name: 'mobile, tablet, and desktop viewports are configured',
      source: configSource,
      markers: viewportMarkers,
    }),
    markerCheck({
      id: 'ux-smoke-critical-assertions',
      name: 'critical route tests check runtime errors, overflow, names, and screenshots',
      source: criticalRoutesSource,
      markers: criticalAssertions,
    }),
    markerCheck({
      id: 'ux-smoke-keyboard-coverage',
      name: 'keyboard smoke covers conversion and admin workflows',
      source: keyboardSource,
      markers: keyboardCoverageMarkers,
    }),
  ];
}

function readIfExists(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function markerCheck({ id, name, source, markers }) {
  const missing = markers.filter((marker) => !source.includes(marker));
  return {
    id,
    name,
    status: missing.length > 0 ? 'fail' : 'pass',
    missing,
    notes: missing.length > 0 ? `missing markers: ${missing.join(', ')}` : '',
  };
}
