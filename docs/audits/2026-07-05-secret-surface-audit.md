# Secret Surface Audit - 2026-07-05

Scope: local environment files, tracked environment templates, secret-related scripts, static secret access guards, and log/command-output surfaces. Raw key, token, password, and credential values were not copied into this report.

## Summary

- `.env.local` and `.env.vercel` exist only in the original local workspace and are ignored by git. They contain many live-looking operational values and should be treated as sensitive local credential bundles.
- `.env.prod` is tracked in git. It mostly contains blanks/placeholders plus public or identifier-like production configuration, but because it is tracked it should remain template-only and should not receive any server-only live secret.
- Existing prevention checks are useful and currently pass: direct secret env access is centralized, sensitive API guard checks pass, and PII strict mode has no unmasked-log blockers.
- No provider mutation, rotation, deployment, or live API write was performed.

## Live-Looking Local Secrets

Sanitized inventory found live-looking values by file, without printing values:

| File | Git state | Live-looking count | Notes |
|---|---:|---:|---|
| `.env.local` | ignored, untracked | 40 | Includes server-side operational keys such as `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, LLM provider keys, ad platform keys, Slack/Solapi keys, and crypto/session secrets. |
| `.env.vercel` | ignored, untracked | 20 | Includes deploy/runtime-oriented values such as `SUPABASE_SERVICE_ROLE_KEY`, `VERCEL_OIDC_TOKEN`, LLM provider keys, Slack secrets, VAPID private key, and revalidation/session secrets. |
| `.env.prod` | tracked | 10 | Live-looking entries are mainly public URLs/anon keys and provider identifiers such as `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and Meta IDs. Server-only secret fields observed here were blank or placeholder-like. |

Immediate handling rule: keep `.env.local` and `.env.vercel` local-only; never paste their contents into chat, logs, PRs, screenshots, issue trackers, or docs. Treat `.env.prod` as a tracked template and keep real server-only values out of it.

## Tracked And Untracked Risk

- Tracked env file: `.env.prod`.
- Ignored env files confirmed by `.gitignore`: `.env.local`, `.env.vercel`, and `.env*.local`.
- `git status --short -- .env .env.*` reported no env-file modifications in either the Agent B worktree or the original workspace.
- The tracked `.env.prod` is the main structural risk because future edits could accidentally turn it from a template into a credential file.
- Existing `.gitignore` also blocks common cloud credential files, including service-account JSON patterns and local Vercel metadata.

Recommended repository policy:

- Keep `.env.prod` template-only, or replace it with `.env.prod.example` in a future cleanup if production values should never be tracked.
- Add `.env.prod` to secret-review checklists when any env or deployment work is reviewed.
- Do not commit generated audit outputs that may include env snapshots.

## Log And Command-Output Risk

Observed command-output behavior:

- `npm run audit:api-keys` prints environment variable names and source files only; it does not print values.
- `npm run lint:secrets:all` passed and reported no direct server secret/key/token access outside allowed central files.
- `npm run audit:sensitive-api-guards` passed and reported no unguarded sensitive API routes.
- `npm run audit:pii-surface:strict` passed with `strict_blockers=0`. It prints code previews for PII terms, so use it in trusted local/CI logs only.
- A targeted search for direct env logging found only `scripts/check-no-direct-env.mjs` and `scripts/vercel-ignore-build.mjs`. The latter logs a Vercel project id for a disabled duplicate project, not a secret value.

Watch item: broad command output from diagnostics can still leak data if future scripts print raw API responses, env objects, request headers, or provider errors. Keep command output redaction as a required review point for new audit and operational scripts.

## Rotation Recommendations

No rotation was performed. Rotate only in the provider consoles or approved secret managers.

Priority rotation if any local env file was shared, copied into logs, or exposed outside the machine:

- Critical: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`, `VERCEL_TOKEN`, `VERCEL_OIDC_TOKEN`, service-account JSON values.
- High: `CRON_SECRET`, `ADMIN_API_TOKEN`, `REVALIDATE_SECRET`, `ENCRYPTION_SECRET_KEY`, `OAUTH_STATE_SECRET`, `SMS_WEBHOOK_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `VAPID_PRIVATE_KEY`.
- High: ad and publishing provider secrets such as `META_ACCESS_TOKEN`, `META_CAPI_ACCESS_TOKEN`, `META_APP_SECRET`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `NAVER_ADS_SECRET_KEY`, `THREADS_ACCESS_TOKEN`, `THREADS_APP_SECRET`.
- Medium: LLM and content-provider keys such as `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PEXELS_API_KEY`, `SERPAPI_KEY`.
- Usually public but still review if abused: `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

## Prevention Checks

Use these existing commands after secret, env, auth, logging, or operational-script changes:

```bash
npm run lint:secrets:all
npm run audit:api-keys
npm run audit:sensitive-api-guards
npm run audit:pii-surface:strict
```

Recommended additions for future work:

- Add a high-confidence committed-secret scanner to package scripts, for example a `gitleaks` or `trufflehog` CI check configured to redact values.
- Add a small guard that fails if tracked `.env.prod` contains live-looking server-only secret names such as `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `CRON_SECRET`, `ADMIN_API_TOKEN`, or provider access tokens with non-placeholder values.
- Keep `scripts/check-no-direct-env.mjs` in CI for changed files and run `npm run lint:secrets:all` before env/security PRs.

## Verification Results

Commands run from `C:\dev\yeosonam-os-agent-b` unless noted:

- `git status --short --branch`: clean Agent B worktree on `codex/agent-b-secret-surface-audit-20260705` before edits.
- `git worktree list --porcelain`: confirmed separate coordinator, Agent A, blog, RFQ, and Agent B worktrees.
- `git ls-files -- .env .env.*`: `.env.prod` is tracked.
- `git status --short -- .env .env.*`: no env-file modifications.
- `git check-ignore -v .env .env.local .env.prod .env.vercel .env.production .env.development`: `.env.local` and `.env.vercel` are ignored; `.env.prod` is not ignored.
- Sanitized env inventory: completed without printing values; results summarized above.
- `npm run audit:api-keys`: passed; produced env-name usage inventory only.
- `npm run lint:secrets:all`: passed with `OK: directly process.env key access violation none`.
- `npm run audit:sensitive-api-guards`: passed with no unguarded sensitive API routes.
- `npm run audit:pii-surface:strict`: passed with `high=250`, `medium=709`, `low=635`, `total=1594`, `strict_blockers=0`.
- Targeted env logging search: found `scripts/check-no-direct-env.mjs` and `scripts/vercel-ignore-build.mjs`; no raw secret output path was identified in those files.

Limitations:

- This was a static and local-file audit, not provider-side key validation.
- Broad custom raw-secret scans over the entire repository were too noisy or timed out, so they are not used as proof of absence. Add a dedicated committed-secret scanner for stronger coverage.
