import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
const mdPath = resolve(root, 'docs/generated/system-inventory.md');
const jsonPath = resolve(root, 'docs/generated/system-inventory.json');

function walk(dir, predicate) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, predicate));
    else if (entry.isFile() && predicate(full)) out.push(relative(root, full).replaceAll('\\', '/'));
  }
  return out.sort();
}

const routes = walk(resolve(root, 'src/app'), (file) => /[\\/]route\.(?:js|jsx|ts|tsx)$/.test(file));
const pages = walk(resolve(root, 'src/app'), (file) => /[\\/]page\.(?:js|jsx|ts|tsx)$/.test(file));
const migrations = walk(resolve(root, 'supabase/migrations'), (file) => extname(file) === '.sql');
const workflows = walk(resolve(root, '.github/workflows'), (file) => /\.ya?ml$/.test(file));
const scripts = walk(resolve(root, 'scripts'), (file) => /\.(?:cjs|mjs|js|ts|tsx|ps1)$/.test(file));

const inventory = {
  schemaVersion: 1,
  source: 'repository',
  routes,
  pages,
  migrations,
  workflows,
  scripts,
};

const json = `${JSON.stringify(inventory, null, 2)}\n`;
const list = (items) => items.length ? items.map((item) => `- ${item}`).join('\n') : '- none';
const md = `# Generated system inventory

This file is generated from the repository. Do not edit it directly.

## Counts

| Kind | Count |
|---|---:|
| API routes | ${routes.length} |
| App pages | ${pages.length} |
| Supabase migrations | ${migrations.length} |
| GitHub workflows | ${workflows.length} |
| Repository scripts | ${scripts.length} |

## API routes

${list(routes)}

## GitHub workflows

${list(workflows)}

## Recent migrations

${list(migrations.slice(-30))}

The complete deterministic inventory is stored in docs/generated/system-inventory.json.
`;

function verify(path, expected) {
  return existsSync(path) && readFileSync(path, 'utf8').replaceAll('\r\n', '\n') === expected.replaceAll('\r\n', '\n');
}

if (check) {
  const mismatches = [];
  if (!verify(mdPath, md)) mismatches.push(relative(root, mdPath));
  if (!verify(jsonPath, json)) mismatches.push(relative(root, jsonPath));
  if (mismatches.length) {
    console.error(`Generated system inventory is stale: ${mismatches.join(', ')}`);
    process.exit(1);
  }
  console.log('Generated system inventory is current.');
} else {
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, md);
  writeFileSync(jsonPath, json);
  console.log(`Generated inventory: ${routes.length} routes, ${migrations.length} migrations, ${workflows.length} workflows.`);
}
