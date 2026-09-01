const ALLOWED_SUPABASE_FEATURES = new Set(['database', 'debugging', 'development', 'docs']);
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
