# YEOSONAM OS Revenue Rescue Evidence

이 디렉터리는 2026-07-29 P0 revenue rescue의 일회성 증거 보관소다. 운영 정책이나 현재
SSOT가 아니며, 모든 값은 아래 고정된 repository·deployment·project 문맥에서만 해석한다.

- Repository: `https://github.com/Junsung257/yeosonam_os.git`
- Audited main HEAD: `eb582cabd6d16b98bd26ca8fca8ddc740fb80845`
- Production deployment: `dpl_921Z3DpkGB8GK4AWu8MGfgtePoXz`
- Production commit SHA: `eb582cabd6d16b98bd26ca8fca8ddc740fb80845`
- Supabase project: `Yeosonam_OS` (`ixaxnvbmhzjvupissmly`)
- Started: `2026-07-29T09:55:26.5861253Z` / `2026-07-29T18:55:26.5861253+09:00`

`queries/`는 재실행 가능한 read-only SQL, `outputs/`는 관측 결과, `screenshots/`는 실제
production 고객 화면 증거다. 비밀키와 고객 단위 PII는 저장하지 않는다.

보안 심층 스캔 플러그인은 worker process 생성 단계에서 `spawn EPERM`으로 종료됐다.
동일 스캔을 반복하지 않고 실패 manifest를 보존한 뒤, repository와 runtime surface를
직접 연결하는 focused validation으로 계속했다.

보안 finding의 actor-to-sink 판정, 브랜치 수정 상태, production 적용 전 요구사항은
`security-verdicts.md`에 기록했다. RLS migration과 비밀키 설정은 production에 적용하지 않았다.
