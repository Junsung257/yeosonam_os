import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateCodebaseMemoryCodexConfigText,
  validateCodebaseMemoryRepositoryContract,
  validateCodexTomlText,
  validateSupabaseMcpConfigText,
} from './agent-host-config.mjs';

function config(url) {
  return JSON.stringify({ mcpServers: { supabase: { type: 'http', url } } });
}

test('Supabase MCP validator accepts the scoped read-only template', () => {
  const failures = validateSupabaseMcpConfigText(config(
    'https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF&read_only=true&features=database%2Cdebugging%2Cdevelopment%2Cdocs',
  ), { allowPlaceholder: true });
  assert.deepEqual(failures, []);
});

test('Supabase MCP validator rejects spoofed substrings and excessive features', () => {
  const failures = validateSupabaseMcpConfigText(config(
    'https://mcp.supabase.com/mcp?project_ref=&read_only=false&features=database%2Caccount&note=read_only%3Dtrue',
  ));
  assert.ok(failures.some((failure) => failure.includes('project_ref')));
  assert.ok(failures.some((failure) => failure.includes('read_only=true')));
  assert.ok(failures.some((failure) => failure.includes('allowlist')));
  assert.ok(failures.some((failure) => failure.includes('unapproved query')));
});

test('Supabase MCP validator rejects executable stdio and credential fields', () => {
  const text = JSON.stringify({
    mcpServers: {
      supabase: {
        type: 'stdio',
        command: 'powershell',
        args: ['-c', 'do-something'],
        env: { TOKEN: 'opaque' },
        url: 'https://mcp.supabase.com/mcp?project_ref=abcdefghijklmnopqrst&read_only=true&features=database',
      },
    },
  });
  const failures = validateSupabaseMcpConfigText(text);
  assert.ok(failures.some((failure) => failure.includes('type must be http')));
  assert.ok(failures.some((failure) => failure.includes('executable or credential-bearing')));
});

test('Supabase MCP validator rejects executable sibling MCP servers', () => {
  const text = JSON.stringify({
    mcpServers: {
      supabase: {
        type: 'http',
        url: 'https://mcp.supabase.com/mcp?project_ref=abcdefghijklmnopqrst&read_only=true&features=database',
      },
      helper: { type: 'stdio', command: 'powershell', args: ['-c', 'run'] },
    },
  });
  assert.ok(validateSupabaseMcpConfigText(text).some((failure) => failure.includes('helper')));
});

test('Codex TOML validator uses effective root values, not comments or decoy sections', () => {
  const text = `
# approval_policy = "on-request"
approval_policy = "never"
sandbox_mode = "danger-full-access"
profile = "unsafe"
[profiles.safe]
approval_policy = "on-request"
sandbox_mode = "workspace-write"
[plugins."supabase@openai-curated"]
enabled = true
`;
  const failures = validateCodexTomlText(text, {
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    requireSupabaseDisabled: true,
  });
  assert.ok(failures.some((failure) => failure.includes('approval_policy')));
  assert.ok(failures.some((failure) => failure.includes('sandbox_mode')));
  assert.ok(failures.some((failure) => failure.includes('Supabase plugin')));
  assert.ok(failures.some((failure) => failure.includes('auto-select')));
});

test('Codex TOML validator accepts only a project-scoped read-only Supabase server', () => {
  const text = `
approval_policy = "on-request"
sandbox_mode = "workspace-write"
[plugins."supabase@openai-curated"]
enabled = false
[mcp_servers.supabase]
url = "https://mcp.supabase.com/mcp?project_ref=abcdefghijklmnopqrst&read_only=true&features=database,debugging,development,docs"
`;
  assert.deepEqual(validateCodexTomlText(text, {
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    requireSupabaseDisabled: true,
    requireScopedSupabase: true,
  }), []);
});

test('Codex TOML validator rejects a writable or credential-bearing Supabase server', () => {
  const text = `
approval_policy = "on-request"
sandbox_mode = "workspace-write"
[plugins."supabase@openai-curated"]
enabled = false
[mcp_servers.supabase]
url = "https://mcp.supabase.com/mcp?project_ref=abcdefghijklmnopqrst&read_only=false&features=database,account"
bearer_token_env_var = "SUPABASE_ACCESS_TOKEN"
`;
  const failures = validateCodexTomlText(text, {
    requireSupabaseDisabled: true,
    requireScopedSupabase: true,
  });
  assert.ok(failures.some((failure) => failure.includes('read_only=true')));
  assert.ok(failures.some((failure) => failure.includes('allowlist')));
  assert.ok(failures.some((failure) => failure.includes('headers, tokens, or executable')));
});

test('Codex TOML validator rejects inline, nested, and aliased Supabase credentials', () => {
  const text = `
[plugins."supabase@openai-curated"]
enabled = false
[mcp_servers.supabase]
url = "https://mcp.supabase.com/mcp?project_ref=abcdefghijklmnopqrst&read_only=true&features=database"
http_headers = { Authorization = "Bearer redacted" }
env_http_headers.Authorization = "SUPABASE_ACCESS_TOKEN"
[mcp_servers.supabase.env_http_headers]
Authorization = "SUPABASE_ACCESS_TOKEN"
[mcp_servers.account_database]
url = "https://mcp.supabase.com/mcp"
`;
  const failures = validateCodexTomlText(text, {
    requireSupabaseDisabled: true,
    requireScopedSupabase: true,
  });
  assert.ok(failures.some((failure) => failure.includes('headers, tokens, or executable fields')));
  assert.ok(failures.some((failure) => failure.includes('nested header, token, or executable tables')));
  assert.ok(failures.some((failure) => failure.includes('additional Supabase MCP alias')));
});

const cbmConfig = `
[mcp_servers.codebase_memory]
command = "C:/Users/example/.codex/tools/codebase-memory-mcp/v0.10.8/codebase-memory-mcp.exe"
args = ["--ui=false", "--tool-profile=analysis"]
cwd = "C:/dev/pilot"
enabled = true
required = false
enabled_tools = ["index_repository", "search_graph", "query_graph", "trace_path", "get_code_snippet", "get_graph_schema", "get_architecture", "search_code", "list_projects", "index_status", "check_index_coverage", "detect_changes"]
disabled_tools = ["delete_project", "manage_adr", "ingest_traces"]
default_tools_approval_mode = "prompt"

[mcp_servers.codebase_memory.tools.index_repository]
approval_mode = "prompt"

[mcp_servers.codebase_memory.env]
CBM_ALLOWED_ROOT = "C:/dev/pilot"
CBM_CACHE_DIR = "C:/Users/example/.codex/cache/cbm"
CBM_DIAGNOSTICS = "false"
CBM_LOG_LEVEL = "warn"
`;

test('Codebase Memory audit profile accepts the pinned least-privilege shape', () => {
  assert.deepEqual(validateCodebaseMemoryCodexConfigText(cbmConfig, { repoRoot: 'C:/dev/pilot' }), []);
});

test('Codebase Memory audit profile rejects broad roots, unsafe tools, and verbose logs', () => {
  const unsafe = cbmConfig
    .replace('CBM_ALLOWED_ROOT = "C:/dev/pilot"', 'CBM_ALLOWED_ROOT = "C:/dev"')
    .replace('"detect_changes"]', '"detect_changes", "delete_project"]')
    .replace('CBM_LOG_LEVEL = "warn"', 'CBM_LOG_LEVEL = "debug"');
  const failures = validateCodebaseMemoryCodexConfigText(unsafe, { repoRoot: 'C:/dev/pilot' });
  assert.ok(failures.some((failure) => failure.includes('ALLOWED_ROOT')));
  assert.ok(failures.some((failure) => failure.includes('allowlist')));
  assert.ok(failures.some((failure) => failure.includes('verbose')));
});

test('Codebase Memory repository contract requires secret and graph exclusions', () => {
  const manifest = {
    schemaVersion: 1,
    release: { version: '0.10.8', archiveSha256: 'a'.repeat(64), binarySha256: 'b'.repeat(64) },
    runtime: { autoIndex: false, autoWatch: false, uiEnabled: false, diagnostics: false, indexMode: 'manual_only' },
    enabledTools: [
      'index_repository', 'search_graph', 'query_graph', 'trace_path', 'get_code_snippet', 'get_graph_schema',
      'get_architecture', 'search_code', 'list_projects', 'index_status', 'check_index_coverage', 'detect_changes',
    ],
    blockedTools: ['delete_project', 'manage_adr', 'ingest_traces'],
  };
  const failures = validateCodebaseMemoryRepositoryContract({
    gitignore: '.codebase-memory/\n',
    gitattributes: '.codebase-memory/graph.db.zst merge=ours\n',
    cbmignore: '.codebase-memory/\n.env*\nnode_modules/\n.next/\nartifacts/\nprivate/\ndata/product-registration/hwp-inbox/\n',
    manifest,
  });
  assert.deepEqual(failures, []);
  assert.ok(validateCodebaseMemoryRepositoryContract({ gitignore: '', gitattributes: '', cbmignore: '', manifest }).length >= 7);
});
