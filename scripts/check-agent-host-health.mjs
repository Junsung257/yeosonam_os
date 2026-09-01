import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

import { validateCodexTomlText, validateSupabaseMcpConfigText } from './lib/harness/agent-host-config.mjs';

const root = resolve(import.meta.dirname, '..');
const repoOnly = process.argv.includes('--repo-only');
const failures = [];
const advisories = [];

function inspect(path, checks) {
  if (!existsSync(path)) {
    advisories.push(`missing optional config: ${path.replace(homedir(), '<home>')}`);
    return;
  }
  const text = readFileSync(path, 'utf8');
  for (const check of checks) {
    const matches = check.pattern.test(text);
    if (matches === check.expected) continue;
    failures.push(`${check.label}: ${path.replace(homedir(), '<home>')}`);
  }
}

function inspectSupabaseMcp(path, { allowPlaceholder = false, required = false } = {}) {
  if (!existsSync(path)) {
    const message = `missing ${required ? 'required' : 'optional'} config: ${path.replace(homedir(), '<home>')}`;
    (required ? failures : advisories).push(message);
    return;
  }
  const text = readFileSync(path, 'utf8');
  if (secret.test(text)) failures.push(`Supabase MCP config contains a token-shaped secret: ${path.replace(homedir(), '<home>')}`);
  for (const failure of validateSupabaseMcpConfigText(text, { allowPlaceholder })) {
    failures.push(`${failure}: ${path.replace(homedir(), '<home>')}`);
  }
}

function inspectCodexToml(path, expectations) {
  if (!existsSync(path)) {
    failures.push(`missing required config: ${path.replace(homedir(), '<home>')}`);
    return;
  }
  const text = readFileSync(path, 'utf8');
  if (secret.test(text)) failures.push(`Codex config contains a token-shaped secret: ${path.replace(homedir(), '<home>')}`);
  for (const failure of validateCodexTomlText(text, expectations)) {
    failures.push(`${failure}: ${path.replace(homedir(), '<home>')}`);
  }
}

const secret = /(?:sbp_|sb_secret_|ghp_|github_pat_|sk-)[A-Za-z0-9._-]{20,}/;
inspect(resolve(root, '.claude/settings.json'), [
  { label: 'project Claude config contains no token-shaped secret', pattern: secret, expected: false },
  { label: 'project Claude config does not allow broad node -e', pattern: /Bash\(node\s+-e/i, expected: false },
  { label: 'project Claude config does not preallow DB migration', pattern: /allow[\s\S]*apply_migration/i, expected: false },
  { label: 'project Claude config does not hide legitimate token-named source files', pattern: /Read\([^)]*\*token\*/i, expected: false },
]);
inspect(resolve(root, '.cursor/hooks.json'), [
  { label: 'Cursor lifecycle hooks do not auto-write the OS inbox', pattern: /(?:sessionStart|stop)[\s\S]{0,500}os:inbox/i, expected: false },
]);
inspectSupabaseMcp(resolve(root, '.mcp.example.json'), { allowPlaceholder: true, required: true });

const localMcp = resolve(root, '.mcp.json');
if (existsSync(localMcp)) {
  inspectSupabaseMcp(localMcp);
}

if (!repoOnly) {
  const codexConfig = resolve(homedir(), '.codex/config.toml');
  inspectCodexToml(codexConfig, {
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    requireSupabaseDisabled: true,
    requireScopedSupabase: true,
  });
  inspect(codexConfig, [
    { label: 'Serena derives the project from cwd', pattern: /--project-from-cwd/, expected: true },
    { label: 'apifable is version-pinned', pattern: /apifable@1\.1\.8/, expected: true },
  ]);
  inspectCodexToml(resolve(homedir(), '.codex/audit.config.toml'), { approvalPolicy: 'on-request', sandboxMode: 'read-only' });
  inspectCodexToml(resolve(homedir(), '.codex/elevated.config.toml'), { approvalPolicy: 'on-request', sandboxMode: 'danger-full-access' });
  inspect(resolve(homedir(), '.claude/settings.json'), [
    { label: 'global Claude config contains no token-shaped secret', pattern: secret, expected: false },
    { label: 'global Claude config does not allow broad node -e', pattern: /Bash\(node\s+-e/i, expected: false },
    { label: 'global Claude config does not preallow Supabase migration', pattern: /allow[\s\S]*mcp__supabase__apply_migration/i, expected: false },
    { label: 'global Claude config keeps dangerous-mode prompt', pattern: /"skipDangerousModePermissionPrompt"\s*:\s*true/i, expected: false },
  ]);
}

for (const message of advisories) console.warn(`ADVISORY ${message}`);
if (failures.length) {
  for (const message of failures) console.error(`FAIL ${message}`);
  process.exit(1);
}
console.log(`Agent host health passed (${repoOnly ? 'repository' : 'repository + local host'} scope).`);
