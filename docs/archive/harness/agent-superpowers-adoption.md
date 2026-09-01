# Superpowers Adoption

Date: 2026-06-16

## Decision

Use Superpowers as an optional general development workflow layer when it is available in Codex App, Codex CLI, Claude Code, or another agent harness.

Good use cases:

- brainstorming before implementation
- writing small implementation plans
- test-driven development
- systematic debugging
- requesting/receiving code review
- verification before completion

## Priority

Superpowers does not replace Yeosonam OS source-of-truth rules.

When there is a conflict, follow the Yeosonam project rules first:

- `AGENTS.md`
- `.claude/CLAUDE.md`
- `.cursor/rules/*.mdc`
- `.claude/skills/register/SKILL.md`
- `CURRENT_STATUS.md`
- `db/error-registry.md`
- domain docs under `docs/`

For product registration, supplier parsing, DB/RLS/schema work, attractions, render contracts, AI routing, and customer-facing data safety, Yeosonam SSOT wins over generic Superpowers guidance.

## Installation Status

As of 2026-06-16, the local Codex plugin install candidate list did not expose `Superpowers`, so it could not be installed programmatically from this session.

Official route:

1. Open Plugins in the Codex App sidebar.
2. Find `Superpowers` in the Coding section.
3. Click `+` and follow the prompts.

Fallback:

Use a Superpowers MCP wrapper only when the target harness cannot install the Codex/Claude plugin and the user explicitly wants cross-IDE MCP support.
