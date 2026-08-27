# Blog V4 자동발행 활성화 점검

점검일: 2026-08-18 (Asia/Seoul)

운영 엔드포인트 두 곳을 `CRON_SECRET` 인증으로 조회하는 읽기 전용 점검을 실행했다. 환경변수·DB·글 상태·배포는 변경하지 않았다.

```text
npm run verify:blog-autopublish-activation-v4 -- --base=https://www.yeosonam.com --json --strict
```

결과:

- 운영 source: `main` / `94f7a472fc56063bd63148ec651c8f5f57fc4574`
- 생성: `BLOCKED / generation_cron_disabled` (`BLOG_GENERATION_CRON_ENABLED=false`)
- 발행: `BLOCKED / deployment_provenance_failed` (`production_git_ref_missing`, `production_commit_sha_missing`)
- 종합: `ready=false`

따라서 현재 “자동발행이 안 되는” 원인은 DeepSeek 품질 라우팅 하나가 아니라 (1) 생성 cron 비활성, (2) production build provenance 미노출로 인한 정책의 `draft_only` 강등이다. `draft_only`에서는 생성 결과가 공개 상태·색인 outbox·캐시 재검증으로 넘어가지 않는 것이 정상이다.

활성화는 V4 readiness 여섯 scope, forward migration, snapshot parity, analytics canary, rollout state를 먼저 통과한 뒤 승인된 change window에서 생성 cron을 켜고 `live`를 별도 전환해야 한다. 이 증거만으로 운영 값을 바꾸거나 migration을 적용하지 않는다.
