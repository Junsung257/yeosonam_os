# Supabase Auth Open Gate

Last updated: 2026-08-29

## Current State

The customer booking and affiliate attribution flow is production-ready and the final Supabase Auth security gate is closed:

- `password_hibp_enabled=true` is enabled and verified.
- The project is on the Pro plan required by HaveIBeenPwned leaked-password protection.

The project has been hardened as far as the current plan allows:

- Auth `site_url`: `https://www.yeosonam.com`
- Redirect allow list: `https://www.yeosonam.com/**`, `https://yeosonam.com/**`, local dev URLs
- Password minimum length: `10`
- Password required characters: lowercase + uppercase + digits
- Password update requires reauthentication

## Commands

Read-only check:

```bash
npm run supabase:auth-open-gate
```

Enable HIBP and verify (safe to rerun; the script only applies the requested Auth settings):

```bash
npm run supabase:auth-open-gate:enable
```

The enable command has exited successfully for project `ixaxnvbmhzjvupissmly`.

## Authentication

The script uses the first available token source:

1. `SUPABASE_ACCESS_TOKEN`
2. `SUPABASE_PAT`
3. Windows Credential Manager entry created by `npx supabase login` with target `Supabase CLI:supabase`

Do not commit any token value.

Optional project override:

```bash
SUPABASE_PROJECT_REF=ixaxnvbmhzjvupissmly npm run supabase:auth-open-gate
```

## Completion Evidence

Completion evidence:

1. `npm run supabase:auth-open-gate:enable` exits with `open_gate_passed: true`.
2. A subsequent read-only check reports `open_gate_passed: true` and `password_hibp_enabled: true`.

Run a fresh Supabase security-advisor review after any future Auth configuration
change; do not treat this document as a substitute for that check.
