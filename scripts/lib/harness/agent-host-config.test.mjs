import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCodexTomlText, validateSupabaseMcpConfigText } from './agent-host-config.mjs';

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
