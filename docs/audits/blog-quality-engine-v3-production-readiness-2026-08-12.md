# Blog Quality Engine V3 production readiness — 2026-08-12

기준 시각은 2026-08-12 Asia/Seoul이다. 이 감사에서는 Vercel/Supabase/공개 URL을 읽기 전용으로 조회했다. production deploy, 환경 변수 변경, migration apply, 운영 DB INSERT/UPDATE/DELETE는 실행하지 않았다.

## 결론

현재 운영은 `safeToEnableLive=false`다. 코드 후보는 장애 시 공개면을 유지하고 자동발행을 닫는 방향으로 보강됐지만, 운영 V3 스키마와 데이터 정리가 아직 반영되지 않았으므로 `BLOG_AUTOPUBLISH_MODE`는 반드시 `draft_only`로 유지해야 한다.

후보 자체의 로컬 검증은 전체 Vitest 680 files / 5,153 tests, type-check, lint, Next.js 15.5.21 production build를 모두 통과했다. build는 641.7초, static pages는 389/389였고 postbuild artifact 검증도 통과했다. 이 결과는 후보 코드의 배포 가능성을 뜻하며, 아래 운영 차단 조건이 해소됐다는 뜻은 아니다.

## Source of truth

- 운영 Vercel deployment: `dpl_3DtVA9B4MMvMGQL1TjnFwuUiHycW`, READY
- 운영 source branch: `main`
- 운영 immutable commit: `54043ebdc5e7b787b304de9a932ecd3d50d7bdc6`
- 작업 branch: `codex/blog-quality-engine-v3-20260811`
- 작업 branch는 최신 `origin/main`을 merge했고 충돌은 없었다.
- package manager/lockfile: npm / `package-lock.json`
- Next.js: `15.5.21`

초기 감사의 feature-branch production source 문제는 현재 배포 metadata에서 해소됐다. 재발 방지는 production에서 `VERCEL_GIT_COMMIT_REF=main`과 immutable SHA가 모두 확인되지 않으면 effective autopublish mode를 `draft_only`로 강등하는 코드로 고정했다.

## 운영 읽기 전용 증거

| 항목 | 값 | 판정 |
|---|---:|---|
| published Naver blog + slug | 200 | 기준선 |
| 현재 SQL view 공개 가능 | 192 | 기준선 |
| published + review blocked | 8 | live 차단 |
| queued | 9 | 최종 재조회 기준 |
| queued without verified demand | 9 | 생성 전 차단 대상 |
| V3 migrations present | 0 / 5 | 배포 차단 |
| V3 runtime resources ready | 0 / 18 | 배포 차단 |
| durable current snapshots | 조회 불가(테이블 없음) | 배포 차단 |
| `BLOG_DATABASE_UNAVAILABLE` 7일 | 131 occurrences / 100 users | 7일 무오류 관찰 전 live 차단 |
| web vitals 7일 | 2,526 rows | 기존 관측은 있으나 V3 dimensions migration 필요 |
| blog engagement 7일 | 453 rows | 기존 관측은 있으나 V3 dimensions migration 필요 |
| analytics server events 30일 | 0 rows | 측정 차단 |
| rank history 30일 | 1,228 rows | legacy 검색 성과 증거 |

운영 공개 URL 확인 결과 `/blog`, `/blog/fukuoka-3`, `/sitemap.xml`, `/api/rss`는 200이었다. `/blog/image-sitemap.xml`은 200이지만 `text/html`을 반환해 현재 운영 commit에는 XML route가 반영되지 않은 상태다. 후보 코드의 로컬 검증에서는 세 sitemap/RSS 경로가 모두 올바른 XML/RSS content type과 콘텐츠를 반환했다.

대기열은 같은 날 앞선 조회의 8건에서 최종 조회 시 9건으로 증가했고, 9건 모두 검증된 수요가 없었다. 이는 운영 쓰기 없이 관측한 외부 상태 변화이며, readiness 판정에는 최종 값 9를 사용했다.

## 새 fail-closed 경계

- publisher cron은 publish 및 delivery V3 resource를 실제 column query로 확인하기 전 queue 상태를 변경하지 않는다.
- production Git ref/SHA가 없거나 허용 ref와 다르면 요청 mode가 `live`여도 effective mode는 `draft_only`다.
- queue demand는 `blog_demand_signals`와 legacy observed fields를 합쳐 읽으며, 저장소 오류 또는 검증된 신호 부재 시 AI writer 호출 전에 차단한다.
- 상세 cache에는 DB 예외를 reject하지 않고 `found | missing | unavailable` envelope를 저장한다. `missing`만 404이고 `unavailable`은 공개 장애 surface 또는 last-known-good로 간다.
- 운영 공개 가능 192건 전체의 본문 bundle은 2.72MB이며 모두 본문 200자 이상이다. HIGH/MEDIUM/LOW fallback 만료는 각각 최대 24/48/72시간이다.
- 새 발행 후 snapshot refresh가 성공하기 전 cache revalidation과 indexing enqueue를 실행하지 않는다.
- indexing worker는 due job을 claim하기 전에 snapshot refresh를 완료한다. 실패하면 job을 그대로 두고 외부 provider를 호출하지 않는다.

## Migration history drift

`npx supabase db push --linked --include-all --dry-run`은 `LegacyDbPushMissingLocalError`로 차단됐다. 운영 history에 local repository에 없는 다수 migration version이 있고 최신 운영 version은 `20260812045342`다. V3 파일 5개는 모두 그보다 과거 timestamp이며 운영에는 없다.

따라서 다음은 금지한다.

- 현재 상태에서 일반 `db push` 또는 `--include-all` 실행
- CLI가 제안한 수백 개 migration의 일괄 `migration repair --status reverted`
- V3 SQL 적용 전 `migration repair --status applied`

승인된 staging clone에서 V3 SQL 5개를 순서대로 검증한 뒤, 운영 change window에서 SQL을 같은 순서로 선택 적용하고 object/column/function을 확인한 후 정확히 그 5개 version만 history에 기록해야 한다. 이 절차는 `docs/runbooks/blog-publishing-v3.md`에 고정했다.

## 재현 명령

```powershell
npx tsx scripts/verify-blog-production-readiness-v3.ts `
  --strict `
  --base=https://www.yeosonam.com `
  --production-branch=main `
  --production-commit=<immutable-sha> `
  --database-errors-7d=<vercel-observed-count>

npx supabase db push --linked --include-all --dry-run
```

첫 명령은 SELECT와 공개 HTTP GET만 사용한다. 두 번째 명령은 dry-run이지만 현재 migration-history drift 때문에 실패하는 것이 예상 결과다. 상세 evidence는 `blog-quality-engine-v3-production-readiness-2026-08-12.json`에 저장한다.
