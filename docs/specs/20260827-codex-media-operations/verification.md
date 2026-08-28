# Codex Media Operations — Verification

Verified locally on 2026-08-28.

## Passed

- `npm run type-check -- --pretty false`
- focused ESLint over the media layer, touched routes, homepage, admin media UI, and blog/public-image paths
- 83 focused Vitest assertions across media policy, prompts, provider request contract, image QA and variants, persistence replacement, migration security, blog fallback/disclosure, and product snapshot exclusion
- `npm run audit:media-generation` — 10/10 static contracts
- `npm run audit:migration-prefix` — no new/unbaselined timestamp collision
- `npm run audit:api-response` — new admin routes use the shared response contract
- `npm run audit:drift` — command completed; pre-existing package optional-tour drift remains outside this change, attractions reported zero drift
- `npm run lint:secrets:all` — repository-wide direct secret access audit passed; server provider reads the key through the secret registry
- `npm run audit:api-drift` and `npm run audit:select-cols` — customer package fields and SELECT contracts passed
- Playwright local browser proof at 1440×1000 and 390×844 — `/` returned 200, rendered the brand fallback hero, had no framework overlay, console error, or page error
- Playwright local browser proof for `/blog` — returned 200 with 55 links, no overlay/console/page error, and visibly disclosed existing generated reference images
- unauthenticated `/admin/marketing/media` and `/api/admin/media` — redirected to login; the protected boundary is active

## Blocked or intentionally not run

- Supabase local `db lint`: local Postgres/Docker was not running at `127.0.0.1:54322`. A static migration contract test passed instead.
- Admin dashboard runtime audit: protected endpoints require an authenticated admin cookie.
- Live media ledger and public URL audit: migration and server deployment variables are not applied.
- Authenticated admin generation/review and an approved-media desktop/mobile proof: no migrated local media ledger or approved asset exists yet.
- Production migration, external publication, secret rotation, and canary generation were intentionally not executed.

## Deployment proof commands

```bash
npm run audit:media-generation:live
npm run type-check
npm test -- --run src/lib/media-generation src/lib/blog-image-gen.test.ts src/lib/blog-inline-images.test.ts src/lib/package-publication/public-snapshot.test.ts src/app/blog/blog-public-sections-contract.test.ts
```

Then verify with an authenticated browser:

1. Generate and review one home campaign hero.
2. Confirm the old approved hero remains until the replacement is approved.
3. Confirm desktop and mobile hero disclosure.
4. Generate one informational blog and inspect cover disclosure, deterministic inline cards, public URLs, alt text, and captions.
5. Confirm a product detail and product card news contain only verified public snapshot images.
