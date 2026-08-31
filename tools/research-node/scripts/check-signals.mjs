import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { validateSignalReport } from './signal-utils.mjs';

const input = process.argv.find((item) => item.startsWith('--input='))?.slice('--input='.length)
  ?? 'outputs/signals.json';
const previous = process.argv.find((item) => item.startsWith('--previous='))?.slice('--previous='.length);
const report = JSON.parse(await readFile(resolve(input), 'utf8'));
const signals = Array.isArray(report.signals) ? report.signals : [];
const previousReport = previous ? JSON.parse(await readFile(resolve(previous), 'utf8')) : null;
const failures = validateSignalReport(report, { previousReport });

console.log(JSON.stringify({ ok: failures.length === 0, signalCount: signals.length, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
