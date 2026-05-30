# 2026-05-30 Launch Readiness Audit

## Verdict

현재 프로덕션(`https://www.yeosonam.com`)은 읽기 전용 스모크 기준으로 대부분 정상 응답하지만, 고객 오픈 승인은 보류한다.

오픈 전 필수 조치:

1. 현재 로컬 최신 빌드 기준 코드를 프로덕션에 배포한다.
2. 추적 파일 `.env.prod`에 남아 있던 실제처럼 보이는 DeepSeek API 키는 플레이스홀더로 교체했지만, Git 이력에 노출됐을 가능성이 있으므로 공급자 콘솔에서 키를 회전한다.
3. 배포 후 `BASE_URL=https://www.yeosonam.com npm run audit:public-critical`를 재실행해 상품 상세까지 7/7 PASS를 확인한다.

## Fixed / Confirmed

- 상품 상세 `/packages/[id]`의 App Router 스트리밍 초기 HTML에 의미 있는 H1, 설명, CTA가 잡히도록 서버/로딩 상태의 접근성·SEO 신호를 확인했다.
- `/api/v1/health`는 라우트 설명상 비인증 헬스체크이므로 미들웨어 공개 경로에 포함된 상태를 확인했다.
- `.env.prod`의 실제처럼 보이는 DeepSeek API 키 값을 `xxx` 플레이스홀더로 교체했다.

## Local Verification

- `npm run type-check`: PASS
- `npm run lint`: PASS
- `npm test`: PASS, 81 files, 1018 passed, 1 skipped
- `npm run build`: PASS, 561 static pages generated, Vercel functions entries 24/50
- `BASE_URL=http://localhost:3000 npm run audit:public-critical`: PASS, 7/7
- `GET http://localhost:3000/api/v1/health`: 200, `status=healthy`
- Targeted tracked-file secret grep: no remaining matches after excluding lock/report/build/vendor artifacts

## Production Smoke

Read-only checks only. Cron routes were not executed because they may mutate production data.

- `/`, `/packages`, `/concierge`, `/group-inquiry`, `/blog`, `/destinations`: 200
- `/destinations/%EB%B3%B4%ED%99%80`: 200
- `/destinations/%EB%B3%B4%ED%99%80/rss.xml`: 200
- `/robots.txt`: 200
- `/sitemap.xml`: 200
- `/admin`: 307 to `/login?redirect=%2Fadmin`
- `/admin/blog/queue`: 307 to login redirect
- `/api/v1/health`: current production returned 307 to login; local latest build returns 200, so deploy is required
- `BASE_URL=https://www.yeosonam.com npm run audit:public-critical`: FAIL 1/7, package detail missing initial HTML signals on current production

## Remaining Risks

- P0: Rotate the exposed-looking DeepSeek key. Replacing `.env.prod` prevents future template leakage, but it does not invalidate a key that may already be in Git history.
- P1: Current production is behind local verified build for package-detail semantic smoke and `/api/v1/health`.
- P2: Local start still warns about missing optional integration env vars: SERPAPI, RSS/social/naver/google ads/slack family. These did not block core build or customer smoke, but should be reconciled before enabling those jobs/features.
- P2: `docs/deploy-checklist.md` cron count appears stale compared with `vercel.json`; update the checklist before the next release train.

