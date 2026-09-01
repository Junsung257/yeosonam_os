const ALLOWED_SUPABASE_FEATURES = new Set(['database', 'debugging', 'development', 'docs']);
const CODEBASE_MEMORY_ALLOWED_TOOLS = new Set([
  'index_repository', 'search_graph', 'query_graph', 'trace_path', 'get_code_snippet',
  'get_graph_schema', 'get_architecture', 'search_code', 'list_projects', 'index_status',
  'check_index_coverage', 'detect_changes',
]);
const CODEBASE_MEMORY_BLOCKED_TOOLS = new Set(['delete_project', 'manage_adr', 'ingest_traces']);
const UNPARSED_TOML_VALUE = Symbol('unparsed-toml-value');

function stripTomlComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && quote === '"') {
      escaped = true;
      continue;
    }
    if ((character === '"' || character === "'") && (!quote || quote === character)) {
      quote = quote ? null : character;
      continue;
    }
    if (character === '#' && !quote) return line.slice(0, index);
  }
  return line;
}

function scalarValue(raw) {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return undefined; }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return undefined;
}

export function parseTomlScalarSections(text) {
  const sections = new Map([['', new Map()]]);
  const errors = [];
  let section = '';
  for (const originalLine of text.split(/\r?\n/u)) {
    const line = stripTomlComment(originalLine).trim();
    if (!line) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).trim();
      if (!sections.has(section)) sections.set(section, new Map());
      continue;
    }
    const assignment = line.match(/^([^=]+?)\s*=\s*(.+)$/u);
    if (!assignment) continue;
    const values = sections.get(section);
    const key = assignment[1].trim();
    if (values.has(key)) errors.push(`duplicate TOML key ${section || '<root>'}.${key}`);
    const parsed = scalarValue(assignment[2]);
    values.set(key, parsed === undefined ? UNPARSED_TOML_VALUE : parsed);
  }
  return { sections, errors };
}

function sectionText(text, sectionName) {
  const lines = text.split(/\r?\n/u);
  const header = `[${sectionName}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return null;
  const selected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[[^\]]+\]\s*$/u.test(lines[index])) break;
    selected.push(lines[index]);
  }
  return selected.join('\n');
}

function stringArray(section, key) {
  if (!section) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = section.match(new RegExp(`^\\s*${escaped}\\s*=\\s*(\\[[^\\n]*\\])`, 'mu'));
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) && parsed.every((value) => typeof value === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

function scalarFromSection(text, sectionName, key) {
  const parsed = parseTomlScalarSections(text);
  const value = parsed.sections.get(sectionName)?.get(key);
  return value === UNPARSED_TOML_VALUE ? undefined : value;
}

function normalizedPath(value) {
  return typeof value === 'string' ? value.replaceAll('\\', '/').replace(/\/$/u, '').toLowerCase() : '';
}

export function codebaseMemoryConfigDetails(text) {
  return {
    command: scalarFromSection(text, 'mcp_servers.codebase_memory', 'command'),
    cwd: scalarFromSection(text, 'mcp_servers.codebase_memory', 'cwd'),
    cacheDir: scalarFromSection(text, 'mcp_servers.codebase_memory.env', 'CBM_CACHE_DIR'),
    allowedRoot: scalarFromSection(text, 'mcp_servers.codebase_memory.env', 'CBM_ALLOWED_ROOT'),
  };
}

export function validateCodebaseMemoryCodexConfigText(text, { repoRoot, version = '0.10.8' } = {}) {
  const failures = [];
  const server = sectionText(text, 'mcp_servers.codebase_memory');
  if (server === null) return ['Codebase Memory MCP audit server is not configured'];
  const details = codebaseMemoryConfigDetails(text);
  const command = normalizedPath(details.command);
  if (!command.endsWith(`/codebase-memory-mcp/v${version}/codebase-memory-mcp.exe`)) {
    failures.push(`Codebase Memory command must use the pinned v${version} binary`);
  }
  if (normalizedPath(details.cwd) !== normalizedPath(repoRoot)) failures.push('Codebase Memory cwd must equal the pilot worktree');
  if (normalizedPath(details.allowedRoot) !== normalizedPath(repoRoot)) failures.push('CBM_ALLOWED_ROOT must equal the pilot worktree');
  if (!details.cacheDir || normalizedPath(details.cacheDir).startsWith(`${normalizedPath(repoRoot)}/`)) {
    failures.push('CBM_CACHE_DIR must be configured outside the repository');
  }

  const args = stringArray(server, 'args');
  if (!args?.includes('--ui=false') || !args.includes('--tool-profile=analysis')) {
    failures.push('Codebase Memory args must disable UI and use the analysis tool profile');
  }
  const enabledTools = stringArray(server, 'enabled_tools');
  if (!enabledTools || enabledTools.length !== CODEBASE_MEMORY_ALLOWED_TOOLS.size
    || enabledTools.some((tool) => !CODEBASE_MEMORY_ALLOWED_TOOLS.has(tool))) {
    failures.push('Codebase Memory enabled_tools must equal the repository allowlist');
  }
  const disabledTools = stringArray(server, 'disabled_tools');
  if (!disabledTools || [...CODEBASE_MEMORY_BLOCKED_TOOLS].some((tool) => !disabledTools.includes(tool))) {
    failures.push('Codebase Memory mutating tools must be explicitly disabled');
  }
  if (scalarFromSection(text, 'mcp_servers.codebase_memory', 'enabled') !== true) failures.push('Codebase Memory audit server must be enabled');
  if (scalarFromSection(text, 'mcp_servers.codebase_memory', 'required') !== false) failures.push('Codebase Memory must remain optional at startup');
  if (scalarFromSection(text, 'mcp_servers.codebase_memory', 'default_tools_approval_mode') !== 'prompt') {
    failures.push('Codebase Memory tools must default to prompt approval');
  }
  if (scalarFromSection(text, 'mcp_servers.codebase_memory.tools.index_repository', 'approval_mode') !== 'prompt') {
    failures.push('index_repository must require prompt approval');
  }
  if (scalarFromSection(text, 'mcp_servers.codebase_memory.env', 'CBM_DIAGNOSTICS') !== 'false') {
    failures.push('CBM_DIAGNOSTICS must be false');
  }
  const logLevel = scalarFromSection(text, 'mcp_servers.codebase_memory.env', 'CBM_LOG_LEVEL');
  if (!['warn', 'error', 'none'].includes(logLevel)) failures.push('CBM_LOG_LEVEL must avoid verbose code-bearing logs');
  const env = sectionText(text, 'mcp_servers.codebase_memory.env') ?? '';
  const envKeys = [...env.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gmu)].map((match) => match[1]);
  if (envKeys.some((key) => !['CBM_ALLOWED_ROOT', 'CBM_CACHE_DIR', 'CBM_DIAGNOSTICS', 'CBM_LOG_LEVEL'].includes(key))) {
    failures.push('Codebase Memory env contains an unapproved variable');
  }
  return failures;
}

export function validateCodebaseMemoryRepositoryContract({ gitignore, gitattributes, cbmignore, manifest }) {
  const failures = [];
  if (!/(?:^|\n)\.codebase-memory\/(?:\r?$|\n)/u.test(gitignore)) failures.push('.gitignore must exclude .codebase-memory/');
  if (!/(?:^|\n)\.codebase-memory\/graph\.db\.zst\s+merge=ours(?:\r?$|\n)/u.test(gitattributes)) {
    failures.push('.gitattributes must define the Codebase Memory graph merge rule');
  }
  for (const pattern of ['.codebase-memory/', '.env*', 'node_modules/', '.next/', 'artifacts/', 'private/', 'data/product-registration/hwp-inbox/']) {
    if (!cbmignore.split(/\r?\n/u).includes(pattern)) failures.push(`.cbmignore is missing ${pattern}`);
  }
  if (manifest?.schemaVersion !== 1) failures.push('Codebase Memory manifest schemaVersion must be 1');
  if (!/^\d+\.\d+\.\d+$/u.test(manifest?.release?.version ?? '')) failures.push('Codebase Memory manifest version is invalid');
  for (const key of ['archiveSha256', 'binarySha256']) {
    if (!/^[a-f0-9]{64}$/u.test(manifest?.release?.[key] ?? '')) failures.push(`Codebase Memory manifest ${key} is invalid`);
  }
  if (manifest?.runtime?.autoIndex !== false || manifest?.runtime?.autoWatch !== false
    || manifest?.runtime?.uiEnabled !== false || manifest?.runtime?.diagnostics !== false
    || manifest?.runtime?.indexMode !== 'manual_only') {
    failures.push('Codebase Memory runtime must remain manual, non-watching, UI-off, and diagnostics-off');
  }
  const enabled = manifest?.enabledTools ?? [];
  const blocked = manifest?.blockedTools ?? [];
  if (enabled.length !== CODEBASE_MEMORY_ALLOWED_TOOLS.size || enabled.some((tool) => !CODEBASE_MEMORY_ALLOWED_TOOLS.has(tool))) {
    failures.push('Codebase Memory manifest enabledTools differs from the allowlist');
  }
  if ([...CODEBASE_MEMORY_BLOCKED_TOOLS].some((tool) => !blocked.includes(tool))) failures.push('Codebase Memory manifest must block mutating tools');
  return failures;
}

export function validateCodexTomlText(text, {
  approvalPolicy,
  sandboxMode,
  requireSupabaseDisabled = false,
  requireScopedSupabase = false,
} = {}) {
  const { sections, errors } = parseTomlScalarSections(text);
  const failures = [...errors];
  const root = sections.get('') ?? new Map();
  if (root.has('profile')) failures.push('Codex config must not auto-select an embedded profile');
  if (approvalPolicy && root.get('approval_policy') !== approvalPolicy) {
    failures.push(`effective root approval_policy must be ${approvalPolicy}`);
  }
  if (sandboxMode && root.get('sandbox_mode') !== sandboxMode) {
    failures.push(`effective root sandbox_mode must be ${sandboxMode}`);
  }
  if (requireSupabaseDisabled) {
    const plugin = sections.get('plugins."supabase@openai-curated"');
    if (plugin?.get('enabled') !== false) failures.push('account-scoped Supabase plugin must be disabled');
  }
  if (requireScopedSupabase) {
    const server = sections.get('mcp_servers.supabase');
    const url = server?.get('url');
    if (typeof url !== 'string') {
      failures.push('project-scoped Supabase MCP server must be configured');
    } else {
      const syntheticConfig = JSON.stringify({ mcpServers: { supabase: { type: 'http', url } } });
      for (const failure of validateSupabaseMcpConfigText(syntheticConfig)) {
        failures.push(`Codex Supabase MCP: ${failure}`);
      }
    }
    if (server && [...server.keys()].some((key) => key !== 'url')) {
      failures.push('Codex Supabase MCP server must not contain headers, tokens, or executable fields');
    }
    if ([...sections.keys()].some((name) => name.startsWith('mcp_servers.supabase.'))) {
      failures.push('Codex Supabase MCP server must not contain nested header, token, or executable tables');
    }
    for (const [name, values] of sections) {
      if (!name.startsWith('mcp_servers.') || name === 'mcp_servers.supabase') continue;
      const candidateUrl = values.get('url');
      if (typeof candidateUrl !== 'string') continue;
      try {
        if (new URL(candidateUrl).hostname === 'mcp.supabase.com') {
          failures.push(`additional Supabase MCP alias is not allowed: ${name}`);
        }
      } catch {
        // Other MCP URL validation is outside this Supabase-specific host check.
      }
    }
  }
  return failures;
}

export function validateSupabaseMcpConfigText(text, { allowPlaceholder = false } = {}) {
  const failures = [];
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    return ['Supabase MCP config is not valid JSON'];
  }

  const servers = config?.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    return ['MCP config must define an object mcpServers'];
  }
  for (const [name, candidate] of Object.entries(servers)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      failures.push(`MCP server ${name} must be an object`);
      continue;
    }
    const keys = Object.keys(candidate);
    if (candidate.type !== 'http' || keys.some((key) => !['type', 'url'].includes(key))) {
      failures.push(`MCP server ${name} must be non-executable HTTP with only type and url`);
    }
    try {
      const candidateUrl = new URL(candidate.url);
      if (candidateUrl.protocol !== 'https:' || candidateUrl.username || candidateUrl.password) {
        failures.push(`MCP server ${name} must use credential-free HTTPS`);
      }
    } catch {
      failures.push(`MCP server ${name} URL is malformed`);
    }
  }

  const server = servers.supabase;
  if (!server || typeof server !== 'object' || Array.isArray(server)) {
    return ['Supabase MCP config must define mcpServers.supabase'];
  }
  const serverKeys = Object.keys(server);
  if (server.type !== 'http') failures.push('Supabase MCP server type must be http');
  if (serverKeys.some((key) => !['type', 'url'].includes(key))) {
    failures.push('Supabase MCP server contains executable or credential-bearing fields');
  }

  const rawUrl = server.url;
  if (typeof rawUrl !== 'string') return ['Supabase MCP config must define mcpServers.supabase.url'];

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return ['Supabase MCP URL is malformed'];
  }

  if (url.protocol !== 'https:' || url.hostname !== 'mcp.supabase.com' || url.pathname !== '/mcp' || url.username || url.password || url.port) {
    failures.push('Supabase MCP URL must use the canonical credential-free HTTPS endpoint');
  }
  const keys = [...url.searchParams.keys()];
  for (const required of ['project_ref', 'read_only', 'features']) {
    if (keys.filter((key) => key === required).length !== 1) failures.push(`Supabase MCP URL must contain exactly one ${required}`);
  }
  if (keys.some((key) => !['project_ref', 'read_only', 'features'].includes(key))) {
    failures.push('Supabase MCP URL contains an unapproved query parameter');
  }

  const projectRef = url.searchParams.get('project_ref') ?? '';
  const projectRefValid = /^[a-z0-9]{20}$/u.test(projectRef)
    || (allowPlaceholder && projectRef === 'YOUR_PROJECT_REF');
  if (!projectRefValid) failures.push('Supabase MCP project_ref is missing or invalid');
  if (url.searchParams.get('read_only') !== 'true') failures.push('Supabase MCP must set read_only=true');

  const features = (url.searchParams.get('features') ?? '').split(',').filter(Boolean);
  if (features.length === 0 || !features.includes('database')) failures.push('Supabase MCP must include the database feature group');
  if (new Set(features).size !== features.length || features.some((feature) => !ALLOWED_SUPABASE_FEATURES.has(feature))) {
    failures.push('Supabase MCP feature groups exceed the repository allowlist');
  }

  return failures;
}
