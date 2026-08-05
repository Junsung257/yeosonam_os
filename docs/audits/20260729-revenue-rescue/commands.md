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
```

Vercel production deployment는 project `os`, team
`team_TRVjBfDt5nNIXtloumpCsDSh`의 latest production target에서 commit SHA를 확인한다.

Supabase SQL은 project `ixaxnvbmhzjvupissmly`에서 `queries/01`부터 `10`까지 read-only로
실행한다. `pg_stat_user_tables.n_live_tup` 같은 estimate는 exact row count로 사용하지 않는다.
