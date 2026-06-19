#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const rawArgs = process.argv.slice(2);
const json = rawArgs.includes('--json');
const envFile = rawArgs.find((arg) => !arg.startsWith('--')) || '';
const githubEnvPath = process.env.GITHUB_ENV || '';

function fail(message) {
  const report = { status: 'fail', exported: 0, error: message };
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.error(message);
  process.exit(1);
}

function parseEnvLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
  const equalIndex = normalized.indexOf('=');
  if (equalIndex <= 0) return null;
  const key = normalized.slice(0, equalIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  let value = normalized.slice(equalIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  value = value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"');
  return [key, value];
}

if (!envFile) fail('Usage: node scripts/export-env-file-to-github-env.mjs <env-file>');
if (!existsSync(envFile)) fail(`Env file not found: ${envFile}`);
if (!githubEnvPath) fail('GITHUB_ENV is not set.');

const entries = [];
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const parsed = parseEnvLine(line);
  if (!parsed) continue;
  const [key, value] = parsed;
  if (!String(value || '').trim()) continue;
  entries.push([key, value]);
}

for (const [key, value] of entries) {
  const marker = `ENV_${key}_${randomBytes(6).toString('hex')}`;
  appendFileSync(githubEnvPath, `${key}<<${marker}\n${value}\n${marker}\n`);
}

const report = {
  status: 'pass',
  exported: entries.length,
  keys: entries.map(([key]) => key).sort(),
};

if (json) console.log(JSON.stringify(report, null, 2));
else console.log(`Exported ${entries.length} env values to GITHUB_ENV.`);
