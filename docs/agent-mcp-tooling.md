# Agent MCP Tooling

Date: 2026-06-16

## Installed For Codex

These MCP servers are configured globally in `C:\Users\admin\.codex\config.toml`.

| MCP | Status | Purpose |
|---|---|---|
| Context7 | Installed | Fetch current library/API documentation for Next.js, React, Supabase, Vercel, Sentry, OpenAI, and similar dependencies. |
| Serena | Installed | Symbol-aware code navigation, reference lookup, and safer refactoring for the large Yeosonam OS codebase. |
| apifable | Installed | Read `docs/api-spec.json`, search API endpoints, inspect request/response shapes, and generate TypeScript types. |

Project config added:

- `apifable.config.json` points apifable to `docs/api-spec.json`.

Serena dashboard policy:

- `web_dashboard: false`
- `web_dashboard_open_on_launch: false`
- Codex Serena args include `--enable-web-dashboard false`, `--open-web-dashboard false`, and `--enable-gui-log-window false`.

Reason: the dashboard is useful for troubleshooting, but it is unnecessary during normal Yeosonam OS work and can open repeated windows when multiple Codex sessions start Serena.

## Usage Rules

- Use Context7 whenever implementing or changing code that depends on external libraries, SDKs, framework APIs, auth, routing, or deployment behavior.
- Use Serena for multi-file code exploration, symbol reference tracing, refactors, and debugging shared logic. Prefer normal local search for tiny one-file tasks.
- Use apifable before writing admin frontend/API integration code that depends on an existing endpoint. Verify the exact method, path, parameters, and response shape before coding.

## Deferred

| MCP | Reason |
|---|---|
| Sentry MCP | Useful, but requires Sentry auth/project access. Add when production error triage is the current task. |
| Firecrawl or Exa | Useful for SEO, competitor research, blog audits, and regional event crawling, but requires an API key/usage policy decision. |
| n8n MCP | Potentially useful for automation, but should be designed separately because workflows touching payments, SMS, Slack, and customer data need explicit safety boundaries. |
| Figma MCP | Defer until there is a real Figma design source of truth. Product Design plugin already covers current design exploration needs. |
| GitHub MCP | Defer because the GitHub plugin is already installed and avoids duplicate tool surfaces. |
| Playwright MCP | Defer because Browser/Chrome plugins and existing Playwright tests cover current needs; add only for long-running browser state workflows. |

## Restart Note

Codex discovers MCP tools at session startup. After changing MCP config, restart Codex or open a new session before expecting these tools to appear.
