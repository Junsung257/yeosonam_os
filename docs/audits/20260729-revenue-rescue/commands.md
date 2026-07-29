# Reproduction Commands

실행 위치: repository root. secret 값이나 고객 단위 row는 출력하지 않는다.

```powershell
git remote get-url origin
git rev-parse HEAD
git fetch origin main --prune
git rev-parse origin/main
node --version
npm --version
npm ls next --depth=0
Get-FileHash package-lock.json -Algorithm SHA256
Get-ChildItem supabase/migrations -File | Sort-Object Name | Select-Object -Last 1
(rg --files src/app | rg 'route\.(ts|tsx)$' | Measure-Object).Count
(rg --files src/app | rg 'page\.(ts|tsx)$' | Measure-Object).Count
npm audit --omit=dev --json
node_modules\.bin\vitest.cmd run src/lib/cron-auth.test.ts src/lib/revenue-rescue-capability-policy.test.ts src/lib/affiliate/jwt-auth.test.ts src/lib/affiliate/auth-service.test.ts src/lib/guidebook-token.test.ts src/lib/oauth-state.test.ts src/app/api/auth/oauth-state-boundary.test.ts src/app/api/influencer/auth/route.test.ts src/app/api/public-pii-boundary.test.ts src/app/private-tour/public-claims.test.ts
node C:\dev\yeosonam-os\node_modules\eslint\bin\eslint.js <changed-js-ts-files> --max-warnings=0
node C:\dev\yeosonam-os\node_modules\typescript\bin\tsc -p tsconfig.revenue-rescue.json --pretty false
```

Vercel production deployment는 project `os`, team
`team_TRVjBfDt5nNIXtloumpCsDSh`의 latest production target에서 commit SHA를 확인한다.

Supabase SQL은 project `ixaxnvbmhzjvupissmly`에서 `queries/01`부터 `10`까지 read-only로
실행한다. `pg_stat_user_tables.n_live_tup` 같은 estimate는 exact row count로 사용하지 않는다.

RLS test command is `supabase test db supabase/tests/revenue_rescue_sensitive_rls.sql`. 현재 로컬
Docker/Supabase runtime이 없어 실행하지 못했으며, production DB에는 migration을 적용하지 않았다.
