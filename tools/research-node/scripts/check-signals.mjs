import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { validateSignal } from './signal-utils.mjs';

const input = process.argv.find((item) => item.startsWith('--input='))?.slice('--input='.length)
  ?? 'outputs/signals.json';
const report = JSON.parse(await readFile(resolve(input), 'utf8'));
const signals = Array.isArray(report.signals) ? report.signals : [];
const failures = signals.flatMap((signal) => validateSignal(signal).map((code) => `${signal?.collectorMeta?.sourceId ?? 'unknown'}:${code}`));
if (signals.length === 0) failures.push('no_signals');

console.log(JSON.stringify({ ok: failures.length === 0, signalCount: signals.length, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
