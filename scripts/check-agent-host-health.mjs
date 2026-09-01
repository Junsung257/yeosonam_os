import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

import {
  codebaseMemoryConfigDetails,
  validateCodebaseMemoryCodexConfigText,
  validateCodebaseMemoryRepositoryContract,
  validateCodexTomlText,
  validateSupabaseMcpConfigText,
} from './lib/harness/agent-host-config.mjs';

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
const cbmManifest = JSON.parse(readFileSync(resolve(root, 'config/codebase-memory-pilot.json'), 'utf8'));
for (const failure of validateCodebaseMemoryRepositoryContract({
  gitignore: readFileSync(resolve(root, '.gitignore'), 'utf8'),
  gitattributes: readFileSync(resolve(root, '.gitattributes'), 'utf8'),
  cbmignore: readFileSync(resolve(root, '.cbmignore'), 'utf8'),
  manifest: cbmManifest,
})) failures.push(failure);
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
  const auditConfigPath = resolve(homedir(), '.codex/audit.config.toml');
  inspectCodexToml(auditConfigPath, { approvalPolicy: 'on-request', sandboxMode: 'read-only' });
  if (!existsSync(auditConfigPath)) {
    advisories.push('Codebase Memory audit profile is not configured');
  } else {
    const auditConfig = readFileSync(auditConfigPath, 'utf8');
    const details = codebaseMemoryConfigDetails(auditConfig);
    if (!details.command) {
      advisories.push('Codebase Memory audit profile is not configured');
    } else {
      for (const failure of validateCodebaseMemoryCodexConfigText(auditConfig, {
        repoRoot: root,
        version: cbmManifest.release.version,
      })) failures.push(failure);
      if (!existsSync(details.command)) failures.push('Codebase Memory pinned binary is missing');
      else {
        const digest = createHash('sha256').update(readFileSync(details.command)).digest('hex');
        if (digest !== cbmManifest.release.binarySha256) failures.push('Codebase Memory binary hash differs from the manifest');
        try {
          const version = execFileSync(details.command, ['--version'], { encoding: 'utf8' }).trim();
          if (version !== `codebase-memory-mcp ${cbmManifest.release.version}`) failures.push('Codebase Memory binary version differs from the manifest');
          const config = execFileSync(details.command, ['config', 'list'], {
            encoding: 'utf8',
            env: { ...process.env, CBM_CACHE_DIR: details.cacheDir, CBM_DIAGNOSTICS: 'false' },
          });
          for (const expected of ['auto_index                = false', 'auto_watch                = false', 'ui_enabled                = false']) {
            if (!config.includes(expected)) failures.push(`Codebase Memory local setting is unsafe: expected ${expected.trim()}`);
          }
        } catch (error) {
          failures.push(`Codebase Memory local binary check failed: ${error.message}`);
        }
      }
    }
  }
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
