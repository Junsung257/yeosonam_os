import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const contracts = JSON.parse(readFileSync(resolve(root, 'evals/harness/contracts.json'), 'utf8'));

export function runContract(id) {
  const contract = contracts.find((item) => item.id === id);
  if (!contract) return { pass: false, id, reason: 'unknown contract' };
  const missingFiles = contract.files.filter((path) => !existsSync(resolve(root, path)));
  const text = contract.files.filter((path) => existsSync(resolve(root, path))).map((path) => readFileSync(resolve(root, path), 'utf8')).join('\n');
  const missing = contract.require.filter((value) => !text.includes(value));
  const forbidden = contract.forbid.filter((value) => text.includes(value));
  return { pass: missingFiles.length === 0 && missing.length === 0 && forbidden.length === 0, id, description: contract.description, missingFiles, missing, forbidden };
}

function main() {
  const results = contracts.map((item) => runContract(item.id));
  const failed = results.filter((item) => !item.pass);
  for (const item of failed) console.error(`FAIL ${item.id}: ${JSON.stringify({ missingFiles: item.missingFiles, missing: item.missing, forbidden: item.forbidden })}`);
  console.log(`Harness deterministic contracts: ${results.length - failed.length}/${results.length} passed.`);
  if (results.length < 30 || failed.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
