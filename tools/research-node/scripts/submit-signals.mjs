import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { intakePayload, validateIntakeEndpoint, validateSignal } from './signal-utils.mjs';

const input = process.argv.find((item) => item.startsWith('--input='))?.slice('--input='.length)
  ?? 'outputs/signals.json';
const endpointValue = process.env.RESEARCH_INTAKE_URL ?? '';
const endpoint = validateIntakeEndpoint(endpointValue);
const token = process.env.RESEARCH_NODE_INGEST_TOKEN ?? '';
if (token.length < 32) throw new Error('RESEARCH_NODE_INGEST_TOKEN must contain at least 32 characters');

const report = JSON.parse(await readFile(resolve(input), 'utf8'));
const signals = Array.isArray(report.signals) ? report.signals : [];
if (signals.length === 0) throw new Error('no signals to submit');

for (const signal of signals) {
  const failures = validateSignal(signal);
  if (failures.length > 0) throw new Error(`signal failed local checks: ${failures.join(',')}`);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(intakePayload(signal)),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`intake failed (${response.status}): ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ source: signal.collectorMeta.sourceId, status: response.status, result }));
}
