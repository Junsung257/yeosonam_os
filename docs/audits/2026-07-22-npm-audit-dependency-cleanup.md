# 2026-07-22 npm audit dependency cleanup

## Scope

This audit records a dependency-only remediation for the high severity `npm audit --audit-level=high` failures seen on PR checks.

## Changes

- Refreshed `package-lock.json` with patched transitive packages for OpenTelemetry, DOMPurify, fast-uri, and related dependency chains.
- Pinned `sharp` to `0.35.3` and added an npm override so Next.js and `@vercel/og` dedupe to the patched libvips build.
- Updated `src/lib/blog-image-normalize.ts` from `sharp.Sharp` to `ReturnType<typeof sharp>`. This is a TypeScript compatibility change for the newer sharp type surface, not a rendering behavior change.

## Verification

- `npm audit --audit-level=high`
- `npm ls sharp`
- `node node_modules\eslint\bin\eslint.js src --ext .js,.jsx,.ts,.tsx --max-warnings=0`
- `$env:NODE_OPTIONS='--max-old-space-size=8192'; node node_modules\typescript\bin\tsc --noEmit`
