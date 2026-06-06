# Supabase Auth Open Gate

Last updated: 2026-06-06

## Current State

The customer booking and affiliate attribution flow is production-ready, but the final security gate remains open:

- `password_hibp_enabled` must be `true`.
- Supabase currently rejects enabling it on the active plan because leaked password protection via HaveIBeenPwned requires Pro or higher.

The project has been hardened as far as the current plan allows:

- Auth `site_url`: `https://www.yeosonam.com`
- Redirect allow list: `https://www.yeosonam.com/**`, `https://yeosonam.com/**`, local dev URLs
- Password minimum length: `10`
- Password required characters: lowercase + uppercase + digits
- Password update requires reauthentication

## Commands

Read-only check that tolerates the known plan blocker:

```bash
npm run supabase:auth-open-gate
```

After upgrading Supabase to Pro or higher, enable HIBP and verify:

```bash
npm run supabase:auth-open-gate:enable
```

The enable command must exit successfully before the "complete open" goal can be closed.

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

Completion requires both:

1. `npm run supabase:auth-open-gate:enable` exits with `open_gate_passed: true`.
2. Supabase security advisor no longer reports `auth_leaked_password_protection` as WARN.
