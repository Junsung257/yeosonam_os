import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { intakePayload, validateIntakeEndpoint, validateSignalReport } from './signal-utils.mjs';

const input = process.argv.find((item) => item.startsWith('--input='))?.slice('--input='.length)
  ?? 'outputs/signals.json';
const endpointValue = process.env.RESEARCH_INTAKE_URL ?? '';
const endpoint = validateIntakeEndpoint(endpointValue);
const token = process.env.RESEARCH_NODE_INGEST_TOKEN ?? '';
if (token.length < 32) throw new Error('RESEARCH_NODE_INGEST_TOKEN must contain at least 32 characters');

const report = JSON.parse(await readFile(resolve(input), 'utf8'));
const signals = Array.isArray(report.signals) ? report.signals : [];
const reportFailures = validateSignalReport(report);
if (reportFailures.length > 0) {
  throw new Error(`signal report failed local checks: ${reportFailures.join(',')}`);
}

for (const signal of signals) {
  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
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
