# 여소남 OS — 전체 기능 및 DB 스키마 현황 (2026-05-28 기준)

## 2026-08-12 상품등록 실제 HWP 고객 흐름 검증
- 2026-08-13 로컬 통합 브랜치에서 다중상품 문서 끝의 공통 포함·불포함·취소조건을 각 상품 구간에 안전 상속하는 문맥 계층을 추가했다. 동일 제목이 여러 번 나오면 상품별 조건으로 간주해 섞지 않는다.
- 고객 시차 계산은 DB의 절대 UTC 오프셋을 한국 기준 차이로 변환하도록 고쳐 코타키나발루(UTC+8)를 `한국보다 1시간 느림`으로 표시한다.
- 공개 포인터는 정확한 published snapshot·revision·passed proof·renderer build와 한 transaction에서 일치해야 하며, 기존 불일치 포인터는 순방향 migration 적용 시 감사행을 남기고 자동 격리된다.
- 기존 항공정보 574건 중 원문 편명·양쪽 시간·단일 출발일·노선을 모두 검증할 수 있는 것은 58행/24개 날짜별 사실/17편이다. 독립 원문 두 개가 즉시 일치하는 사실은 2개뿐이므로 나머지는 자동 보완 근거로 승격하지 않는다. 신규 원문 명시값은 최우선이며 누락값만 독립 검증 자료로 채운다.
- 40개 HWP 전체 재검증 결과 추출·정규화 40/40, 상품 구간 66개이며 V6 기준 verified 1, 안전 축약 degraded 52, 자동 차단 13이다. 따라서 구조상 자동 종결·공개 후보는 53/66(80.30%)이고 critical evidence는 248/248이다.
- 이 80.30%는 정답지 대조 정확도가 아니다. 운영 DB에는 `structural_only`, `passed=false`, exact match 미측정으로 기록해 99.5% 정확도 게이트를 우회하지 못하게 했다.
- 고객 검색, B2B v1, 제휴 공개·랜딩·임베드·추천 링크, 블로그 상품 연결·목적지, RSS, 일정 인쇄, 마케팅 콘텐츠 생성은 현재 publication pointer의 immutable snapshot만 읽도록 전환했다.
- 중단된 과거 V6 작업 2건을 dead-letter 후 terminal 처리해 미완료·stale 작업은 0건이다. watchdog은 heartbeat를 한 번도 쓰지 못한 작업도 회수한다.
- Vercel 번들 Chromium 준비상태 오판, ISO 연도 숫자를 항공시간 `20:26`으로 읽던 오류, 연도만 있는 값을 항공편명으로 읽던 OCR 오류를 수정하고 회귀 테스트를 추가했다.
- 실제 마쓰야마 HWP canary는 source → EvidenceIR → immutable revision → customer snapshot → 390x844 Chrome 상세/LP proof까지 terminal `published_degraded`로 완료됐다.
- 저장 proof를 직접 확인하며 발견한 서버리스 Chromium 한글 공백과 긴 화면 고정요소 반복 문제를 수정했다. 현재 proof는 번들 한글 폰트를 필수로 확인하고, CTA를 열기 전 실제 첫 390x844 화면을 private Storage에 보존하며, 전체 내용·스크롤·CTA는 별도 자동 검사한다.
- 고객 CTA proof 중 발견한 `lead_sheet_open` 점수 신호 DB 제약 불일치를 순방향 migration으로 보완했다. 실제 API 삽입 성공과 검증용 행 정리까지 확인했다.
- 가격 10건, 3일/2박 일정, BX134/BX133, 포함 7건, 불포함 5건이 원문과 일치하고 critical/high evidence는 8/8이다. 상세와 LP 모두 CTA, snapshot/build hash, 금지문구, 깨진 이미지, hydration 검사를 통과했다.
- 실제 사용권 이미지가 없어 브랜드 fallback만 표시되고, OAG/Cirium 이중 검증이 없어 항공시간은 고객 화면에서 숨겼다. 전역 freeze를 유지해 publication pointer와 고객 공개 상태는 변경하지 않았다.
- 남은 고객 오픈 게이트는 기존 989건 shadow 분류, 대표 공급사 cohort 정확도, media provenance 자동 보완, 실 OAG/Cirium/OCR provider 정책, bounded CAS 공개와 surface convergence다. 한 건의 성공 canary는 전체 80% 자동 공개율을 증명하지 않는다.

## 2026-08-11 상품등록 통합 권한 기준선

- 신규 흐름은 `EvidenceIR → immutable revision → compatibility projection → immutable snapshot → private proof → CAS pointer` 순서다. `products`와 `travel_packages`는 권위 원천이 아니라 revision 이후 생성되는 호환 projection이다.
- 운영 Supabase에는 상품등록 순방향 migration 18개를 저장소 순서대로 적용했고, tenant/catalog/revision/snapshot/pointer의 null·placeholder 차단 수는 모두 0이다. schema finalizer `product-registration-authority-hardened-1`도 통과해 tenant FK 검증이 끝났고 구형 공개 RPC 실행권은 회수됐다.
- 운영 모드는 `shadow`, 전역 `publication_freeze=true`를 유지한다. 따라서 스키마는 강화됐지만 검증되지 않은 신규 상품을 자동 공개하지 않는다.
- 고객 snapshot 본문·hash·projection·renderer lineage는 이제 DB에서 수정·삭제가 금지된다. 공개 뒤 수정은 기존 행 변경이 아니라 새 snapshot과 새 proof를 만들어야 하며, 공개 pointer가 참조 중인 snapshot은 상태를 내릴 수도 없다.
- Supabase 성능 점검이 지적한 상품등록 복합 연결키를 모두 보완했다. 추가한 public-schema 인덱스 8개는 운영 DB에서 valid/ready로 확인됐고, 상품등록의 미인덱스 foreign key는 0건이다.
- 고객 `/api/packages`, 홈, 목적지, sitemap은 authority mode와 무관하게 publication pointer와 immutable snapshot만 사용한다. mutable `travel_packages`의 `active/published` 표지만으로는 고객 상품이 되지 않는다.
- `/packages/[id]`의 title·description·OG metadata도 본문과 같은 publication pointer snapshot을 사용한다. 차단/404 상품은 레거시 상품명·가격·목적지를 검색엔진·메신저 미리보기에 흘리지 않고 읽을 수 있는 한국어 일반 안내와 `noindex`만 반환한다.
- 라이브 감사에서 기존 코타키나발루·후쿠오카 표시 상품 2건을 모두 권위 체인 실패로 차단했다. 후쿠오카는 저장 가격 85건과 snapshot 84건이 달랐고 모바일 proof가 현재 상태보다 오래됐으며 customer-open contract도 blocked였다.
- 기존 internal-code backfill은 tenant를 비교하지 않아 813건을 다른 tenant identity에 연결할 위험이 있었다. 현재 migration은 동일 tenant의 유일한 코드만 연결하고 중복·충돌은 별도 catalog identity로 격리한다.
- 기존 989건 shadow backfill, 실 OAG/Cirium/OCR provider, 실제 HWP canary, Chrome 모바일 proof, surface convergence가 남아 있다. 이 항목을 통과하기 전 전역 freeze 해제나 전량 공개는 금지한다.
- 현재 코드 검증은 authority `authorized=1 legacy=143 unapproved=0`, 전체 684개 파일·5,154개 테스트, production build(정적 페이지 389개) 통과다. 로컬 production build는 약 14분 38초가 걸렸고 Supabase/blog env가 없는 sitemap은 빈 목록으로 fail-closed했다.

> **정산센터 V4 안내형 작업대 (2026-08-12):** `/admin/finance`는 기본으로 `오늘 정산하기`를 열어 통장 대사 → 여행 거래 → 위험 예약 → 일반 예약 → 회사 거래 → 월 마감 → 증빙 순서로 안내한다. 기존 전문 탭과 원장·검토·마감 스냅샷은 그대로 유지하며, 회사 거래는 최대 200건까지 stale-check·멱등성·감사로그를 포함해 원자적으로 일괄 확정한다. 세금 할 일은 예약별로 중복 제거하고 정산 화면의 익명 계측에는 금액·고객·거래·메모를 전송하지 않는다. 상세 계약: `docs/settlement-current-ssot.md`.
>
> **정산센터 V3 무결성·UX 보강 (2026-08-11):** `/admin/finance`는 Clobe 신한 4128 거래를 분할 원장으로 관리하며 사장님의 예약별 `정산 확인` 없이는 월 확정수익에 포함하지 않는다. Clobe no-op 동기화는 결정을 무효화하지 않고 실제 메모·금액·배분 변경만 재검토를 만든다. 열린 여행 보호금은 예약별 고객 보유금과 남은 원가 중 큰 금액으로 계산해 이중 차감하지 않으며, 동기화는 4시간마다 최대 1,000건을 페이지로 읽고 초과 시 누락 없이 차단한다. 모바일 예약 검토, 예외 예약 식별, 회사 메모 전체 표시, 판매가·원가·검토 세금 할 일도 통합했다. 상세 계약: `docs/settlement-current-ssot.md`.

> **AI 운영실 V1 (2026-07-28, 로컬 코드):** 기존 `agent_tasks`, `agent_approvals`, `agent_incidents`, `agent_trace_spans`를 `correlation_id` 작업실로 묶는 읽기 전용 통합 스냅샷과 `/admin/agent-mas` 운영 화면을 추가했다. 24시간 미갱신 작업과 7일 이상 지난 무기한 승인을 정체·기한 경과로 분리하며, 버전된 durable resume 상태가 연결되기 전까지 승인 큐는 관찰 전용이다. 실행은 백엔드 durable workflow, 스레드는 증거 타임라인, 외부·금전·고객 변경은 승인 경계라는 하이브리드 모델이며 자동 멀티에이전트 실행은 아직 열지 않았다. 상세 SSOT: `docs/agent-office-current-ssot.md`.

> **AI operations baseline (2026-06-29):** `/admin/control-tower` and `/api/admin/automation-command-center` expose a read-only snapshot for Jarvis readiness, Ad OS 95+ evidence, approval packets, blockers, and the next safe click. Booking, payment, refund, PII, and external ad-spend actions remain behind the existing HITL/approval paths.

> **Agent runtime lifecycle hardening (2026-07-29):** request-scoped QA/Jarvis tasks and traces are terminalized before response streams close; approvals default to a seven-day expiry; the existing agent executor performs bounded cleanup for legacy no-expiry approvals, stale request tasks, and open traces even when resource-saver mode skips non-critical publishing work. The unused approval-decision endpoint was removed until a versioned resumable run state exists. No autonomous multi-agent executor was enabled. Details: `docs/agent-office-current-ssot.md`.

> **정보성 블로그 근거 모델 (2026-07-24, 운영 스키마 적용):** `blog_information_sources`, `blog_information_source_versions`, `blog_information_evidence`, `blog_information_claims`, `blog_information_claim_evidence`는 상품 evidence/snapshot과 분리된 서버 전용 namespace다. 운영 읽기 감사 기준 source 1건, source version 21건, evidence 147건, claim 48건이며 active 공식 출처 12개, 의도별 공식 원문 16개, 검토된 비공식 출처 6개다. 검색 스니펫은 근거가 아니며, 승인된 URL의 실제 원문을 직접 수집·검증한 뒤에만 글쓰기를 시작한다.

> **정보성 대표키·canonical (2026-07-19, 운영 스키마 적용):** `blog_information_representatives`가 `destination_id + intent + audience + locale`당 신규 공개 URL을 하나로 제한한다. 기존 공개 글은 자동 backfill·redirect·병합하지 않는다.

> **R18 연구 우선 비공개 재생성 (2026-07-19):** 비공개 단일 재생성은 검증된 `information_research_bundle`을 글쓰기 전에 검사하고 기존 `blog_information_*` 감사 체인에 저장한다. 누락·오래된 근거·목적지/언어 불일치·의도별 claim 부족·저장 실패는 AI 호출 전에 `skipped + self_heal_blocked`로 보류한다. 2026-07-24부터 일반 자동발행도 아래 검토 원문 직접수집 계약으로 같은 preflight를 강제한다. Pexels 관련 이미지가 없으면 AI 참고 이미지를 생성할 수 있지만 공개 alt/caption에 `AI 생성 참고 이미지`를 표시하고 사실 근거로 취급하지 않는다.

> **일반 자동발행 검토 원문 직접수집 (2026-07-24, 로컬 코드):** 일반 정보성 큐도 writer 호출 전에 `src/lib/blog-auto-research.ts`가 Google Search를 URL 발견에만 사용하고, 의도별 승인 레지스트리와 일치하는 HTTPS 원문을 직접 내려받아 source snapshot span·claim/evidence 연결을 만든다. 두 번째 research preflight가 실패하면 `evidence_insufficient`로 차단한다. 검색 스니펫·미검토 도메인·출처 유형 오표기는 근거가 될 수 없으며 입국/비자·보험은 계속 사람 검수가 필수다.

> **블로그 공개면 운영 판독 (2026-07-24):** `content_creatives`의 `published + naver_blog` 원본은 148건이지만 `public_blog_content_creatives`는 0건이다. 기존 글에는 현행 research bundle·대표키·claim 검증이 없으므로 공개 목록·API·sitemap에서 제외되는 것이 정상이다. 근거 없이 문장만 고쳐 재공개하지 않는다.

> **정보성 관련 글 랭킹 (2026-07-15, 로컬 코드):** 신규 정보성 글은 목적지·의도·국가/권역·특정 고객군·편집 클러스터를 기준으로만 내부링크를 추천한다. 미발행·noindex·redirect·비canonical 후보를 제외하고, 관련 후보가 없으면 빈 결과를 허용한다. 상품성·레거시 글의 기존 경로는 유지한다.

> **정보성 CTA 허브 (2026-07-15, 로컬 코드):** 정보성 본문은 CTA URL을 생성하지 않고 공개 렌더러가 중앙 설정에서 목적지·의도·위험도·언어에 맞는 CTA를 최대 2개 선택한다. 외부 URL 미설정·불명확 시 관련 글만 표시하며, 입국·비자·보험 고위험 글은 관련 정보를 우선한다. 상품성 CTA 경로는 유지한다.

> **정보성 최종 렌더 SEO QA (2026-07-15, 로컬 코드):** 발행 게이트가 공개 페이지와 같은 렌더러·sanitizer로 H1, 메타 의도, 마크다운 잔여물, 표/빈 제목, placeholder, canonical/index, JSON-LD, CTA 중복을 검사한다. 새 정보성 글의 읽기 시간은 `quality_gate.rendered_reading_time_minutes`에 저장해 목록·상세가 같은 값을 사용한다. 상품성 발행 계약은 유지한다.

> **정보성 V2 고정 평가 세트 (2026-07-15, 로컬 fixture):** `npm run eval:blog-info-v2`가 지정된 11개 샘플의 intent·필수 사실·근거/claim·중복·관련 글·CTA·렌더·발행 상태를 외부 호출과 공개 데이터 변경 없이 평가한다. 현재 생성 보고서는 11/11 PASS이며 고위험 글은 `pending_review`, 잘못된 목적지는 `blocked_plan`, 대표키 중복은 `update_existing`으로 확인됐다.

> **정보성 기존 글 dry-run·운영 인수 (2026-07-15, 로컬 표본):** `npm run audit:blog-info-v2`는 apply 모드 없이 로컬 JSON/fallback 표본만 `KEEP|REWRITE|MERGE|REMOVE|HIGH_RISK_REVIEW`로 분류한다. 기본 표본 8건은 REWRITE 8건으로 제안됐고 DB 읽기·쓰기·외부 호출은 모두 0이다. 운영 DB 전체 결론이 아니며 후속 정리는 `docs/blog-informational-engine-v2-owner-runbook.md`의 사람 승인 절차를 따른다.

> **헌법 기준 (2026-06-28):** 최상위 제품 원칙과 MVP 경계는 `docs/yeosonam-os-constitution.md`를 우선 확인한다. 이 파일은 2026-05-28 기준 운영 스냅샷이므로 실제 기술 스택은 `package.json`, 최신 스키마는 `supabase/migrations/**`, 도메인별 최신 규칙은 `docs/*-current-ssot.md`와 함께 대조한다.

> **최근 작업 (2026-05-28):** as any 전수조사/제거, 타입 안전성 대폭 개선, 마일리지 시스템 전면 구현 (적립/사용/소멸/개인화/알림/분석), 게이미피케이션(출석/도전과제) 추가

> AI·코파일럿 진입 요약: 루트 **`AGENTS.md`** → (심층) `.claude/CLAUDE.md`.

> Agent workflow note: Superpowers는 설치 가능 시 일반 개발 절차 보조로 사용하되, 여소남 도메인 SSOT가 항상 우선입니다. 상세: `docs/agent-superpowers-adoption.md`.

> MCP tooling note: Codex 전역 MCP에 Context7, Serena, apifable을 연결했습니다. 상세: `docs/agent-mcp-tooling.md`.

---

## 1. 어드민 사이드바 메뉴 + 세부 기능

### 1-1. 운영 (Operations)

| 메뉴 | 경로 | 세부 기능 |
|------|------|-----------|
| **대시보드** | `/admin` | 월매출·확정출발·예약KPI, 6개월 캐시플로 예측, 패키지 승인현황, 예약 단계별 분포 |
| **예약 관리** | `/admin/bookings` | 예약 목록(상태별 필터·페이지네이션), 신규예약 생성(`/new`), 예약 상세(`/[id]`), 예약 수정(`/[id]/edit` — 가격변경 사유 추적), 상태 머신 전이(pending→fully_paid), 타임라인(message_logs) |
| **고객 관리** | `/admin/customers` | 고객 CRUD, 마일리지 이력, 예약 내역, 여권·생년월일, 메모, CRM 등급(신규~VVIP), 상태(잠재고객~여행완료) |
| **입금 관리** | `/admin/payments` | 입금 확인·매칭, 신한은행 SMS 파싱, bank_transactions 자동매칭 |
| **예약 안내문** | `/admin/booking-guide` | 예약확인서 템플릿, 인쇄/PDF 내보내기 |

### 1-2. 상품 (Products)

| 메뉴 | 경로 | 세부 기능 |
|------|------|-----------|
| **상품 관리** | `/admin/packages` | 패키지 CRUD, 마케팅 도구(AI SNS 카피·포스터 스튜디오·카드뉴스·광고성과 대시보드·Meta 자동발행) |
| **상품 검수** | `/admin/products/review` | QA 관제탑 — DRAFT/REVIEW_NEEDED 상태, AI 신뢰도 점수, 공급사 코드 매핑, 셀링포인트 추출 |
| **업로드** | `/admin/upload` | PDF/JPG/HWP 일괄 업로드, 큐 처리, 벌크 모드, 텍스트 직접입력, confidence 점수 |
| **랜드사 관리** | `/admin/land-operators` | 랜드사 CRUD, 인라인 편집, 소프트 삭제/복원 |
| **출발지 관리** | `/admin/departing-locations` | 출발지 CRUD, 인라인 편집, 소프트 삭제/복원 |
| **관광지 관리** | `/admin/attractions` | 관광지 DB, Pexels 사진 연동, 뱃지(tour/special/shopping/meal/optional/hotel/restaurant/golf), 벌크 사진 싱크, 미매칭 활동 관리(`/unmatched`) |

### 1-3. 영업 (Sales)

| 메뉴 | 경로 | 세부 기능 |
|------|------|-----------|
| **제휴/인플루언서** | `/admin/affiliates` | 제휴 관리, 등급(Bronze→Diamond), 커미션율, 지급유형(개인/사업자), 추천코드 생성, 상세(`/[id]` — 정산내역·커미션 이력·등급 진행) |
| **제휴 분석** | `/admin/affiliate-analytics` | 퍼널 분석(클릭→전환→매출→커미션), 월간 트렌드, 파트너 성과 랭킹 |
| **파트너 신청** | `/admin/applications` | 신청 심사 워크플로(PENDING/APPROVED/REJECTED), 자동 제휴 생성, 거절 사유 |
| **파트너 프론트 미리보기** | `/admin/partner-preview` | `/partner-apply`, `/with/[코드]`, `/influencer/[코드]` 새 탭 열기·추천코드 로컬 저장; 제휴 상세에서 `?code=` 링크 |
| **단체 RFQ** | `/admin/rfqs` | 단체 견적 관리, 상태(draft→contracted), KPI 카드, 입찰 추적, 상세(`/[id]` — 체크리스트·입찰·제안서·상태전이) |
| **컨시어지** | `/admin/concierge` | Mock API 설정(Agoda/Klook/Cruise), 트랜잭션 상태(PENDING→COMPLETED), SAGA 이벤트 로그, 바우처, 환불 처리 |
| **테넌트 관리** | `/admin/tenants` | 테넌트 CRUD, 커미션율, 상태(active/inactive/suspended), 월간 정산 통계 |

### 1-4. 재무 (Finance)

| 메뉴 | 경로 | 세부 기능 |
|------|------|-----------|
| **정산센터** | `/admin/finance` | 안내형 `오늘 정산하기`, 실제 통장 잔액·여행 보호금·사용가능액, Clobe 대사, 거래 검토, 예약별 현금마진, 출발 월 잠금·재개방, 회사거래 원자적 일괄 분류, 세금·증빙 통합 |
| **통합 장부** | `/admin/ledger` | 은행거래 매칭, AI 이상탐지(중복·대액·소액), 월별 수입/지출 차트, 자본 항목, match_status |
| **정산 관리** | `/admin/settlements` | 제휴 정산(기간 선택, PENDING→COMPLETED), 이월잔액, 세금공제(3.3%), PDF |
| **세무 관리** | `/admin/tax` | 월별 세무(이체상태, 현금영수증 ISSUED/NOT_ISSUED/NOT_REQUIRED, 부가세 추정, 문서 업로드) |

### 1-5. 마케팅 (Marketing)

| 메뉴 | 경로 | 세부 기능 |
|------|------|-----------|
| **마케팅 대시보드** | `/admin/marketing` | Meta 캠페인 개요, ROAS 등급, 월간 성과, 캠페인 링크 빌더, 분석 대시보드 |
| **크리에이티브** | `/admin/marketing/creatives` | 광고 소재 생성(carousel/single_image/text_ad/short_video), 채널별(Meta/Naver/Google), 상태 관리, hook 유형 |
| **카드뉴스** | `/admin/marketing/card-news` | 카드뉴스 목록·생성(패키지 기반 자동생성), 슬라이드 에디터(`/[id]` — 이미지 오버레이·비율 프리셋·내보내기) |
| **콘텐츠 허브** | `/admin/content-hub` | 3단계 콘텐츠 생성(패키지 선택 → AI 생성(앵글/채널/비율) → 슬라이드 편집/발행) |
| **검색광고** | `/admin/search-ads` | 키워드 관리(Naver/Google), 키워드 티어(core/mid/longtail/negative), 성과 싱크, 입찰 최적화 |

### 1-6. AI

| 메뉴 | 경로 | 세부 기능 |
|------|------|-----------|
| **자비스 AI** | `/admin/jarvis` | AI 대화형 운영 인터페이스, 빠른 명령(예약현황·상품추천·고객조회), 액션카드(예약/고객 생성·수정). 스트림 API는 전문가 라우팅(`resolveSpecialist`) 후 `agent_picked` 이벤트 전송 — 상세는 `docs/jarvis-orchestration.md` |
| **AI 생성** | `/admin/generate` | OpenAI/Claude/Gemini 콘텐츠 생성(설명·제목·혜택 추출·모델 비교) |
| **Q&A 챗봇** | `/admin/qa` | 고객 Q&A 챗봇, 패키지 추천, NDJSON 스트림·우측 **고객 여정** 패널. `POST /api/qa/chat`이 `conversations.affiliate_id`·`journey` 갱신, `x-affiliate-id`·바디 `affiliateRef`로 제휴 스코프 해석 |
| **AI 플라이휠** | `/admin/platform-learning` | `platform_learning_events` 적재 내역 조회(`qa_chat`, `qa_escalation_cta` 전화·카톡 버튼, 자비스 V1·V2 스트림). 원문 대신 SHA·payload 기본, `PLATFORM_LEARNING_STORE_REDACTED_MESSAGE` 시 마스킹 전문 — `docs/env-variables-reference.md`, `docs/platform-ai-roadmap.md` |

### 1-7. 시스템 (System)

| 메뉴 | 경로 | 세부 기능 |
|------|------|-----------|
| **OS 관제탑** | `/admin/control-tower` | 비즈니스 정책 엔진(9개 카테고리: pricing/mileage/booking/notification/display/product/operations/marketing/saas), 트리거/액션 설정, 우선순위 |
| **에스컬레이션** | `/admin/escalations` | `qa_inquiries` 대기 건 — 유형 `escalation`·`critic_blocked`·`escalation_cta`(전화·카톡 버튼, 고객 발화 요약 첨부). 필터: 파이프라인 전체 / CTA만 |

### 1-8. 공개(비로그인) 페이지

| 경로 | 설명 |
|------|------|
| `/` | 메인 홈 |
| `/packages`, `/packages/[id]` | 패키지 목록·상세 |
| `/influencer/[code]` | 인플루언서 전용 랜딩 (PIN 인증) |
| `/itinerary/[id]`, `/itinerary/[id]/print` | 일정표 뷰·인쇄 |
| `/lp/[id]` | 랜딩페이지 |
| `/with/[code]`, `/r/[code]/[slug]` | 제휴 코브랜딩 랜딩·단축 유입 링크 |
| `/concierge` | 컨시어지 (Agoda/Klook/Cruise) |
| `/group-inquiry`, `/rfq` | 단체문의·RFQ |
| `/tenant` | 테넌트 입점 |
| `/share` | 공유 일정표 |
| `/legal/partner-attribution` | 제휴 유입·쿠키 정책 안내 |

---

## 2. 전체 DB 테이블 목록 (61개+) + 주요 컬럼

### 핵심 (Core)

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 1 | **bookings** | `id`, `booking_no`(UNIQUE), `package_id`(FK), `lead_customer_id`(FK), `adult_count/price/cost`, `child_count/price/cost`, `infant_count/price`, `total_cost`(GEN), `total_price`(GEN), `status`(상태머신), `departure_date`, `affiliate_id`(FK), `referral_code`, `land_operator_id`(FK), `flight_out/in`, `is_ticketed`, `local_expenses`(JSONB), `surcharge_breakdown`(JSONB), `paid_amount`, `deposit_amount`, `utm_*`, `departing_location_id`(FK) | 예약 중심 팩트 테이블 |
| 2 | **travel_packages** | `id`, `title`, `destination`, `country`, `duration`, `nights`, `price`, `cost_price`, `raw_text`, `parsed_data`(JSONB), `itinerary`(TEXT[]), `inclusions`(TEXT[]), `confidence`, `status`, `category`, `price_tiers`(JSONB), `surcharges`(JSONB), `tenant_id`(FK), `land_operator_id`(FK), `seats_held/confirmed/ticketed`, `is_airtel` | 여행 패키지 마스터 |
| 3 | **customers** | `id`, `name`, `phone`, `passport_no`, `passport_expiry`, `birth_date`, `mileage`, `total_spent`, `booking_count`, `tags`(TEXT[]), `memo`, `status`(잠재~여행완료), `grade`(신규~VVIP), `source`, `cafe_sync_data`(JSONB) | 고객 마스터 |
| 4 | **products** | `internal_code`(PK, SKU), `display_name`, `departure_region`, `supplier_name/code`, `destination`, `net_price`, `margin_rate`, `selling_price`(GEN), `status`, `departure_date`, `ai_tags`(TEXT[]), `public_itinerary`(JSONB), `highlights`(TEXT[]) | 내부 ERP 상품 카탈로그 |

### 예약 관련

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 5 | **booking_passengers** | `booking_id`(FK), `customer_id`(FK), `passenger_type`(adult/child_n/child_e/infant), `seat_number`, `ticket_number` | 예약-고객 N:M 연결 |
| 6 | **booking_segments** | `id`, `booking_id`(FK), `segment_type`(flight/hotel/transport/activity/meal/guide), `sequence_no`, `cost_price`, `sell_price`, `margin`(GEN), `status`, `details`(JSONB) | 예약 구성 세그먼트(PNR) |
| 7 | **message_logs** | `id`, `booking_id`(FK), `log_type`(system/kakao/mock/scheduler/manual), `event_type`(DEPOSIT_NOTICE/CONFIRMED 등), `title`, `content`, `is_mock`, `created_by` | 예약별 커뮤니케이션 타임라인 |

### CRM / 마일리지

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 8 | **customer_notes** | `id`, `customer_id`(FK), `content`, `channel`(phone/kakao/email/visit/cafe/sms) | 고객 상담 메모 |
| 9 | **customer_unified_profile** | `id`, `customer_id`(FK, UNIQUE), `rfm_r/f/m`(1-5), `rfm_segment`, `ltv_estimate`, `preferred_destinations`(TEXT[]), `lifecycle_stage`, `churn_risk_level`, `propensity_scores`(JSONB), `next_best_action` | 고객 360° 프로필 |
| 10 | **mileage_history** | `id`, `customer_id`(FK), `booking_id`(FK), `delta`(±), `reason`, `balance_after` | 마일리지 적립/사용 원장 |
| 11 | **mileage_transactions** | `id`, `user_id`(FK), `booking_id`(FK), `amount`, `type`(EARNED/USED/CLAWBACK), `margin_impact`, `mileage_rate`(5%), `ref_transaction_id`(자기참조) | 수익 기반 마일리지 회계 |
| 12 | **customer_mileage_balances** | `user_id`, `balance`, `total_earned`, `total_used`, `total_clawback` | (View) 마일리지 잔액 |
| 13 | **mileage_expiration_policies** | `id`, `validity_months`(24), `notify_before_days`({30,7}), `auto_expire`, `extend_on_activity` | 마일리지 소멸 정책 |
| 14 | **mileage_challenges** | `id`, `title`, `condition_type`(booking_count/new_destination/review_photo/referral), `reward_mileage`, `starts_at/ends_at` | 게이미피케이션 챌린지 |
| 15 | **challenge_participants** | `id`, `challenge_id`(FK), `customer_id`(FK), `progress`, `completed_at`, `reward_claimed` | 챌린지 참여 로그 |
| 16 | **customer_badges** | `id`, `customer_id`(FK), `badge_type`, `badge_data`(JSONB), `earned_at` | 고객 뱃지/칭호 |
| 17 | **customer_checkins** | `id`, `customer_id`(FK), `streak`, `last_checkin`, `total_checkins` | 출석 체크인 |

### 제휴 / 인플루언서

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 18 | **affiliates** | ... | 제휴 파트너 |
| 19 | **affiliate_applications** | ... | 파트너 신청 |
| 20 | **influencer_links** | ... | 추천 링크 성과 |
| 21 | **settlements** | ... | 월간 정산 |

### 재무 / 결제

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 17 | **bank_transactions** | `id`, `slack_event_id`(UNIQUE, 멱등성), `raw_message`, `transaction_type`(입금/출금), `amount`, `counterparty_name`, `booking_id`(FK), `match_status`(auto/review/unmatched/manual), `match_confidence` | 은행 거래 원장(불변) |
| 18 | **sms_payments** | `id`, `raw_sms`, `sender_name`, `amount`, `booking_id`(FK), `match_confidence`, `status` | SMS 입금 파싱 |
| 19 | **capital_entries** | 코드 참조 | 자본/경비 항목 |
| 20 | **price_history** | `id`, `package_id`(FK), `price`, `cost_price`, `seats_total/booked`, `occupancy_rate`(GEN), `change_reason` | 가격 변동 이력 |
| 21 | **margin_settings** | `id`, `package_id`(FK), `base_price`, `vip/regular/bulk_margin_percent` | 패키지별 마진율 |

### 광고 / 퍼포먼스 (10개)

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 22 | **ad_accounts** | `id`, `platform`(naver/google/meta), `account_name`, `current_balance`, `daily_budget`, `is_active` | 광고 계정 |
| 23 | **ad_campaigns** | `id`, `package_id`(FK), `meta/naver/google_campaign_id`, `channel`, `status`(DRAFT/ACTIVE/PAUSED/ARCHIVED), `daily_budget_krw`, `total_spend_krw` | 광고 캠페인 |
| 24 | **ad_creatives** | `id`, `product_id`(FK), `campaign_id`(FK), `creative_type`(carousel/single_image/text_ad/short_video), `channel`, `hook_type`, `tone`, `slides`(JSONB), `status` | 광고 소재 |
| 25 | **ad_performance_snapshots** | `id`, `campaign_id`(FK), `snapshot_date`, `impressions`, `clicks`, `spend_krw`, `attributed_bookings`, `net_roas_pct`, `raw_meta_json`(JSONB) | 캠페인 일일 성과 |
| 26 | **ad_traffic_logs** | `id`, `session_id`, `user_id`(FK), `source`, `medium`, `campaign_name`, `keyword`, `gclid`, `fbclid`, `current_cpc` | 광고 유입 세션 |
| 27 | **ad_search_logs** | `id`, `session_id`, `user_id`(FK), `search_query`, `search_category`, `result_count` | 유입 후 검색 행동 |
| 28 | **ad_engagement_logs** | `id`, `session_id`, `user_id`(FK), `event_type`(page_view/product_view/cart_added/checkout_start), `product_id` | 유입 후 인게이지먼트 |
| 29 | **ad_conversion_logs** | `id`, `session_id`, `user_id`(FK), `final_booking_id`(FK), `final_sales_price`, `base_cost`, `allocated_ad_spend`, `net_profit`(GEN), `attributed_source` | 광고→예약 전환 |
| 30 | **keyword_performances** | `id`, `platform`, `keyword`, `ad_account_id`(FK), `total_spend/revenue/cost`, `net_profit`(GEN), `roas_pct`(GEN), `clicks`, `impressions`, `current_bid`, `status`, `is_longtail` | 키워드별 성과 |
| 31 | **creative_performance** | `id`, `creative_id`(FK), `channel`, `date`, `impressions`, `clicks`, `spend`, `cpc`, `ctr`, `roas`, UNIQUE(creative_id,channel,date) | 소재별 일일 성과 |
| 31a | **ad_os_keyword_clusters** | `id`, `product_id`, `platform`, `keyword_text`, `tier`, `intent`, `score`, `suggested_bid_krw`, `status` | Ad OS V19-V25 초세부 키워드 클러스터 |
| 31b | **ad_os_external_mutation_results** | `id`, `platform`, `mutation_type`, `mode`, `status`, `change_request_id`, `idempotency_key` | 외부 광고 계정 변경 요청/결과 감사 로그 |
| 31c | **ad_os_tenant_reports** | `id`, `tenant_id`, `period_start/end`, `report_type`, `metrics`, `next_actions`, `status` | 테넌트 광고 SaaS 리포트 스냅샷 |

### 콘텐츠 / 마케팅

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 32 | **card_news** | `id`, `package_id`(FK), `campaign_id`(FK), `title`, `status`(DRAFT/CONFIRMED/LAUNCHED/ARCHIVED), `slides`(JSONB), `meta_creative_id` | 카드뉴스 에디터 |
| 33 | **content_creatives** | `id`, `tenant_id`(FK), `product_id`(FK), `angle_type`, `target_audience`, `channel`, `image_ratio`, `slides`(JSONB), `blog_html`, `tracking_id`(UNIQUE), `status` | 멀티채널 콘텐츠 |
| 33a | **blog_information_sources / source_versions / evidence / claims / claim_evidence** | `source_type`, `source_url/internal_identifier`, `publisher`, `retrieved_at`, `valid_from/until`, `destination/country`, `claim_type`, `risk_level`, `reviewer/reviewed_at`, `validation_status` | 정보성 블로그 전용 source→evidence→claim 감사 체인(상품 evidence와 분리, 서버 전용, 운영 스키마 적용·2026-07-24 source 1/version 21/evidence 147/claim 48, active 공식 registry 12) |
| 33b | **blog_information_representatives** | `representative_key`, `destination_id`, `intent`, `audience`, `locale`, `canonical_creative_id`, `canonical_slug`, `status`, `reservation_owner` | 정보성 신규 URL 중복 방지·canonical 예약 레지스트리(서버 전용, 운영 스키마 적용, 기존 글 무변경) |
| 34 | **content_performance** | `id`, `creative_id`(FK), `date`, `impressions`, `clicks`, `conversions`, `spend`, `ctr`, `cpa`, `roas`, UNIQUE(creative_id,date) | 콘텐츠 일일 성과 |
| 35 | **content_insights** | `id`, `destination`, `angle_type`, `channel`, `avg_ctr`, `avg_conversions`, `confidence_score` | 콘텐츠 인사이트(자동집계) |
| 36 | **winning_patterns** | `id`, `destination_type`, `channel`, `target_segment`, `hook_type`, `creative_type`, `avg_ctr`, `avg_roas`, `best_headline`, `best_body` | AI 학습 — 우승 패턴 |
| 37 | **creative_edits** | `id`, `creative_id`(FK), `slide_index`, `field`, `before_value`, `after_value`, `edited_by` | 소재 수정 이력 |
| 38 | **marketing_logs** | `id`, `product_id`, `travel_package_id`(FK), `platform`(blog/instagram/cafe/threads), `url`, `va_id`(FK) | 마케팅 발행 이력 |

### 마스터 데이터

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 39 | **land_operators** | `id`, `name`(UNIQUE), `contact`, `regions`(TEXT[]), `memo` | 랜드사 |
| 40 | **departing_locations** | `id`, `name`(UNIQUE), `is_active` | 출발지(부산/인천/청주 등) |
| 41 | **attractions** | `id`, `name`(UNIQUE), `short_desc`, `country`, `region`, `category`, `emoji`, `mention_count`, `is_special`, `badge_type` | 관광지 DB |
| 42 | **app_settings** | `key`(PK), `value`(JSONB) | 시스템 설정(commission_rate, vacation_mode 등) |

### 단체 RFQ (5개)

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 43 | **group_rfqs** | `id`, `rfq_code`(UNIQUE), `customer_id`(FK), `destination`, `departure_date_from/to`, `budget_per_person`, `status`(draft→completed), `max_proposals`, `ai_interview_log`(JSONB) | 단체 견적 요청 |
| 44 | **rfq_bids** | `id`, `rfq_id`(FK), `tenant_id`(FK), `status`(locked/submitted/selected/rejected), `locked_at`, `submit_deadline`, UNIQUE(rfq_id,tenant_id) | 입찰 슬롯(선착순) |
| 45 | **rfq_proposals** | `id`, `rfq_id`(FK), `bid_id`(FK), `tenant_id`(FK), `proposal_title`, `total_cost/selling_price`, `checklist`(JSONB), `ai_review`(JSONB), `rank`, `status` | 제안서 |
| 46 | **rfq_messages** | `id`, `rfq_id`(FK), `proposal_id`(FK), `sender_type`(customer/tenant/ai/system), `raw_content`, `processed_content`, `pii_detected/blocked`, `is_visible_to_*` | PII 안전 RFQ 소통 |
| 47 | **secure_chats** | `id`, `booking_id`(FK), `rfq_id`(FK), `sender_type`, `sender_id`, `receiver_type`, `raw_message`, `masked_message`, `is_filtered`, `is_unmasked`, `unmasked_at` | PII 마스킹 채팅 |

### 컨시어지 / 마켓플레이스

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 48 | **tenants** | `id`, `name`, `contact_name/phone/email`, `commission_rate`(18%), `status`(active/inactive/suspended), `tier`(GOLD/SILVER/BRONZE), `reliability_score`(100) | SaaS 테넌트(랜드사) |
| 49 | **transactions** | `id`, `idempotency_key`(UNIQUE), `session_id`, `status`(PENDING→COMPLETED), `total_cost/price`, `net_margin`(GEN), `saga_log`(JSONB), `vouchers`(JSONB), `tenant_cost_breakdown`(JSONB) | Saga 트랜잭션 |
| 50 | **api_orders** | `id`, `transaction_id`(FK), `api_name`(agoda_mock/klook_mock/cruise_mock/tenant_product), `product_type`, `cost`, `price`, `quantity`, `status`, `tenant_id`(FK) | 개별 API 주문 |
| 51 | **carts** | `id`, `session_id`, `items`(JSONB) | 장바구니 |
| 52 | **inventory_blocks** | `id`, `tenant_id`(FK), `product_id`(FK), `date`, `total_seats`, `booked_seats`, `available_seats`(GEN), `price_override`, `status`(OPEN/CLOSED/SOLDOUT), UNIQUE(product_id,date) | 날짜별 좌석 재고 |
| 53 | **mock_api_configs** | `id`, `api_name`(UNIQUE), `mode`(success/fail/timeout), `delay_ms` | Mock API 설정 |
| 54 | **vouchers** | `id`, `booking_id`(FK), `rfq_id`(FK), `customer_id`(FK), `land_agency_id`(FK→tenants), `parsed_data`(JSONB), `upsell_data`(JSONB), `pdf_url`, `status`(draft/issued/sent/cancelled) | 바우처 |

### AI / Q&A / 채팅

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 55 | **conversations** | `id`, `customer_id`(FK), `affiliate_id`(FK→affiliates, nullable), `journey`(JSONB), `channel`(default 'web'), `source`, `messages`(JSONB) | 고객 대화 세션 — 제휴 유입 스코프·여정 스냅샷(`src/lib/affiliate-scope.ts`, `customer-journey.ts`) |
| 56 | **intents** | `id`, `conversation_id`(FK), `destination`, `travel_dates`(DATERANGE), `party_size`, `budget_range`(INT4RANGE), `priorities`(TEXT[]), `booking_stage` | 대화에서 추출한 여행 의도 |
| 57 | **qa_inquiries** | `id`, `question`, `inquiry_type`(product_recommendation/price_comparison/general_consultation), `related_packages`(UUID[]), `customer_name/email/phone`, `status`(pending/answered/closed) | Q&A 문의 |
| 58 | **ai_responses** | `id`, `inquiry_id`(FK→qa_inquiries), `response_text`, `ai_model`(openai/claude/gemini), `confidence`, `used_packages`(UUID[]), `approved` | AI 응답 |
| 59 | **platform_learning_events** | `source`(qa_chat/jarvis_v1/jarvis_v2_stream 등), `session_id`, `tenant_id`, `affiliate_id`, `message_sha256`, `message_redacted`, `payload`, `consent_flags` | 플랫폼 AI 평가·라우팅 분석용 이벤트(원문 비저장 기본). 마이그레이션: `20260502160000_*`, `20260502170000_*` |

### 시스템 / 감사

| # | 테이블 | 주요 컬럼 | 설명 |
|---|--------|-----------|------|
| 60 | **os_policies** | `id`, `category`(9종), `name`, `trigger_type`(condition/schedule/event/cron/always), `trigger_config`(JSONB), `action_type`, `action_config`(JSONB), `target_scope`(JSONB), `is_active`, `priority` | 비즈니스 정책 엔진 |
| 61 | **audit_logs** | `id`, `user_id`, `action`, `target_type/id`, `before_value/after_value`(JSONB) | 감사 로그 |
| 62 | **pin_attempts** | `id`, `identifier`(referral_code_ip), `attempted_at` | PIN 브루트포스 방어 |

### 기타 테이블

| 테이블 | 설명 |
|--------|------|
| **user_profiles** | `id`(FK→auth.users), `role`(admin/va), `name` — 사용자 프로필·역할 |
| **archive_docs** | `id`, `file_hash`(SHA-256), `raw_content`, `metadata`(JSONB) — PDF 문서 아카이브 |
| **shared_itineraries** | `id`, `share_code`(8자), `share_type`(DYNAMIC/FIXED), `items`(JSONB) — 공유 일정표 |
| **partners** | `id`, `name`, `category`, `api_endpoint`, `api_key` — 전략 파트너 |
| **leads** | 리드 트래킹 |
| **user_actions** | `session_id`, `customer_id`(FK), `action_type`, `context`(JSONB) — 행동 로그 |
| **unmatched_activities** | 미매칭 활동 |
| **product_prices** | 상품 가격 |
| **recommendation_logs** | AI 추천 로그 |
| **ai_training_logs** | AI 학습 로그 |
| **document_hashes** | 문서 중복 방지 |

---

## 3. 채팅 / Conversations 관련 테이블 상세 스키마

### 3-1. conversations (고객 대화 세션)

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  affiliate_id UUID REFERENCES affiliates(id) ON DELETE SET NULL,  -- 마이그레이션 20260502120500
  journey JSONB DEFAULT '{}'::jsonb,  -- 마이그레이션 20260502140000 — stage·checklist_preview 등
  channel TEXT DEFAULT 'web',
  source TEXT,
  messages JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_conversations_customer ON conversations(customer_id);
CREATE INDEX idx_conversations_created ON conversations(created_at);
CREATE INDEX idx_conversations_affiliate_id ON conversations(affiliate_id);
```

**사용처:**
- `POST /api/qa/chat` — 대화 저장·메시지 히스토리 누적, 제휴 스코프·여정 갱신, `recordPlatformLearningEvent`
- `POST /api/bookings` — 예약 생성 시 session → customer_id 연결
- 공개 위젯 `ChatWidget` — `affiliateRef`(리퍼러) 전달; 에스컬레이션 시 `tel:`(`NEXT_PUBLIC_CONSULT_PHONE`)·`openKakaoChannel`, `POST /api/qa/escalation-cta`로 플라이휠·`qa_inquiries` 적재

### 3-2. intents (대화에서 추출한 여행 의도)

```sql
CREATE TABLE IF NOT EXISTS intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id),
  destination TEXT,
  travel_dates DATERANGE,
  party_size INTEGER,
  budget_range INT4RANGE,
  priorities TEXT[],
  booking_stage TEXT,
  extracted_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_intents_conversation ON intents(conversation_id);
CREATE INDEX idx_intents_destination ON intents(destination);
```

**사용처:** `/api/qa/chat` — AI가 대화에서 여행 의도(목적지·일정·인원·예산·우선순위) 자동 추출

### 3-3. secure_chats (PII 마스킹 보안 채팅)

```sql
CREATE TABLE IF NOT EXISTS secure_chats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID REFERENCES bookings(id) ON DELETE CASCADE,
  rfq_id          UUID REFERENCES group_rfqs(id) ON DELETE CASCADE,
  sender_type     TEXT NOT NULL CHECK (sender_type IN ('customer','land_agency','system')),
  sender_id       TEXT NOT NULL,
  receiver_type   TEXT NOT NULL CHECK (receiver_type IN ('customer','land_agency','admin')),
  raw_message     TEXT NOT NULL,         -- 원본 (서버 전용)
  masked_message  TEXT NOT NULL,         -- PII 마스킹 버전
  is_filtered     BOOLEAN DEFAULT FALSE,
  filter_detail   TEXT,
  is_unmasked     BOOLEAN DEFAULT FALSE, -- 결제 완료 후 해제
  unmasked_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_secure_chat_booking ON secure_chats(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX idx_secure_chat_rfq ON secure_chats(rfq_id) WHERE rfq_id IS NOT NULL;
CREATE INDEX idx_secure_chat_sender ON secure_chats(sender_id);
```

**TypeScript 함수:**
- `createSecureChat()` — 메시지 삽입
- `getSecureChats()` — booking_id/rfq_id/receiver_type 기준 조회
- `unmaskChatsForBooking()` — 결제 완료 시 일괄 마스크 해제

### 3-4. message_logs (예약별 커뮤니케이션 타임라인)

```sql
CREATE TABLE IF NOT EXISTS message_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  log_type   TEXT NOT NULL CHECK (log_type IN ('system','kakao','mock','scheduler','manual')),
  event_type TEXT NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT,
  is_mock    BOOLEAN DEFAULT false,
  created_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_message_logs_booking ON message_logs(booking_id, created_at DESC);
CREATE INDEX idx_message_logs_event_type ON message_logs(event_type);
```

**event_type 목록:**
| event_type | 설명 | 트리거 |
|------------|------|--------|
| `DEPOSIT_NOTICE` | 예약금 안내 발송 | 예약 생성 시 |
| `DEPOSIT_CONFIRMED` | 예약금 입금 확인 | 입금 매칭 시 |
| `BALANCE_NOTICE` | 잔금 안내 | D-15 자동 또는 수동 |
| `BALANCE_CONFIRMED` | 잔금 입금 확인 | 입금 매칭 시 |
| `CONFIRMATION_GUIDE` | 출발 확인 안내 | D-3 자동 |
| `HAPPY_CALL` | 귀국 후 만족도 | D+1 자동 |
| `CANCELLATION` | 예약 취소 | 취소 처리 시 |
| `MANUAL_MEMO` | 관리자 수동 메모 | 수동 |

### 3-5. qa_inquiries + ai_responses (Q&A 문의·AI 응답)

```sql
CREATE TABLE qa_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  inquiry_type VARCHAR(50),  -- product_recommendation, price_comparison, general_consultation
  related_packages UUID[] DEFAULT '{}',
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  customer_phone VARCHAR(20),
  status VARCHAR(50) DEFAULT 'pending',  -- pending, answered, closed
  created_at TIMESTAMP DEFAULT NOW(),
  answered_at TIMESTAMP,
  answered_by UUID
);

CREATE TABLE ai_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id UUID REFERENCES qa_inquiries(id) ON DELETE CASCADE,
  response_text TEXT NOT NULL,
  ai_model VARCHAR(50),  -- openai, claude, gemini
  confidence FLOAT DEFAULT 0,
  used_packages UUID[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  admin_feedback TEXT,
  approved BOOLEAN DEFAULT FALSE
);
```

### 3-6. platform_learning_events (플랫폼 AI 플라이휠)

비식별 신호만 적재. 운영 조회: `GET /api/admin/platform-learning`, 어드민 `/admin/platform-learning`.

```sql
-- 요약 — 전체는 supabase/migrations/20260502160000_platform_learning_events.sql 등 참고
CREATE TABLE platform_learning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL,
  session_id UUID,
  affiliate_id UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  message_sha256 CHAR(64),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  tenant_id UUID,
  message_redacted TEXT,
  consent_flags JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

### 3-7. rfq_messages (RFQ AI 중개 메시지)

```sql
CREATE TABLE IF NOT EXISTS rfq_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES group_rfqs(id) ON DELETE CASCADE,
  proposal_id UUID REFERENCES rfq_proposals(id),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer','tenant','ai','system')),
  sender_id TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  processed_content TEXT,
  pii_detected BOOLEAN DEFAULT FALSE,
  pii_blocked BOOLEAN DEFAULT FALSE,
  recipient_type TEXT CHECK (recipient_type IN ('customer','tenant','admin')),
  is_visible_to_customer BOOLEAN DEFAULT TRUE,
  is_visible_to_tenant BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 4. 기술 스택 요약

| 영역 | 기술 |
|------|------|
| **프레임워크** | Next.js 14.2.20 (App Router) |
| **언어** | TypeScript |
| **DB** | Supabase (PostgreSQL) + RLS |
| **인증** | JWT 로컬 검증 (middleware.ts) |
| **AI** | OpenAI (gpt-4o) / Anthropic (claude-3-5-sonnet) / Google Gemini 2.5 Flash |
| **알림** | Solapi (카카오 알림톡) + MockAdapter 이중화 |
| **파일 파싱** | PDF/HWP/JPG 텍스트 추출 |
| **광고** | Meta Marketing API / Naver / Google Ads 연동 |
| **배포** | Vercel |
| **게이미피케이션** | 마일스톤 뱃지 출석체크 스트릭 도전과제 (src/lib/gamification-service.ts) |
| **Cursor Rules** | .cursor/rules/ 8개 .mdc (alwaysApply 1만 path-scoped 4 agent-requested 1 신규 3) |
| **결제** | 신한은행 SMS 파싱 + Slack 웹훅 자동매칭 |

---

## 5. 핵심 아키텍처 패턴

> **상품등록 엔진 V4 재설계 진행 (2026-08-07):** 비공개 원문 보관(`product_source_documents`), 구조 보존 HWP/HWPX DocumentIR(`rhwp 0.8.2`), 재시도 가능한 `upload_jobs` V4 stage/lease, 카드·랜딩 고객 핵심값 동등성 publish gate, V4 추출 cron과 canonical segmentation/normalization worker를 구현했다. 샘플 HWP 40개 전수 추출은 40/40 성공(129페이지·229표)이다. canonical snapshot은 `product_registration_v4_normalizations`에 append-only로 저장되며, OCR은 `PRODUCT_REGISTRATION_V4_OCR_ENABLED=1` 명시 시에만 동작한다. V4 lineage 상품은 canonical normalization pointer와 source/job/extraction 일치 검증을 통과해야 관리자 승인 및 고객 publish가 가능하다. 세부 실행계획은 `docs/product-registration-engine-v4-plan.md`를 따른다.

> **상품등록 엔진 V5 기반 추가 (2026-08-08):** 기존 고객 표면을 건드리지 않는 shadow 단계로 `product_registration_v5_revisions` 불변 canonical revision, claim/evidence 그래프, typed 가격·일정 projection, 모바일 proof run, CAS 전환용 publication pointer, transactional outbox, stage idempotency ledger를 추가했다. `PRODUCT_REGISTRATION_V5_SHADOW=1`일 때 V4 canonical normalization 결과가 V3 draft와 critical field diff를 거쳐 상품별 V5 revision 후보와 typed projection으로 저장되며, 공개 성공한 compatibility snapshot은 package-scoped V5 revision과 best-effort lineage link를 가진다. 실제 `/packages`·`/lp` proof도 이 연결이 있을 때 `proof_runs`로 기록된다. `/api/cron/product-registration-v5-outbox`는 pointer commit 이벤트를 lease로 처리하고 고객 표면 재검증 대기열을 만든다. `/api/cron/product-registration-v5-convergence`는 각 표면의 snapshot hash 표식/헤더를 cache-busting 요청으로 관찰해 `converged`·`stale`·`failed`를 기록하며, 표식이 없거나 불일치하면 통과시키지 않는다. `GET /api/admin/product-registration/v5/audit`는 이 수렴·outbox·pointer·revision 상태와 blocker를 읽기 전용으로 집계한다. 아직 V3 compatibility writer를 대체하지 않는다. 다음 게이트는 운영 DB end-to-end 표본과 동일 snapshot hash 기반 실제 모바일 proof이다. CAS 함수 `publish_product_registration_v5_snapshot_atomic`는 임의 고객 필드 patch 없이 revision·snapshot·proof·pointer version을 함께 검증하며, DB trigger도 검증·승인된 revision만 current pointer가 되도록 fail-closed로 제한한다.
> **상품등록 엔진 V5 운영 감사 보강 (2026-08-09):** `GET /api/admin/product-registration/v5/audit`가 package별 또는 전체 표본의 convergence/outbox/publication pointer/revision 상태를 읽기 전용으로 집계한다. pending·stale·failed surface, dead-letter outbox, 비공개 pointer, 검토 필요 revision, V5 표본 없음은 명시적인 blocker로 반환하며 원문 blob과 raw 문서 텍스트는 반환하지 않는다.
> **상품등록 엔진 V5 원격 DB 반영 확인 (2026-08-09):** 운영 Supabase에 V5 foundation·CAS publication·typed projection·fail-closed guard·FK index migration을 적용했다. 원격 읽기 전용 점검에서 V5 테이블 14/14와 RLS 14/14, publication RPC, proof snapshot FK index를 확인했다. V5 데이터 행은 아직 0건이며 shadow/실제 업로드→모바일 proof 표본 승인 전까지 기존 V4/V3 공개 경로를 유지한다.
> **상품등록 엔진 V5 정확도·공개 게이트 보강 (2026-08-10):** canonical worker가 active attraction SSOT를 같은 snapshot으로 주입하고 hash를 revision lineage에 포함한다(빈 배열 fallback·자동 시드 금지). V3 가격 파서는 `1,299,000` 선두 숫자 절삭을 수정했으며, 일정 본문의 고도·외화 옵션·현지비용을 기본 판매가로 승격하지 않도록 구조화 price IR 우선·보수적 fallback을 적용했다. V5 normalization은 모든 section이 `ready_to_publish`이고 completeness가 `confirmed/not_applicable`일 때만 `complete`가 된다. 날짜·기간·요일 typed price scope와 `pending_supplier` 상태를 보존한다. C12는 만료 자료도 원문↔DB 가격을 비교하고 C14가 freshness를 별도 차단한다. 관리자 업로드 목록에도 V5 completeness를 표시한다. 수정 후 HWP 40/40 추출·정규화, render contract 66/66, 전체 Vitest 665 files/5,068 tests, 전체 TypeScript·ESLint 통과. 현재는 오프라인 shadow 기준 후보 4/66이며 운영 DB·실제 모바일 proof 전 고객 공개는 계속 차단한다.
> **상품등록 엔진 V5 운영 shadow 실증 (2026-08-10):** 운영 Supabase에서 실제 HWP 1건을 원문 보관→추출(2페이지·280노드·5표)→canonical normalization(6/6 critical/high completeness)→V5 candidate revision→비공개 blocked snapshot으로 통과시켰다. 동일 snapshot hash로 390×844 모바일 `/packages/{id}`·`/lp/{id}` proof 2건이 `passed`로 저장됐고, 해당 상품은 `pending/draft/blocked`, publication outbox 0, CAS publication 미호출 상태를 유지한다. 현재 원본 job이 compatibility package 생성보다 먼저 V5 revision을 만들어 `package_id/canonical_revision_id`가 비어 있는 순서 경합이 확인되었으므로, package-bound revision과 V3/V5 critical diff 운영 표본 검증을 고객 공개 전 P0로 남긴다.
> **상품등록 엔진 V5 고객 공개 완료 (2026-08-10, 최신):** 위 shadow 상태를 package-bound immutable revision으로 승격했다. 샘플 상품 `41441e88-097e-4362-89c7-92be9653ce02`는 V4 source/job/extraction/normalization lineage가 일치하고, V5 revision `93ed6234-bc8f-41f4-b7ce-e8a54bd8caaa`가 `approved`, public snapshot `5db423b8-e52a-49c9-bc10-0d315d202972`가 `published`, CAS pointer version 6이 현재 원천이다. 스냅샷 hash `326a04557f4285502aebe234ab8c293871dce9ee5e8549eb0c204b7cb6f6fee0`에 대해 `/packages`, `/lp`, OG, affiliate 수렴이 4/4이고 pending/failed/dead-letter outbox는 0건이다. 실제 헤더 없는 390×844 모바일 브라우저에서 `/packages/{id}`와 `/lp/{id}`가 각각 HTTP 200, 동일 hash marker, 고객 CTA, 비-404 상태로 확인됐다. 운영 감사는 superseded immutable snapshot의 과거 `stale` 이력을 보존하되 현재 pointer의 snapshot만 건강성 판정에 사용한다. 이 샘플은 현재 고객 공개 가능한 상태이며, 신규 상품은 동일 V5 gate를 통과해야 한다.
