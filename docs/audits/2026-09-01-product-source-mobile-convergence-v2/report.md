# 상품 원문 → 고객 모바일 수렴 V2 운영 감사

- 실행일: 2026-09-01 (Asia/Seoul)
- 배포 소스: `e7b088ff1220b439eb18a3d030de8d18576a7974`
- 배포 시점 `origin/main`: `0eedb00339fca3a4198c42ebcab60ebc275ae4ca`
- 브랜치: `codex/product-source-mobile-convergence-v2`
- 운영 배포: `dpl_3jKNTBMrf2TbH4Aj8RPPP2tUZcXS`
- 판정: 고객 읽기·판매상태·모바일 상세/LP/CTA 수렴은 운영에서 통과. 100건 원문 정확도와 점진 자동공개는 아직 HOLD.

## 결론

이 작업은 불가능한 작업이 아니다. immutable source/revision/snapshot/pointer 구조와 실제 고객 화면은 이미 존재했고, 실패 원인은 AI 성능 하나가 아니라 서로 다른 읽기 권위, 판매중지 처리, revision 상태, 브라우저 proof 실패 분류, 배포 기준선 불일치였다.

이번 변경으로 현재 공개 포인터를 기준으로 한 고객 상세와 모바일 LP가 같은 snapshot을 읽는 경계를 운영에 반영했고, 공개/판매중지/미존재 상태와 CTA를 실제 운영 모바일 브라우저에서 검증했다. 그러나 공개 상품 한 건의 성공을 임의의 랜드사 원문 100건 정확도로 확대 해석하지 않는다. 전역 `publication_freeze=true`를 유지하며 G5 reviewed corpus와 G6 canary가 남아 있다.

## 반영한 경계

1. 고객 `/packages/{id}`와 `/lp/{id}` preflight를 service-role 전용 단일 RPC로 수렴했다.
2. RPC는 `PUBLIC`, `SALE_UNAVAILABLE`, `NOT_FOUND`, `UNAVAILABLE`과 최소 identity만 반환한다. raw revision/snapshot/hash를 노출하지 않는다.
3. server credential이 없거나 RPC가 실패하면 anon fallback 없이 503으로 닫힌다.
4. 공개 snapshot 계보는 맞지만 active sale overlay가 있으면 410, 없는 UUID면 hard 404다.
5. 안전한 degraded publication transaction 안에서 exact `needs_review` revision만 `verified`로 승격할 수 있게 했다.
6. supplier profile은 internal schema 직접 Data API 조회 대신 service-only RPC로 읽는다.
7. 브라우저 proof 실패를 lineage, customer content, interaction, visual asset, runtime, infrastructure, contract로 분류했다. 데이터 오류는 자동 재시도하지 않는다.

## 운영 DB 증거

- 적용 migration:
  - `20260818084354_product_registration_degraded_revision_promotion.sql`
  - `20260901082833_product_registration_customer_read_boundary.sql`
- authority: `kernel`
- contract: `product-registration-authority-1`
- publication freeze: `true`
- pointer invariant:
  - 적용 전 count 26, digest `2fb009f264901afeaa78152407c719c4`
  - 적용 후 count 26, digest `2fb009f264901afeaa78152407c719c4`
  - 공개 포인터 변경 0
- 새 RPC execute grant:
  - `service_role=true`
  - `anon=false`
  - `authenticated=false`
- internal resolver는 `SECURITY DEFINER`, public wrapper는 `SECURITY INVOKER`이며 둘 다 고정 `search_path`를 사용한다.
- 새 함수 네 개에 대한 Supabase security/performance advisor 신규 경고는 0건이다.

## 운영 route matrix

최종 staged 배포와 promote 후 `https://www.yeosonam.com`에서 같은 결과를 확인했다.

| 경로 | 기대 | 결과 |
|---|---:|---:|
| `/packages` | 200 | 200 |
| `/packages/fbca42ad-50cd-4622-bde0-5dc13009e833` | 200 | 200 |
| `/lp/fbca42ad-50cd-4622-bde0-5dc13009e833` | 200 | 200 |
| suspended 상품 상세 | 410 | 410 |
| suspended 상품 LP | 410 | 410 |
| 임의 미존재 UUID 상세 | 404 | 404 |
| 임의 미존재 UUID LP | 404 | 404 |

알려진 판매중지 표본은 `2624427e-8e9c-45d3-90e5-a0af602a22d3`이다. service RPC 직접 호출에서도 공개 표본은 `PUBLIC`, 판매중지 표본은 `SALE_UNAVAILABLE`, 임의 UUID는 `NOT_FOUND`를 반환했다.

## 390×844 실제 고객 브라우저 증거

공개 표본 `fbca42ad-50cd-4622-bde0-5dc13009e833`을 운영 도메인에서 검증했다.

### 상품 상세

- 상품명: `다낭·호이안 노팁·노옵션 자유일정 3박5일`
- 최저가: `499,000원`
- 항공: `진에어`, `LJ111`, `LJ112`
- 기간: `3박 5일`
- DAY 1~5 일정, 포함/불포함, 발권·취소 안내가 실제 DOM에 존재했다.
- viewport 390, document scroll width 375로 가로 overflow가 없었다.
- 첫 DOM snapshot에는 Next.js streaming `loading.tsx`의 접근성 문구가 보였지만 5초 뒤 실제 상품 전체가 렌더됐다. SSR HTML과 최종 hydrated DOM 모두 상품 사실을 포함했고 runtime error는 없었다.

### 모바일 LP

- 상품명, LJ111/LJ112, 5일 전체 일정, 포함/불포함, 약관이 실제 DOM에 존재했다.
- 원문 가격표의 2026-08-25 KRW 539,000과 2026-08-31 KRW 499,000은 immutable snapshot에는 보존되지만 2026-09-01 기준 현재 출발 가능일·최저가·상담 기본값에서는 제외됐다.
- LP는 `현재 요금 상담 확인`과 `원문에 기재된 출발일이 모두 지났습니다`를 표시하며, 화면 본문에 8/25·8/31을 출발 가능일로 노출하지 않았다.
- viewport 390, document scroll width 375로 가로 overflow가 없었다.
- `일정·인원 입력하고 상담받기`를 실제 클릭했다.
- `상담 신청 (1/3)` dialog, 빈 희망일 입력, 성인/아동 인원, 이름, 휴대폰 번호, 개인정보 및 특별약관 필수 동의가 열렸다. 희망일의 최소값은 KST 기준 `2026-09-01`이고 과거 출발일·가격 기본값은 없었다.
- 실제 고객 상담 레코드를 만들지 않기 위해 입력·제출은 하지 않았다.

## 배포 안전성

- 최초 staged `dpl_66P849cih7nzdvVJ8nLhSnbnLFNH`는 미존재 route가 soft-404 200이라 promote하지 않았다.
- 수정 staged `dpl_Eno6XzUzTxG3VvdtzxSfyytLvpJP`는 route matrix를 통과했지만 작업 중 main이 전진해 최신 마케팅/readiness 변경을 되돌릴 수 있어 promote하지 않았다.
- 최신 main rebase 후 CLI deployment `dpl_FSpdc3aR9titJPbKP7Yj48fgZWAg`는 Git author의 Vercel team access 때문에 build 전 BLOCKED 됐고 운영 영향은 없었다.
- exact detached worktree에서 Git author metadata만 배포 입력에서 제외해 만든 `dpl_7HjsoUQRHuh7qRv9ztbKw2XqemvB`를 최초 운영 승격했다.
- 운영 모바일 재검증에서 지난 8월 출발일을 현재 선택 가능한 가격처럼 보이게 하는 문제를 발견했다. `ce65a38e5`는 현재 KST 이후 price rows만 현재 재고로 사용하도록 고쳤지만 staged `dpl_Fxi6qMyKEES7a9wJhpz6mdKnuxxe`에서 이전 300초 mapped payload cache가 과거 `departureFullDate`를 재사용해 promote하지 않았다.
- cache contract를 `lp-package-v4-current-inventory-source-notices`로 올린 source의 `dpl_EiN8LCMNspybbZVMpS4xA5J7rbuA`를 promote한 뒤, `origin/main`이 비활성 cron 정리 `0eedb0033`까지 전진했다. 다른 팀의 최신 운영 변경을 되돌리지 않기 위해 최신 main에 rebase하고 exact source `e7b088ff1`의 `dpl_3jKNTBMrf2TbH4Aj8RPPP2tUZcXS`를 다시 staged 검증한 뒤 최종 promote했다.
- 최종 staged와 production 모두 `departureFullDate=null`, `priceFrom=0`, 과거 기본값 없음, 200/410/404 matrix를 통과했다. 운영 JavaScript asset에도 최종 deployment ID가 확인됐다.
- 직전 production rollback 기준은 `dpl_EiN8LCMNspybbZVMpS4xA5J7rbuA`, 그 이전 기준은 `dpl_7HjsoUQRHuh7qRv9ztbKw2XqemvB`다.
- 로컬 Vercel CLI 53.3.2는 compile/page generation 후 `/api/rss` lambda packaging에서 실패했지만 remote builder CLI 59.3.0은 같은 소스를 정상 빌드했다. 앱 TypeScript/Next compile 오류가 아니라 로컬 CLI package assembly 차이로 분류했다.

## 검증

- read-boundary focused Vitest: 4 files, 83 tests 통과
- current-inventory/cache focused Vitest: 5 files, 53 tests 통과
- latest-main integrated focused Vitest: 9 files, 136 tests 통과
- TypeScript: 통과
- touched-file ESLint: 통과
- `git diff --check`: 통과
- migration prefix CI: 신규 collision 0
- product-registration authority: `authorized=1`, `legacy=0`, `unapproved=0`
- `check:product-registration-contract` 전체 명령의 별도 문서 계약 실패는 `docs/ai-agent-doc-automation.md`의 기존 누락 두 항목이며 이 변경의 authority 경계와 무관하다.

## OSS/MCP 결정

세부 비교는 `oss-adoption.md`에 있다. 가장 높은 ROI는 `hwplib/hwpxlib/hwp2hwpx` 독립 shadow parser, reviewed benchmark, `fast-check`, pgTAP, 실제 모바일 proof의 결합이다. Docling은 born-digital PDF/Office, PaddleOCR PP-Structure는 scan/image cohort에만 사용한다. parser는 candidate IR만 만들며 DB credential이나 자동 공개 권한을 갖지 않는다.

기존 Browser, Vercel, Supabase, GitHub CLI로 현재 병목을 검증할 수 있어 새 browser/GitHub MCP나 범용 agent framework는 추가하지 않는다. Label Studio와 기존 admin을 동시에 운영하지 않고 사람 정답 도구는 하나만 선택한다.

## 남은 필수 게이트

1. 최소 10개 공급사/문서군 30건을 봉인하고 100건으로 확장한다.
2. 가격·출발일 pairing과 critical false publication은 0/100이어야 한다.
3. 가격·날짜·기간·항공·필수비용은 각 95% 이상, 가중 평균 97% 이상이어야 한다.
4. source-unbound customer fact 0, replay hash 100% 동일이어야 한다.
5. exact revision/snapshot/proof/release manifest 대상만 1→5→20→100 canary로 공개한다.
6. 각 단계는 24시간 관찰하며 critical false publish, 공개 503, lineage/build mismatch, tenant cross-read가 하나라도 있으면 즉시 freeze한다.

따라서 현재 판정은 **기술적 성공 가능, 고객 읽기·운영 모바일 경계 성공, 원문 100건 자동 정확도는 아직 미증명**이다.
