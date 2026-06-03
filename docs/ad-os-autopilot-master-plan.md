# Ad OS Autopilot Master Plan

_Updated: 2026-05-31_

## 1. 목표

여소남 Ad OS는 단순 광고 대시보드가 아니라 **여행 상품 feed를 예약/마진을 만드는 광고 퍼널로 자동 변환하는 멀티테넌트 광고 운영 시스템**이다.

최종 목표는 다음이다.

1. 상품 등록 시 AI가 검색 의도, 초세부 키워드, 블로그/상품 랜딩, 카드뉴스/광고문구 후보를 자동 생성한다.
2. 네이버/구글/Meta/Kakao를 채널 역할별로 나눠 예산 안에서 자동 테스트한다.
3. 광고 결과, 블로그 CTA, 상담/예약/마진을 학습해 다음 상품 광고 생성에 반영한다.
4. 테넌트별 예산과 자동화 레벨 안에서 광고 생성, 중지, 입찰, 제외 키워드, 랜딩 교체까지 자동화한다.
5. 나중에 여행사/랜드사에 유료로 제공 가능한 여행 전문 광고 SaaS가 된다.

## 2. 외부 벤치마크에서 가져온 원칙

| 기준 | 외부 패턴 | 여소남 적용 |
|---|---|---|
| Google AI Max / PMax | 키워드, 랜딩, 소재 신호를 AI가 확장 | AI가 상품/랜딩/소재/검색의도를 함께 생성 |
| Google Keyword Planner | seed keyword/URL 기반 후보와 히스토리컬 지표 | 초세부 키워드 후보 검증 |
| Google Search Terms | 실제 검색어 성과를 키워드/negative로 재활용 | search-term harvester |
| Meta Advantage+ | 넓은 타겟, 소재 다양성, 전환 이벤트 학습 | 카드뉴스/리타겟팅 소재 자동 생성 |
| Meta CAPI | 서버 이벤트와 dedupe | 상담/예약/마진 이벤트 서버 추적 |
| Search Ads 360 Templates | feed 기반 campaign/ad group/keyword preview | 상품 feed -> 광고 draft -> 승인/자동화 |
| Optmyzr | rule engine, 검색어 관리, 낭비 차단 | 자동화 레벨과 가드레일 |
| Marin / Skai | budget pacing, portfolio optimization | 채널별 월/일 예산 cap, 손실 상한 |

## 3. 20+ 항목 설계 체크

| # | 검증 축 | 100점 기준 | 현재 판정 |
|---:|---|---|---|
| 1 | 상품 feed 구조화 | 출발지/항공/발권기한/마진/재고까지 광고 엔진 입력 | 일부 있음 |
| 2 | 검색 의도 시나리오 | 부모님/부산출발/비교/불안해소/가격/시즌 등 의도 그래프 | 필요 |
| 3 | 초세부 키워드 | 템플릿 조합 + 자연어/질문형/문제형/구매직전형 | 일부 있음 |
| 4 | 키워드 검증 | 네이버/구글 검색량, 경쟁도, 예상 CPC | 일부 있음 |
| 5 | 키워드 중복 방지 | 목적지/상품/의도별 충돌 방지 | 필요 |
| 6 | 블로그 생성 게이트 | 기존 의도 페이지 업데이트 vs 새 글 생성 판단 | 필요 |
| 7 | SEO 품질 방어 | 중복률, canonical/noindex, thin content, 만료 CTA 제거 | 일부 있음 |
| 8 | 광고 랜딩 라우팅 | 구매직전은 상품, 비교/불안은 블로그, 재방문은 리타겟팅 | 필요 |
| 9 | 블로그 CTA 추적 | CTA 위치/문구/상품별 클릭률 | 필요 |
| 10 | 예약/마진 귀속 | utm/ad_mapping/content/scenario/cta/product/booking/margin 연결 | 일부 있음 |
| 11 | 검색어 수확 | 실제 search term -> 키워드 승격/negative 후보 | 일부 API 있음 |
| 12 | 자동화 상태 | candidate/approved/testing/active/winning/scaled/paused/negative | foundation 적용 |
| 13 | 예산 가드레일 | 채널별 월/일 예산, max CPC, max test loss | foundation 적용 |
| 14 | 자동화 레벨 | L0-L5 단계별 권한 | foundation 적용 |
| 15 | 외부 광고 API | 네이버/구글/Meta 실제 생성/수정/중지 | 일부 있음 |
| 16 | 발권기한 처리 | 만료 상품 광고/CTA 자동 중지/교체 | 필요 |
| 17 | 블로그 진화 | 버전/실험/성과 기반 업데이트 | 필요 |
| 18 | 카드뉴스 연계 | Meta/Kakao 리타겟팅 소재 자동 생성 | 일부 있음 |
| 19 | 테넌트 확장 | 테넌트별 예산/계정/학습 분리 | 필요 |
| 20 | 공통 학습 | 목적지/의도/CTA 승자 패턴 공통화 | 필요 |
| 21 | 설명가능성 | AI가 왜 생성/중지/증액했는지 로그 | foundation 적용 |
| 22 | 롤백 | 자동 변경 취소/이전 상태 복원 | 필요 |
| 23 | 보안/RLS | 서비스 키 서버 전용, 테넌트 RLS | 부분 위험 있음 |
| 24 | 쉬운 운영 UX | 예산 넣고 “추천/승인/자동 테스트”까지 한 화면 | 1차 화면 시작 |
| 25 | 오늘 집행 가능성 | 키가 있는 채널은 테스트, 없는 채널은 리포트 | 점검 필요 |

## 4. 자동화 레벨

| 레벨 | 이름 | 권한 |
|---:|---|---|
| L0 | 분석만 | AI 추천만. DB/외부 광고 변경 없음 |
| L1 | 후보 생성 | 키워드/랜딩/소재 후보 생성 |
| L2 | 승인형 집행 | 승인된 후보만 외부 광고 계정 배포 |
| L3 | 소액 자동 테스트 | 월/일 예산 cap 안에서 자동 테스트 시작 |
| L4 | 자동 최적화 | 입찰/중지/negative/랜딩 교체 자동 |
| L5 | 완전자율 | 목표 CPA/ROAS와 예산 안에서 생성-연장-삭제 자동 |

초기 운영 기본값은 L1-L2다. 외부 자동 집행은 예산 행이 있고 API 키가 있으며 상품/랜딩/추적이 통과한 경우에만 허용한다.

## 5. Ad OS 정보구조

| 화면 | 목적 |
|---|---|
| `/admin/ad-os` | 전체 광고 OS 관제, 준비도, 예산, 자동화 레벨, 후보/위험 |
| `/admin/ad-os/products` | 상품별 광고 퍼널, 발권기한, 교체 필요 CTA |
| `/admin/ad-os/scenarios` | 검색 의도/시나리오 그래프 |
| `/admin/ad-os/keywords` | 초세부 키워드 후보, 승인, 테스트, 승자/제외 |
| `/admin/ad-os/landings` | 블로그/상품 랜딩/CTA 성과 |
| `/admin/ad-os/creatives` | 카드뉴스, Meta/Kakao 소재 |
| `/admin/ad-os/budget` | 채널별 예산 cap, pacing, 손실 상한 |
| `/admin/ad-os/automation` | AI 추천/자동집행 로그/롤백 |
| `/admin/ad-os/learning` | 목적지/의도/CTA/테넌트별 학습 |

## 6. 1차 개발 범위

이미 시작한 foundation:

- `ad_landing_mappings.operational_status`
- `search_ad_keyword_plans.autopilot_status`
- `ad_os_channel_budgets`
- `ad_os_automation_runs`
- `ad_os_decision_logs`
- `/admin/ad-os`
- `/api/admin/ad-os/summary`

다음 P0:

1. 예산 설정 UI와 API.
2. 상품 등록 후 Scenario/Keyword plan 자동 생성 상태 연결.
3. 블로그 CTA 클릭 이벤트와 booking/margin attribution 연결.
4. 발권기한 만료 상품의 광고/CTA 자동 정리 dry-run.
5. 네이버/구글 키 보유 여부별 실제 API 테스트.
6. 외부 집행은 L2 승인형까지만 먼저 오픈.

## 7. 완료 기준

Ad OS V1 완료는 다음 증거로 판단한다.

1. 상품 하나를 선택해 키워드/랜딩/소재 후보가 생성된다.
2. 후보는 `candidate`로 저장되고, 활성/집행으로 오표시되지 않는다.
3. 네이버/구글 채널별 예산 cap이 설정된다.
4. API 키가 있는 채널은 승인형 dry-run 또는 실제 생성 테스트가 가능하다.
5. 블로그 CTA 클릭과 상품 클릭이 `content_creative_id`, `ad_mapping_id`, `product_id`로 추적된다.
6. 발권기한 만료 상품은 광고/CTA 교체 후보로 표시된다.
7. 모든 AI 판단은 `ad_os_decision_logs`에 이유와 기대효과를 남긴다.

## 8. 2026-05-31 구현 상태

이번 1차 구현으로 다음 항목은 실제 코드/DB에 반영했다.

- `/admin/ad-os` 1차 대시보드: 준비도, 매핑 후보, 키워드 후보, 집행 매핑, 발권기한, 월 예산, 외부 연동, 예산 가드레일, 결정 로그.
- `/api/admin/ad-os/summary`: Ad OS KPI와 상태 집계.
- `/api/admin/ad-os/budgets`: 네이버/구글/Meta/카카오 채널별 월예산, 일상한, Max CPC, 자동화 레벨, 사용/정지 저장.
- `/api/admin/ad-os/autopilot`: 실제 광고비를 쓰지 않는 dry-run 판단 로그 생성.
- `/api/admin/ad-os/generate-candidates`: 활성/승인 상품 중 키워드 플랜이 없는 상품을 찾아 네이버/구글 검색광고 후보를 일괄 생성.
- `/api/tracking`, `/api/blog-engagement`: 랜딩 방문, 블로그 CTA 클릭, 예약 전환을 `ad_landing_mapping_id`로 연결.
- `ad_os_channel_budgets`, `ad_os_automation_runs`, `ad_os_decision_logs`: 예산, 자동화 실행, AI 판단 근거 저장.
- `ad_landing_mappings.operational_status`: 자동 생성 매핑을 `active`가 아니라 `candidate`로 분리.
- `search_ad_keyword_plans.autopilot_status`: 키워드 후보/승인/테스트/집행 상태 분리.
- 검색광고 키워드 생성기: 출발공항, 항공사, 상품유형, display name을 반영해 롱테일 후보를 생성.
- `/admin/ad-os`에서 상품 후보 생성, 키워드 후보 승인/보류, 자동화 드라이런까지 한 화면에서 수행.
- Ad OS KPI에 랜딩 클릭, CTA 클릭, 예약 전환, 전환 매출 집계를 노출.

검증 결과:

- 타입체크와 ESLint 통과.
- 샘플 `부산출발 에어부산 다낭 3박4일 부모님 효도 패키지` 기준 키워드 68개, 롱테일 18개 생성.
- 네이버 검색광고 keywordstool 키는 설정되어 있고 `다낭`, `다낭패키지`, `여행` 조회가 성공.
- Ad OS dry-run은 실제 집행 없이 결정 로그 80건을 생성했고, 예산/승인 가드레일 때문에 테스트 집행 0건으로 보류했다.
- 활성 상품 2개 기준 키워드 후보 120개를 생성했고, 대시보드의 키워드 큐에서 후보 승인 API가 정상 작동했다.
- 테스트 세션으로 랜딩 클릭 -> CTA 클릭 -> 예약 전환이 동일 `ad_landing_mapping_id`에 귀속되는 것을 확인했다. 운영 지표 오염 방지를 위해 테스트 로그와 카운터는 검증 후 원복했다.

남은 P0:

1. 상품 등록 완료 시 블로그 랜딩 후보까지 자동 생성하는 이벤트 연결.
2. 예약 마진을 실제 `bookings` 원가/정산 데이터와 더 깊게 연결해 ROAS가 아니라 공헌이익 기준으로 최적화.
3. 만료 상품 광고/CTA 자동 정리 dry-run을 별도 작업으로 분리.
4. 네이버/구글 실제 캠페인 생성은 `guarded` 모드에서만 허용하고, 최초 운영은 사람이 승인한 L2까지만 오픈.
5. RLS 미적용 테이블 보안 정책 검토. 특히 attribution 계열 테이블은 테넌트 광고 SaaS 전환 전에 막아야 한다.

## 9. 2026-05-31 추가 구현 메모

- `/api/admin/ad-os/expiry-cleanup`: 발권기한이 지난 활성/승인 상품을 찾아 연결된 검색광고 키워드와 블로그 광고 매핑을 `expired` 후보로 올리는 드라이런 API를 추가했다.
- `/admin/ad-os`: 예산 가드레일 영역에 `만료 정리 점검` 버튼을 추가했다. 현재 기본 호출은 `dry_run`이라 외부 광고나 DB 상태를 실제 중지하지 않고 판단 로그와 요약만 남긴다.
- 검증 결과: 로컬 `http://localhost:3105`에서 드라이런 성공. 만료 상품 1개, 중지 대상 키워드 0개, 중지 대상 매핑 0개.
- 운영 원칙: 완전자동화 코드는 L5까지 갈 수 있는 형태로 깔되, 실제 운영은 L1-L2(후보 생성/승인형 집행)부터 시작한다. 예산이 켜져 있어도 `guarded/full` 모드 전환 전에는 자동 집행/중지/삭제가 직접 실행되지 않아야 한다.

## 10. 2026-05-31 100점 재점검 결과

현재 `/admin/ad-os`는 26개 항목, 총 104점 기준으로 readiness를 계산한다. 현재 실측 점수는 `67/104 (C)`다.

강점:

- 상품 등록 기반 키워드 후보와 블로그 광고 매핑 후보가 이미 생성된다.
- 초세부 longtail 후보, mid 후보, negative 후보가 분리된다.
- 예산 가드레일, 자동화 레벨, decision log, 만료 정리 dry-run이 들어갔다.
- 네이버/구글/Meta 키 존재 여부를 분리해 보고, 카카오 채널키를 카카오모먼트 광고 집행 가능으로 오판하지 않도록 보정했다.

부족한 부분:

- 실제 외부 캠페인 생성/중지/증액은 아직 guarded publisher가 완성되지 않았다.
- 블로그 CTA/예약/마진 귀속 데이터는 구조는 연결됐지만 실운영 데이터가 아직 부족하다.
- 비슷한 다낭 상품이 누적될 때 canonical owner, hub update, noindex/CTA 교체 규칙이 더 필요하다.
- 테넌트별 광고 SaaS 판매를 위해 tenant_id/RLS/광고 계정 분리 정책을 더 적용해야 한다.
- search term report 수확, negative 자동 제안, winner/loser feature store가 아직 없다.

이번 보강:

- `/api/admin/ad-os/autopilot`의 `guarded + apply=true`가 start_test 후보를 실제 `testing` 상태로 전환하도록 수정했다.
- 현재 예산 상태가 `paused`라 실제 전환은 0건이고, 200건이 가드레일로 보류되는 것을 확인했다. 즉 오늘 실수로 광고비가 쓰이지 않는다.
- `/admin/ad-os`에 `승인 후보 테스트 적용` 버튼을 추가했다. 예산이 active이고 승인 후보가 있으면 L2 테스트 상태 전환까지 한 화면에서 가능하다.

## 11. 2026-05-31 L2 guarded publisher 시작

- `search_ad_keyword_plans`에 내부 광고 드래프트 연결 필드 `ad_campaign_id`, `ad_creative_id`, `draft_published_at`을 추가했다.
- `/api/admin/ad-os/publish-drafts`: 승인된 검색광고 키워드를 내부 `ad_campaigns` 드래프트와 `ad_creatives` text ad 소재로 묶는 guarded publisher를 추가했다.
- `/admin/ad-os`: `캠페인 드래프트 생성` 버튼과 `캠페인 드래프트` KPI를 추가했다.
- 현재 검증 결과: 승인 키워드 1개가 감지되지만 Google 예산 상태가 `paused`라 드래프트 생성은 0건, 보류 1건이다. 이 상태에서는 광고비가 나가지 않는다.
- 운영 해제 조건: 채널 예산을 `active`로 바꾸고, 승인 키워드의 추천 CPC가 Max CPC 이하이며, 채널 연동이 준비된 경우에만 내부 draft 생성이 허용된다. 외부 플랫폼 실제 생성은 다음 단계의 platform publisher에서 별도 허용한다.

## 12. 2026-05-31 학습 루프 시작

- `ad_os_learning_events`: 광고/블로그/예약/마진 신호를 표준화해 저장하는 feature-event 테이블을 추가했다.
- `ad_os_search_term_candidates`: 실제 검색어를 `add_keyword`, `add_negative`, `review` 후보로 저장하는 큐를 추가했다.
- `/api/admin/ad-os/learning-harvest`: 최근 로그에서 랜딩 클릭, CTA 클릭, 예약/마진 전환, Google search terms를 수확해 다음 광고 생성 후보로 저장한다.
- `/admin/ad-os`: `성과 학습 수확` 버튼, `학습 신호` KPI, `성과 학습 큐` 섹션을 추가했다.
- 검증 결과: 최근 30일 블로그 engagement에서 학습 신호 23개를 생성·저장했다. 현재 외부 search term 후보는 0개다. 이는 아직 실제 외부 키워드 ID가 연결된 캠페인이 없기 때문이다.
- 다음 P0: 학습 신호를 다음 상품 키워드 생성 prompt와 블로그 업데이트 큐에 주입하고, search term 후보를 승인하면 `search_ad_keyword_plans` 또는 negative 후보로 자동 반영한다.

## 13. 2026-05-31 학습 신호 생성 주입

- `src/lib/ad-os-learning-context.ts`를 추가해 `ad_os_learning_events`, `ad_os_search_term_candidates`의 승자 키워드, 제외어, CTA lesson, landing lesson을 상품별 학습 컨텍스트로 요약한다.
- `buildSearchAdPackagePlan`이 후보 생성 전에 학습 컨텍스트를 읽고, 승자 검색어는 longtail exact 후보로, 제외 신호는 negative exact 후보로 주입한다.
- 생성된 `search_ad_keyword_plans.quality_flags`에 `learning_applied`, `learning_source`, `learning_summary`, `cta_lessons`, `landing_lessons`를 남겨 왜 이 키워드가 만들어졌는지 추적 가능하게 했다.
- 현재 저장된 23개 학습 신호는 대부분 블로그 체류/CTA 신호라서, 검색어 ID가 붙은 외부 캠페인이 생기기 전까지는 CTA/landing lesson 중심으로 다음 후보에 반영된다.
- 검증 결과: 후보 생성 API에서 새 상품 후보 58개가 저장됐고, 샘플 후보의 `quality_flags.learning_applied=true`와 학습 요약 주입을 확인했다.

## 14. 2026-05-31 운영자 런치패드 보강

- `/admin/ad-os` 첫 화면에 `오늘 광고 시작 런치패드`를 추가했다.
- 런치패드는 검색광고 API, 예산 캡, 초세부 키워드, 승인 후보, 캠페인 드래프트 5단계를 `OK/대기`로 보여주고 다음 액션을 한 줄로 제안한다.
- `100점 기준 Ad OS 설계 점검`은 미리보기 9개가 아니라 전체 27개 항목을 화면에 노출하도록 바꿨다.
- 검증 결과: 브라우저에서 런치패드 핵심 문구와 27개 감사 카드가 렌더링되는 것을 확인했다. 현재 readiness는 `71/108 (B)`이며, 키워드 후보 235개, 학습 신호 23개, 실제 캠페인 드래프트 0개 상태다.

## 15. 2026-05-31 성과 최적화 dry-run 루프

- `/api/admin/ad-os/optimize-performance`: 운영 중인 블로그 광고 매핑의 클릭, CTA, 예약, 전환가치를 보고 `pause`, `scale`, `no_change` 결정을 생성하는 성과 최적화 루프를 추가했다.
- 기본 대시보드 버튼은 `성과 최적화 드라이런`으로만 동작한다. 실제 정지/확장은 `guarded + apply=true`일 때만 DB 상태를 변경한다.
- 정지 기준: 클릭 표본은 있으나 CTA/예약 신호가 없거나 CTA율이 낮은 경우 예산 누수 후보로 기록한다.
- 확장 기준: 예약/전환가치가 있거나 CTA율이 충분히 좋은 경우 `winning` 후보로 기록한다.
- 검증 결과: 현재 실제 testing/active/winning/scaled 매핑이 없어 점검 대상 0개, 적용 0개로 완료됐다. 이는 안전한 상태이며 광고비가 나가지 않는다는 뜻이다.

## 16. 2026-05-31 외부 광고 계정 probe

- `/api/admin/ad-os/publisher-probe`: 네이버/구글 검색광고 외부 계정의 실호출 준비도를 확인하는 probe API를 추가했다.
- `/admin/ad-os`: `외부 계정 테스트` 버튼을 추가했다. 이 버튼은 광고를 생성하거나 비용을 쓰지 않고 계정 연결만 확인한다.
- 네이버 probe는 KeywordTool을 실제 호출한다. 현재 검증 결과 `ready`, 샘플 1200개 응답을 확인했다.
- 구글 probe는 Google Ads OAuth 토큰과 developer token으로 `generateKeywordHistoricalMetrics`를 실제 호출한다. 현재 검증 결과 `403 PERMISSION_DENIED`라서 키/토큰은 있으나 광고 계정 권한 또는 customer id/OAuth scope 점검이 필요하다.
- UI 문구는 “집행 가능” 대신 “키 있음”으로 낮춰 잡았다. 실제 집행 가능 여부는 외부 계정 테스트와 예산/승인/드래프트 단계를 모두 통과해야 한다.

## 17. 2026-05-31 네이버 정지 키워드 publisher 시작

- `createNaverPausedKeywords`: 네이버 검색광고 기존 광고그룹에 키워드를 `userLock=true` 정지 상태로 업로드하는 헬퍼를 추가했다.
- `/api/admin/ad-os/publish-naver-keywords`: 승인된 네이버 키워드 후보를 기존 네이버 광고그룹에 정지 키워드로 업로드할 수 있는지 점검한다.
- `/admin/ad-os`: `네이버 정지 키워드 점검` 버튼을 추가했다. 기본은 `dry_run`이라 실제 네이버 계정에 쓰지 않는다.
- 실제 업로드 조건은 모두 충족해야 한다.
  1. 네이버 API 키가 유효해야 한다.
  2. `NAVER_ADS_ADGROUP_ID` 또는 `NAVER_ADS_NCC_ADGROUP_ID`가 설정되어야 한다.
  3. 네이버 채널 예산이 `active`이고 월/일 예산이 있어야 한다.
  4. 승인된 네이버 키워드 후보가 있어야 한다.
  5. 추천 CPC가 Max CPC 이하여야 한다.
- 검증 결과: 네이버 API 키는 준비됐지만 `NAVER_ADS_ADGROUP_ID`가 없고 네이버 예산이 `paused`라서 현재 외부 업로드는 0건으로 안전하게 보류됐다.

## 18. 2026-05-31 네이버 광고그룹 조회 UX

- `fetchNaverAdgroups`: 네이버 검색광고 `/ncc/adgroups`를 호출해 기존 광고그룹 후보를 조회하는 헬퍼를 추가했다.
- `/api/admin/ad-os/naver-adgroups`: 현재 계정의 광고그룹을 조회하고, 첫 번째 광고그룹이 있으면 `NAVER_ADS_ADGROUP_ID` 추천값을 반환한다.
- `/admin/ad-os`: `네이버 광고그룹 조회` 버튼을 추가했다. 사용자가 광고그룹 ID를 외우지 않아도 계정에서 후보를 찾을 수 있게 하기 위한 UX다.
- 검증 결과: API 호출은 성공했지만 현재 조회 가능한 광고그룹이 0개였다. 따라서 네이버 광고센터에서 검색광고 광고그룹을 먼저 만들거나, 이미 쓰는 광고그룹 ID를 `NAVER_ADS_ADGROUP_ID`로 지정해야 한다.

## 19. 2026-05-31 외부 광고그룹 ID 대시보드 저장

- `ad_os_channel_budgets`에 `external_account_id`, `external_campaign_id`, `external_ad_group_id`, `external_config_note`를 추가했다.
- `/api/admin/ad-os/budgets`와 `/api/admin/ad-os/summary`가 위 필드를 저장/조회한다.
- `/admin/ad-os` 예산 테이블에 `외부 그룹 ID` 입력칸을 추가했다. 이제 네이버 광고그룹 ID를 env가 아니라 운영 화면에서 저장할 수 있다.
- `/api/admin/ad-os/publish-naver-keywords`는 `body.nccAdgroupId` → DB `external_ad_group_id` → env 순서로 네이버 광고그룹 ID를 찾는다.
- 검증 결과: 임시 `external_ad_group_id=ncc-adgroup-dryrun-test` 저장 후 summary에서 읽히는 것을 확인했고, 다시 빈 값으로 복구했다. 화면에서도 `외부 그룹 ID`, `네이버 광고그룹 조회`, `네이버 정지 키워드 점검`이 렌더링된다.

## 20. 2026-05-31 네이버 계정 자산 조회

- `fetchNaverCampaigns`, `fetchNaverBusinessChannels`: 네이버 검색광고 캠페인과 비즈채널 목록을 조회하는 헬퍼를 추가했다.
- `/api/admin/ad-os/naver-assets`: 캠페인, 광고그룹, 비즈채널을 함께 조회하고 다음 액션을 반환한다.
- `/admin/ad-os`: `네이버 계정 자산 조회` 버튼을 추가했다.
- 검증 결과: API 호출은 성공했지만 현재 네이버 계정에서 캠페인 0개, 광고그룹 0개, 비즈채널 0개가 조회됐다. 오늘 실제 네이버 업로드 전에는 네이버 광고센터에서 검색광고 캠페인과 사이트/비즈채널, 광고그룹을 먼저 만들거나 API 생성 단계를 추가해야 한다.

## 21. 2026-05-31 오늘 집행 감사

- `/api/admin/ad-os/launch-audit`: 네이버/구글 집행 준비도를 한 번에 감사하는 API를 추가했다.
- 점검 범위는 네이버 API, 네이버 계정 자산, 네이버 예산, 네이버 승인 키워드, Google 권한, Google 예산, Google 승인 키워드, 내부 캠페인 드래프트 8개 항목이다.
- `/admin/ad-os`: `오늘 집행 감사` 버튼을 추가했다.
- 검증 결과: 통과 2/8, 주의 2, 실패 4로 `today_launch_ready=false`가 반환됐다.
  - 통과: 네이버 API, Google 승인 키워드
  - 주의: Google 권한, 내부 드래프트
  - 실패: 네이버 자산, 네이버 예산, 네이버 승인 키워드, Google 예산
- 다음 액션은 네이버 광고센터에서 캠페인/비즈채널/광고그룹을 만들거나 외부 그룹 ID를 직접 저장하는 것으로 반환됐다.
- 추가 보강: 버튼 실행 후 결과를 토스트 메시지에만 두지 않고 `오늘 집행 감사 결과` 패널로 화면에 유지한다. 운영자는 통과/주의/실패와 항목별 다음 액션을 계속 볼 수 있다.

## 22. 2026-05-31 네이버 후보 안전 승인 게이트

- `/api/admin/ad-os/approve-naver-candidates`를 추가했다. `search_ad_keyword_plans`의 네이버 draft/candidate 후보 중 negative가 아니고 외부 키워드 ID가 없는 항목을 점검한다.
- 채널 예산의 `max_cpc_krw` 안에 들어오는 후보만 `plan_status=approved`, `autopilot_status=approved`로 올릴 수 있다. 실제 네이버 계정 업로드나 광고비 지출은 하지 않는다.
- 모든 판단은 `ad_os_automation_runs`, `ad_os_decision_logs`에 남긴다. 승인 가능 항목은 `approve`, CPC 초과나 한도 밖 항목은 `no_change`로 기록한다.
- `/admin/ad-os`에 `네이버 후보 승인` 버튼을 추가했다. 버튼은 guarded apply로 20개까지 안전 승인하며 메시지에 점검 수, 승인 가능 수, 실제 승인 수, 외부 광고비 0원을 표시한다.
- 검증 결과: dry-run에서 네이버 후보 58개 중 20개가 Max CPC 500원 이하 승인 가능으로 잡혔다. 실제 승인/외부 지출은 dry-run이라 0건/0원이었다.
- 화면 검증 결과: 로컬 `http://localhost:3105/admin/ad-os`에서 새 버튼이 렌더링되며, 현재 런치패드는 3/5 준비 상태로 표시된다.

## 23. 2026-05-31 L1 시범 세팅 원클릭화

- `/api/admin/ad-os/pilot-setup`을 추가했다. 기본값은 네이버/구글 각각 월 100,000원, 일 10,000원, Max CPC 500원, automation level 1이다.
- guarded apply에서 하는 일:
  1. 네이버/구글 검색광고 예산 캡을 L1 시범값으로 저장하고 `active`로 둔다.
  2. 네이버 후보 중 Max CPC 이하 후보를 승인한다.
  3. 승인 후보를 내부 `ad_campaigns` DRAFT와 `ad_creatives` review 소재로 묶는다.
  4. 외부 네이버/구글 계정에는 아무것도 만들지 않는다. 외부 광고비는 항상 0원이다.
- `/admin/ad-os`에 `1단계 시범 세팅` 버튼을 추가했다. 운영자가 순서를 외우지 않아도 L1 준비 과정을 한 번에 실행할 수 있게 한다.
- dry-run 검증 결과: 예산 변경 0개, 네이버 후보 58개 점검, 20개 승인 가능, 내부 드래프트 그룹 1개 점검, 외부 지출 0원.
- 운영 원칙: 완전자동화 구조는 L5까지 만들되, 실제 광고 집행은 L1 시범 세팅 → 내부 드래프트 검토 → 외부 광고그룹 ID/권한 통과 → 정지 키워드 업로드 → 수동 또는 guarded 활성화 순서로만 열린다.

### 23-1. 런치패드 마법사 UX 보강

- `/admin/ad-os` 상단 런치패드에 `오늘 시작 4단계`를 추가했다.
- 4단계는 `시범 예산 → 후보 승인 → 내부 드래프트 → 외부 계정`이다.
- 상단에서 바로 `1단계 시범 세팅`, `오늘 집행 감사`를 누를 수 있게 했다. 기존처럼 하단 버튼 목록을 훑지 않아도 첫 실행 순서를 알 수 있다.
- 안내 문구에 “외부 광고를 바로 켜지 않는다”를 명시했다. 내부 준비와 정지 키워드 업로드 전 점검까지만 안전하게 진행한다.
- `/api/admin/ad-os/launch-audit`의 네이버 자산 실패 메시지를 보강했다. 저장된 외부 그룹 ID가 있으면 정지 키워드 점검으로 안내하고, 없으면 네이버 광고센터에서 캠페인/비즈채널/광고그룹을 만들거나 이미 쓰는 `nccAdgroupId`를 외부 그룹 ID에 저장하라고 안내한다.
- 검증 결과: 로컬 `http://localhost:3105/admin/ad-os`에서 `오늘 시작 4단계`, `1단계 시범 세팅`, 안전 안내 문구가 렌더링된다.

### 23-2. 네이버 외부 광고그룹 ID 실검증

- `fetchNaverAdgroupById`를 추가했다. 저장된 `nccAdgroupId`가 있으면 `GET /ncc/adgroups/{id}`로 실제 네이버 계정 접근 가능 여부를 확인한다.
- `/api/admin/ad-os/naver-adgroups`는 목록 조회와 함께 저장/입력된 광고그룹 ID 검증 결과를 `verified_adgroup`으로 반환한다.
- `/api/admin/ad-os/launch-audit`는 이제 저장된 외부 그룹 ID만으로 pass 처리하지 않는다. 저장 ID가 있으면 그 ID가 네이버 API에서 확인되어야 pass다. 저장 ID가 틀리면 fail/warn으로 남기고 다시 저장하라고 안내한다.
- `/admin/ad-os`의 `네이버 광고그룹 조회` 버튼은 예산 테이블에 저장된 네이버 외부 그룹 ID를 함께 보내 검증한다.
- 검증 결과: 현재 네이버 API 키는 정상이나 광고그룹 목록은 0개다. 가짜 `grp-a001-00-000000000000000` ID 검증은 404/no permission으로 실패해, 잘못된 ID를 통과시키지 않는 것을 확인했다.

### 23-3. L1 시범 세팅 실제 적용

- `/api/admin/ad-os/pilot-setup`을 `guarded + apply=true`로 실행했다.
- 적용 결과:
  - 네이버/구글 검색광고 예산 캡 2개를 L1 시범값으로 저장했다. 월 100,000원, 일 10,000원, Max CPC 500원.
  - 네이버 후보 58개를 점검해 Max CPC 이하 20개를 승인했다.
  - 내부 캠페인 드래프트 4개와 소재 4개를 생성했고, 키워드 20개를 연결했다.
  - 외부 네이버/구글 계정에는 아무것도 생성하지 않았다. 외부 광고비는 0원이다.
- 재측정 결과:
  - 오늘 집행 감사는 `2/8`에서 `6/8`로 상승했다.
  - 통과: 네이버 API, 네이버 예산, 네이버 승인 키워드, Google 예산, Google 승인 키워드, 내부 드래프트.
  - 주의: Google Ads 권한. 키/OAuth는 있으나 PERMISSION_DENIED.
  - 실패: 네이버 외부 자산. 캠페인/비즈채널/광고그룹 0개, 저장 그룹 ID 없음.
  - Ad OS readiness는 `72/108 (B)`로 상승했다.
- 화면 검증 결과: `/admin/ad-os`의 `오늘 시작 4단계`에서 시범 예산/후보 승인/내부 드래프트가 완료로 표시되고, 외부 계정만 대기로 남는다.

### 23-4. 네이버 publisher 광고그룹 검증 가드

- `/api/admin/ad-os/publish-naver-keywords`에도 `fetchNaverAdgroupById` 검증을 연결했다.
- 이제 네이버 정지 키워드 업로드는 다음 조건을 모두 통과해야만 `eligible_keywords`가 생긴다.
  1. 네이버 API 키가 정상이어야 한다.
  2. 예산 캡이 active이고 월/일 예산이 있어야 한다.
  3. 승인된 네이버 키워드가 있어야 한다.
  4. 추천 CPC가 Max CPC 이하여야 한다.
  5. `nccAdgroupId`가 설정되어야 한다.
  6. 해당 `nccAdgroupId`가 네이버 API에서 실제 조회되어야 한다.
- 검증 결과:
  - ID 미설정 상태: 네이버 후보 20개가 있어도 `eligible_keywords=0`, `created_keywords=0`.
  - 가짜 ID `grp-a001-00-000000000000000`: `ncc_adgroup_id_configured=true`지만 `ncc_adgroup_id_verified=false`, 404/no permission으로 차단.
  - 외부 광고비는 계속 0원이다.
- 의미: 감사 화면뿐 아니라 실제 publisher도 잘못된 광고그룹 ID를 통과시키지 않는다. 오늘 실집행의 마지막 네이버 병목은 “검증 가능한 실제 nccAdgroupId 저장”으로 좁혀졌다.

## 24. 2026-05-31 외부 플랫폼 25개 항목 벤치마크 재점검

조사 기준: Google Performance Max/Search Ads 360, Optmyzr Rule Engine, Skai, Smartly, Madgicx, Marin, 네이버 검색광고 API의 공개 문서와 기능 설명을 기준으로 했다. 목표는 “여행 상품 등록 → 초세부 키워드/블로그 랜딩/광고/성과학습/예산통제/테넌트 광고대행”까지 한 시스템에서 처리하는 것이다.

| 항목 | 선도 플랫폼 기준 | 여소남 Ad OS 현재 | 점수 | 다음 개선 |
|---|---|---:|---:|---|
| 1. 상품 feed 기반 자동 캠페인 | Smartly/Skai는 feed 기반 대량 생성 강함 | 상품 기반 키워드 후보 생성 가능 | 4/5 | 상품 승인 이벤트에 L1 자동 후보 생성 연결 |
| 2. 초세부 longtail 키워드 | Optmyzr/Skai는 rule/harvest 강함 | 출발지/항공/상품유형/학습 신호 반영 | 4/5 | 검색어 수확 후 자동 확장/negative 반영 |
| 3. 검색량/입찰 추정 | Google/Naver keyword tools | 네이버 KeywordTool 실호출, Google 권한 이슈 | 3/5 | Google OAuth/customer 권한 복구 |
| 4. 예산 pacing | SA360/Marin 강함 | 월/일/Max CPC/테스트 손실 캡 있음 | 3/5 | 일 소진률 기반 자동 감액/이월 |
| 5. 자동 bid 조정 | Google/SA360/Marin 강함 | 상태/후보 중심, bid 변경 미완성 | 2/5 | CPA/마진 기반 bid increase/decrease 실행 |
| 6. 자동 생성/정지/확장 | Madgicx/Optmyzr rule 강함 | decision log와 guarded state machine 있음 | 3/5 | L3부터 실제 pause/scale publisher |
| 7. 안전 가드레일 | Optmyzr rule, Smartly governance | dry-run/guarded/full, decision log 있음 | 5/5 | anomaly kill switch 추가 |
| 8. 내부 드래프트 UX | Smartly workflow 강함 | 내부 campaign/creative draft 생성 가능 | 4/5 | 검토 큐/승인자/변경 이력 강화 |
| 9. 외부 publisher | 플랫폼별 API 직접 집행 | 네이버 정지 키워드 업로드 시작, Google 막힘 | 2/5 | 네이버 campaign/adgroup API 생성 또는 ID 저장 UX |
| 10. 블로그 랜딩 자동 매핑 | 일반 PPC툴은 약함 | 블로그 매핑/UTM/DKI 구조 있음 | 5/5 | 상품 등록 시 자동 매핑 확정 |
| 11. SEO 색인/노출 연동 | PPC툴은 보통 별도 | 색인 상태 요구 반영 중 | 2/5 | Google Search Console/Naver Search Advisor 연동 |
| 12. ROAS/CPA/CTA 측정 | 대부분 지원 | 클릭/CTA/예약 귀속 구조 있음 | 4/5 | 실운영 예약/마진 데이터와 더 강결합 |
| 13. 공헌이익 최적화 | 일반툴은 매출/ROAS 중심 | 여행 마진 기반 설계 가능 | 4/5 | 원가/정산 확정 기준 최적화 |
| 14. search term harvesting | Skai/Optmyzr 강함 | 테이블/큐 있음, 외부 데이터 없음 | 3/5 | 네이버/구글 리포트 수확 |
| 15. creative automation | Smartly/Madgicx 강함 | text ad draft 중심 | 2/5 | 카드뉴스/Meta/인스타 소재 자동 생성 |
| 16. multi-channel | Smartly/Skai 강함 | 네이버/구글 중심, Meta/Kakao 골격 | 3/5 | Meta/Kakao publisher 별도 구현 |
| 17. AI assistant UX | Optmyzr Sidekick/Madgicx 대화형 | 버튼 중심 | 2/5 | “사장님 오늘 뭐 누르면 됨?” 액션 콘솔 |
| 18. 원클릭 시작 | SaaS 선도툴 강함 | L1 시범 세팅 버튼 추가 | 4/5 | 마법사형 온보딩/체크리스트 |
| 19. 투명성/설명가능성 | Optmyzr rule summary 강함 | decision_logs 매우 강함 | 5/5 | 근거 diff UI |
| 20. 테넌트 광고대행 | agency tools 강함 | tenant_id 확장 계획, 아직 미완 | 2/5 | tenant budget/RLS/account 분리 |
| 21. 중복 상품/저품질 방지 | SEO/PPC 통합툴 드묾 | canonical/hub/noindex 계획 있음 | 3/5 | 상품 유사도 cluster와 글 진화 규칙 구현 |
| 22. 만료 상품 정리 | 여행 특화 차별점 | expiry cleanup dry-run 있음 | 4/5 | 발권기한 만료 시 CTA/광고 자동 교체 |
| 23. 실험/증분성 | Skai/Smartly 강함 | 아직 약함 | 1/5 | holdout/geo/date split 실험 설계 |
| 24. 보고서/감사 | Optmyzr/Smartly 강함 | readiness/launch audit 있음 | 4/5 | 테넌트별 리포트 PDF/월간 자동 발송 |
| 25. 판매 가능한 여행전문 OS | 일반툴은 범용 | 여행 상품/블로그/예약 결합이 차별점 | 4/5 | 외부 계정 온보딩 + 과금/권한/RLS 완성 |

현재 결론: 구조 방향은 맞다. 범용 광고툴보다 이길 수 있는 지점은 “여행 상품/발권기한/블로그 랜딩/예약마진/테넌트 대행”을 한 번에 묶는 vertical OS라는 점이다. 다만 오늘 기준 100점 이상이라고 말하려면 외부 publisher, Google 권한, 네이버 광고그룹 생성/저장, search term 수확, 테넌트 보안, creative automation이 더 필요하다.

우선순위:

1. P0 오늘 집행: 네이버 광고그룹 ID 저장 또는 API 생성, 네이버 예산 active, 네이버 후보 승인, 정지 키워드 업로드, 수동 활성화.
2. P0 쉬운 UX: `1단계 시범 세팅` → `오늘 집행 감사` → `네이버 정지 키워드 점검`의 3버튼 흐름을 마법사로 통합.
3. P1 학습: search term report 수확, CTA/예약/마진 기반 키워드 승자/패자 feature store.
4. P1 저품질 방지: 유사 상품 cluster, canonical 블로그 owner, 만료 상품 CTA 교체, 중복 글 noindex 규칙.
5. P1 테넌트 SaaS: tenant budget, 외부 광고계정 연결, RLS, 월별 광고대행 리포트.
6. P2 creative/social: 인스타 카드뉴스, Meta 소재, Smartly식 feed creative automation.

## 25. 2026-06-01 Ad OS kill switch

- `/api/admin/ad-os/kill-switch`를 추가했다.
- 목적은 L3-L5 완전자동화 구조를 만들더라도 실제 운영에서는 언제든 전체 지출 경로를 멈출 수 있게 하는 것이다.
- 현재 구현 범위는 내부 가드레일이다.
  - active 상태의 `ad_os_channel_budgets`를 정지 대상으로 계산한다.
  - `testing/active/winning/scaled` 상태의 `search_ad_keyword_plans`를 정지 대상으로 계산한다.
  - `testing/active/winning/scaled` 상태의 `ad_landing_mappings`를 정지 대상으로 계산한다.
  - 모든 판단은 `ad_os_automation_runs`, `ad_os_decision_logs`에 `pause` decision으로 남긴다.
- `/admin/ad-os`에 `전체 정지 점검` 버튼을 추가했다. 화면 버튼은 `dry_run`만 호출하므로 지금 눌러도 실제 예산/키워드/매핑은 변경하지 않는다.
- 검증 결과:
  - API dry-run 성공.
  - 현재 정지 대상은 예산 채널 2개, 키워드 20개, 랜딩 매핑 0개다.
  - 실제 변경은 0건이고 외부 광고비는 0원이다.
  - 브라우저에서 버튼 렌더링과 클릭 후 완료 메시지를 확인했다.
- 다음 보완:
  - 네이버/구글 publisher가 실제 외부 캠페인을 생성/수정하게 되면 kill switch가 외부 캠페인/광고그룹/키워드도 paused 처리해야 한다.
  - 테넌트 SaaS 전환 전에는 tenant 단위 kill switch, platform 단위 kill switch, 예산 초과 자동 kill switch를 분리해야 한다.

## 26. 2026-06-01 Naver asset sync

- `/api/admin/ad-os/sync-naver-assets`를 추가했다.
- 목적은 네이버 광고센터에 캠페인/비즈채널/광고그룹이 생긴 뒤 운영자가 ID를 복사해 붙여넣는 단계를 줄이는 것이다.
- 동작:
  - Naver SearchAd API 키가 있으면 캠페인, 광고그룹, 비즈채널을 조회한다.
  - 광고그룹이 있으면 첫 광고그룹의 `nccAdgroupId`를 `ad_os_channel_budgets.external_ad_group_id`에 저장한다.
  - 캠페인/비즈채널 ID도 가능한 범위에서 함께 저장한다.
  - 광고그룹이 없으면 저장하지 않고 다음 액션을 반환한다.
- `/admin/ad-os`에 `네이버 자산 자동저장` 버튼을 추가했다.
- 검증 결과:
  - API 호출 성공.
  - 현재 네이버 계정 조회 결과는 캠페인 0개, 광고그룹 0개, 비즈채널 0개다.
  - 따라서 `saved=false`가 정상이며, 다음 액션은 네이버 광고센터에서 검색광고 캠페인, 비즈채널, 광고그룹을 먼저 만드는 것이다.
  - 브라우저에서 버튼 렌더링과 클릭 후 대기 메시지를 확인했다.
- 운영 의미:
  - 지금 막힌 지점은 우리 내부 엔진이 아니라 네이버 외부 계정 자산 부재다.
  - 외부 자산이 생기면 이 버튼으로 즉시 Ad OS 예산/집행 설정에 연결하고, `오늘 집행 감사`와 `네이버 정지 키워드 점검`으로 이어갈 수 있다.

## 27. 2026-06-01 external launch readiness panel

- `/api/admin/ad-os/summary`에 `external_launch_status`를 추가했다.
- 목적은 운영자가 “왜 오늘 외부 광고를 못 켜는지”를 버튼 클릭 전에 볼 수 있게 하는 것이다.
- 네이버 체크:
  - API 키
  - 예산
  - 광고그룹 ID
  - 승인 키워드
  - 내부 드래프트
- 구글 체크:
  - API/OAuth
  - 권한 감사
  - 예산
  - 승인 키워드
  - 내부 드래프트
- 현재 상태:
  - 네이버 `4/5`: API, 예산, 승인 키워드, 내부 드래프트는 준비. 광고그룹 ID가 없음.
  - 구글 `4/5`: API/OAuth, 예산, 승인 키워드, 내부 드래프트는 준비. Google Ads `PERMISSION_DENIED` 해소 필요.
- `/admin/ad-os` 상단 런치패드 아래에 네이버/구글 외부 집행 준비 패널을 추가했다.
- 검증 결과:
  - summary API 응답에서 네이버/구글이 모두 `ready=false`로 반환된다.
  - 브라우저에서 `네이버 외부 집행 준비`, `구글 외부 집행 준비`, `PERMISSION_DENIED`, `광고그룹` 병목 문구가 표시되는 것을 확인했다.
- 운영 의미:
  - 지금부터는 “광고가 안 켜짐”이 아니라 “네이버는 광고그룹 ID, 구글은 권한”처럼 병목이 명확히 보인다.
  - 완전자동화로 갈수록 이 패널은 채널별 publish gate 역할을 한다.

## 28. 2026-06-01 launch action queue

- `/api/admin/ad-os/summary`에 `launch_action_queue`를 추가했다.
- 목적은 운영자가 준비도 카드를 해석하지 않아도 “오늘 무엇을 눌러야 하는지”를 순서대로 보게 하는 것이다.
- 현재 액션 큐는 아래 신호를 기준으로 생성된다.
  - 검색광고 예산 활성 여부
  - 승인/테스트 키워드 존재 여부
  - 내부 캠페인 드래프트 존재 여부
  - 네이버 외부 자산 준비도
  - 구글 권한 준비도
  - 학습 신호 존재 여부
- `/admin/ad-os` 상단 KPI 아래에 `오늘 할 일` 섹션을 추가했다.
- 각 카드에는 priority, label, 설명, 실행 버튼을 함께 보여준다.
- 현재 검증된 큐:
  1. 네이버 외부 자산 연결
  2. 구글 권한 감사
  3. 성과 학습 반영
  4. 오늘 집행 감사
  5. 전체 정지 점검
- 검증 결과:
  - summary API에서 `launch_action_queue`가 정상 반환된다.
  - 브라우저에서 `오늘 할 일`, `네이버 자산 자동저장`, `외부 계정 테스트`, `오늘 집행 감사`, `전체 정지 점검`이 표시되는 것을 확인했다.
- 운영 의미:
  - 이제 Ad OS는 상태판을 넘어 “다음 클릭을 제안하는 운영 콘솔”에 가까워졌다.
  - 전문 광고 대시보드처럼 분석과 실행이 분리되지 않고 한 화면에서 이어진다.

## 29. 2026-06-01 one-click top action

- `/admin/ad-os`의 `오늘 할 일` 섹션에 `1순위 실행` 버튼을 추가했다.
- `launch_action_queue[0]`의 `ui_action`을 그대로 실행한다.
- 각 액션 카드 버튼에도 해당 작업의 loading 상태를 연결했다.
- 현재 검증 결과:
  - `1순위 실행` 버튼이 렌더링된다.
  - 현재 1순위는 `네이버 외부 자산 연결`이다.
  - 버튼 클릭 시 `네이버 자산 자동저장`이 실행된다.
  - 현재 네이버 계정에 캠페인/광고그룹/비즈채널이 없어 `네이버 자산 자동저장 대기` 메시지가 정상 표시된다.
- 운영 의미:
  - 운영자는 액션 큐를 읽고 판단하지 않아도 상단의 `1순위 실행`만 눌러 다음 단계로 갈 수 있다.
  - 완전자동화 전 단계에서는 이 버튼이 “AI 추천 + 사람 승인/실행”의 가장 단순한 조작면이 된다.

## 30. 2026-06-01 Naver setup packet

- `/api/admin/ad-os/naver-setup-packet`를 추가했다.
- 목적은 네이버 광고센터에 아직 캠페인/비즈채널/광고그룹이 없을 때 운영자가 무엇을 만들어야 하는지 바로 복사 가능한 형태로 보여주는 것이다.
- 반환 항목:
  - 기존 네이버 자산 수: 캠페인, 광고그룹, 비즈채널, 저장된 광고그룹 ID
  - 필요한 외부 자산: SearchAd campaign, Business channel, Ad group
  - 추천 캠페인명
  - 추천 광고그룹명
  - 일예산, 월예산, Max CPC
  - 랜딩 URL/final URL
  - 승인/테스트 네이버 키워드 샘플과 CSV 문자열
- `/api/admin/ad-os/summary`의 `launch_action_queue`에서 네이버 외부 자산이 없을 때 `네이버 세팅 패킷`을 먼저 추천하도록 변경했다.
- `/admin/ad-os`에서 `세팅 패킷 생성` 버튼을 누르면 `네이버 세팅 패킷` 패널이 표시된다.
- 검증 결과:
  - API 호출 성공.
  - 현재 패킷은 캠페인 `YSN_나트랑_달랏_a4d42815`, 광고그룹 `YSN_나트랑_달랏_a4d42815_mid_phrase`, 키워드 20개를 반환한다.
  - 현재 네이버 외부 자산은 캠페인 0개, 광고그룹 0개, 비즈채널 0개다.
  - 브라우저에서 `세팅 패킷 생성` 클릭 후 캠페인명, 광고그룹명, 일예산/Max CPC, 키워드 샘플, 완료 메시지를 확인했다.
- 운영 의미:
  - 네이버 계정 자산 부재가 막힘일 때도 대시보드가 “광고센터에서 어떤 이름과 예산으로 만들지”까지 안내한다.
  - 외부 광고센터에서 자산 생성 후 `네이버 자산 자동저장`으로 다시 Ad OS에 연결하면 된다.

## 31. 2026-06-01 Naver keyword CSV copy

- 네이버 세팅 패킷 패널에 `네이버 키워드 CSV` 영역을 추가했다.
- CSV 컬럼은 `keyword, match_type, bid_krw, landing_url`이다.
- `CSV 복사` 버튼을 추가했다.
- 검증 결과:
  - `/api/admin/ad-os/naver-setup-packet` 응답의 `keyword_csv`가 헤더 포함 21줄로 내려온다.
  - 브라우저에서 `네이버 키워드 CSV` 패널, `CSV 복사` 버튼, CSV textarea를 확인했다.
  - `CSV 복사` 클릭 후 복사 완료 메시지를 확인했다.
- 운영 의미:
  - 네이버 광고센터에서 자산을 수동으로 만들어야 하는 현재 단계에서도 키워드/입찰가/랜딩 URL을 바로 옮길 수 있다.
  - 외부 publisher가 완성되기 전까지는 이 CSV가 안전한 수동 집행 브릿지 역할을 한다.
## 32. 2026-06-01 Naver keyword CSV download and mapping active fix

- `/admin/ad-os` 네이버 세팅 패킷 CSV 영역에 `CSV 다운로드` 버튼을 추가했다.
- 기존 `CSV 복사` 버튼은 유지하고, 네이버 광고센터 업로드용 파일을 바로 내려받을 수 있게 했다.
- `/api/blog/ad-mapping` 응답에서 `operational_status`가 있으면 `active` 플래그를 운영 상태 기준으로 정규화한다.
  - `active`, `winning`, `scaled`만 실제 집행 상태로 본다.
  - `candidate`, `approved`, `testing`, `paused`, `rejected`, `expired`는 화면/API에서 `active:false`로 본다.
- 기존 DB에 남아 있던 `candidate + active:true` 레거시 데이터를 보정하는 마이그레이션을 추가했다.
  - `supabase/migrations/20260601090000_ad_mapping_candidate_active_fix.sql`
- 운영 DB 보정 결과:
  - 보정 전 불일치 후보 매핑 500개
  - `active:false`로 정리된 매핑 500개
  - 보정 후 불일치 0개
- 검증 결과:
  - `/api/blog/ad-mapping` 첫 후보 샘플들이 `active:false`, `operational_status:candidate`로 반환됨을 확인했다.
  - Ad OS 관련 API 및 블로그 광고 매핑 API targeted ESLint 통과.

## 33. 2026-06-01 Ad OS tenant governance and search indexing signals

- Added a tenant governance table and admin policy endpoint for allowed platforms, monthly/daily caps, max CPC, test-loss cap, automation level, approval requirement, full-auto flag, and risk status.
- `/api/admin/ad-os/summary` now separates channel execution readiness from internal recommendation readiness: missing credentials, permission blocked, campaign/ad group missing, integration ready, and executable.
- `/admin/ad-os`, `/admin/marketing`, and `/admin/marketing/command-center` now show spend readiness and guardrails before an operator assumes a draft is live.
- Added a deterministic four-step automation model: recommendation, approval, limited-auto, full-auto.
- Added Google URL Inspection fields to `indexing_reports` so blog admin can distinguish request submitted, inspected but not indexed, indexed, and exposed in Search Console.
- Blog ranking dashboard now supports `gsc-page`, `naver_blog`, `naver_web`, and `all` source filters instead of mixing search engines.
- Topical authority now returns an authority score, weak destinations, and next actions for pillar/cluster coverage.
- Verification:
  - `npm.cmd exec vitest run src/lib/ad-os-governance.test.ts`
  - `npm.cmd run type-check`
  - `npm.cmd run lint`
  - `npm.cmd run audit:event-taxonomy`
  - `npm.cmd run build`

## 34. 2026-06-02 Ad OS V19-V25 enterprise slice

- Added `ad_os_keyword_clusters`, `ad_os_external_mutation_results`, and `ad_os_tenant_reports`.
- `/api/admin/ad-os/keyword-brain` mines product-fact, search-term, and waste-term based longtail clusters, then stores internal keyword clusters and search ad draft rows when `apply=true`. External spend remains 0 KRW.
- `/api/admin/ad-os/publisher/naver/create-assets` creates approval-gated change requests and mutation audit rows for Naver campaign, business channel, ad group, and paused keyword setup. It does not directly create live external spend.
- `/api/admin/ad-os/tenant-report` now includes keyword clusters and external mutation activity in the agency/SaaS report preview, and can persist a report draft.
- `/admin/ad-os` exposes `Keyword Brain` and `Naver asset request` actions, plus result panels showing generated longtails and pending external asset requests.
- Operating principle remains unchanged: recommendation and approval first, limited autopilot only inside tenant budget/risk guardrails, full autopilot off by default.

## 35. 2026-06-02 Ad OS V26-V30 attribution and mutation audit slice

- Added `/api/admin/ad-os/conversion-attribution` to roll clean `ad_os_conversion_events` into `ad_os_performance_facts` by date, platform, product, scenario, landing, creative, campaign, keyword, and search term.
- Conversion attribution keeps quarantined/test/admin/bot events out of learning, then reports clicks, CTA clicks, bookings, spend, revenue, margin, CPA, and margin ROAS.
- `/api/admin/ad-os/external-publish` now writes idempotent `ad_os_external_mutation_results` rows for approved change requests, including blocked/planned/requested status and external-spend=false evidence.
- `/api/admin/ad-os/summary` now exposes conversion event counts, quarantine counts, performance fact counts, fact-level CPA, and fact-level margin ROAS for the last 30 days.
- `/admin/ad-os` adds a `conversion attribution` action so operators can run booking-funnel sync, conversion attribution, then learning apply in order.
- External ad spend is still not directly executed by this slice. This is the measurement and audit bridge needed before limited autopilot can safely turn on platform-specific publishers.

## 36. 2026-06-02 Ad OS V31-V40 guarded execution and learning operators

- Added a V31-V40 rules module for conversion-export packets, Naver execution gates, bid optimization candidates, and experiment run decisions.
- Added `/api/admin/ad-os/conversion-export/google` and `/api/admin/ad-os/conversion-export/meta`.
  - Both routes prepare upload-ready packets from clean conversion events.
  - Both routes create approval-gated `upload_conversion_signal` change requests when `apply=true`.
  - Neither route performs external upload yet; `external_api_write` is explicitly false.
- Added `/api/admin/ad-os/publisher/naver/execute`.
  - Reads approved Naver change requests.
  - Checks credentials, permission readiness, campaign/ad group presence, budget readiness, and automation level.
  - Writes idempotent mutation audit rows to `ad_os_external_mutation_results`.
  - `paused_only` allows paused keyword preparation but blocks activation/bid mutations. `active_allowed` still requires limited-autopilot guardrails.
- Added `/api/admin/ad-os/bid-optimizer/apply`.
  - Turns performance facts into approval-gated pause, bid-scale, and landing/CTA improvement change requests.
  - Uses CPA, margin ROAS, CTA rate, spend, and bounce signals before proposing action.
- Added `/api/admin/ad-os/experiment-run`.
  - Moves approved experiments to running.
  - Completes running experiments when minimum sample is reached and writes result summaries.
- Added `/api/admin/ad-os/blog-evolution/apply`.
  - Converts approved blog content versions into explicit change requests by default.
  - Direct application is available only when `create_change_requests=false`, but the admin UI uses approval-gated mode.
- `/api/admin/ad-os/summary` now includes experiment and blog-version counts/samples.
- `/admin/ad-os` now exposes V31-V40 operator buttons for Naver execution gate, Google/Meta conversion export, bid optimization, experiment execution, and blog evolution approval.
- Change request PATCH now treats external-only requests (`publish_paused_keyword`, `activate_paused_keyword`, `sync_external_asset`, `upload_conversion_signal`) as audit/apply markers rather than trying to patch arbitrary platform payloads into internal tables.
- Operating principle remains: no unapproved external spend, full-autopilot off by default, every platform mutation must be represented by a change request and mutation audit row.

## 37. 2026-06-02 Ad OS V41-V60 enterprise control plane

- Added server-only V41-V60 tables for platform jobs, conversion upload jobs, data-quality snapshots, portfolio budget plans, creative asset variants, travel intent signals, and tenant billing profiles.
- Added `/api/admin/ad-os/platform-jobs/run`.
  - Promotes approved `ad_os_external_mutation_results` into idempotent platform jobs.
  - Requires `requested` mutation status, `change_request_id`, credentials, permission, campaign/ad group, budget, automation level, and kill-switch clearance.
  - Still records `external_api_write=false`; actual write executors remain downstream.
- Added `/api/admin/ad-os/conversion-upload/run` and `/api/admin/ad-os/data-quality`.
  - Converts Google/Meta export packets into upload jobs.
  - Blocks raw PII, denied consent, missing identifiers, quarantined events, and platform-specific invalid signals before any upload.
  - Reports clean/blocked conversion coverage and attribution/margin coverage for the health dashboard.
- Added `/api/admin/ad-os/optimizer/portfolio-plan` and `/api/admin/ad-os/optimizer/apply-approved`.
  - Builds margin-ROAS/CPA/deadline/inventory-aware portfolio actions.
  - Approved plans become change requests; they do not mutate external platforms directly.
- Added `/api/admin/ad-os/creative-factory/asset-group`.
  - Generates travel intent signals and draft creative asset variants for search ads, DKI, blog FAQ/CTA, Instagram carousel, and retargeting.
  - Repeated destination products increase duplicate-content risk so operators can update hubs/CTAs/card news instead of mass-producing near-duplicate blog posts.
- Added `/api/admin/ad-os/tenant-workspaces`.
  - Creates agency/SaaS workspace defaults with monthly/daily/channel caps, max CPC, test-loss cap, automation level, approval requirement, full-auto disabled, and billing profile.
- `/api/admin/ad-os/summary` and `/admin/ad-os` now expose the V41-V60 enterprise layer:
  - platform job queue
  - conversion upload quality
  - portfolio optimizer
  - creative factory
  - travel intent duplicate risk
  - tenant workspace/billing status
- Change request PATCH can now apply/rollback V41-V60 internal plans/assets/workspaces after approval.
- Industry alignment:
  - Google AI Max/PMax style automation is mirrored as automation plus controls, not blind external writes.
  - Google offline conversion and Meta CAPI quality checks are modeled as uploadable jobs with blocked reasons.
  - Smartly-style creative scale is represented as draft creative variants with lifecycle/fatigue fields.
  - Sojern/Skai-style travel optimization is represented through booked margin, deadlines, inventory, and tenant-level budget control.
- Operating principle remains unchanged: recommendation and approval first; limited autopilot only inside tenant budgets and platform gates; full autopilot implemented as a disabled capability until data volume and explicit operating approval exist.

## 38. 2026-06-02 Ad OS V61-V75 runtime verification layer

- Added server-only V61-V75 tables for runtime readiness checks, guarded execution attempts, experiment templates, and tenant audit exports.
- Extended tenant workspaces with approver/operator IDs, forbidden keywords, data-retention days, and audit-export enablement.
- Extended conversion upload jobs with retry, freshness, and dedupe status so Google/Meta upload candidates can be promoted or blocked with explicit reasons.
- Added `/api/admin/ad-os/runtime-readiness`.
  - Checks whether V41-V75 tables are present, admin APIs can return JSON, full auto is disabled, live external writes are zero, and tenant workspace/queues exist.
  - Can persist readiness checks for audit history when `apply=true`.
- Added `/api/admin/ad-os/platform-jobs/execute`.
  - Consumes approved/running platform jobs and writes dry-run execution attempts.
  - Allows paused/draft style verification; blocks active keyword activation, bid changes, Google live publish, Meta campaign publish, Kakao adapter gaps, and any unexpected `external_api_write=true`.
- Added `/api/admin/ad-os/conversion-upload/execute`.
  - Promotes clean conversion upload jobs to dry-run uploaded status with synthetic upload IDs.
  - Blocks consent-not-granted, low signal quality, stale/expired events, duplicate/collision dedupe states, and pre-blocked jobs.
- Added `/api/admin/ad-os/experiments/standardize`.
  - Seeds holdout, date split, landing A/B, creative A/B, and match-type A/B templates.
  - Keeps auto-winner and budget redistribution disabled until sample thresholds and operator approval are met.
- Added `/api/admin/ad-os/tenant-audit-export`.
  - Creates a monthly agency/SaaS audit draft with budget caps, automation level, full-auto state, live-write count, execution counts, conversion jobs, portfolio plans, and next actions.
- `/api/admin/ad-os/summary` and `/admin/ad-os` now expose V61-V75 runtime state:
  - readiness checks
  - executor attempts
  - experiment standards
  - tenant audit exports
  - combined external-write count
- Operating principle remains stricter than live automation: this layer verifies staging execution cycles end to end, but actual paid platform writes remain disabled unless a future channel adapter explicitly passes approval, budget, risk, kill-switch, and limited-autopilot gates.

## 39. 2026-06-03 Ad OS V76-V85 channel adapter packet layer

- Added server-only V76-V85 tables for channel adapter readiness and guarded platform write packets:
  - `ad_os_channel_adapter_health`
  - `ad_os_platform_write_packets`
- Added channel adapter APIs:
  - `GET/POST /api/admin/ad-os/channel-adapters/health`
  - `POST /api/admin/ad-os/channel-adapters/naver/paused-keyword`
  - `POST /api/admin/ad-os/channel-adapters/google/draft`
  - `POST /api/admin/ad-os/channel-adapters/meta/capi-test`
- Safety stance remains unchanged:
  - Naver can prepare paused keyword packets when credentials, permission, campaign/ad group, budget, and approval-level automation are ready.
  - Google is limited to campaign draft packets and conversion-action readiness checks. Live campaign publish stays disabled.
  - Meta is limited to CAPI test event and creative seed packets. Campaign publish stays disabled.
  - Every packet stores `dry_run=true` and `external_api_write=false`.
- `/api/admin/ad-os/summary` and `/admin/ad-os` now expose:
  - channel adapter snapshots by readiness state
  - platform write packets by ready/blocked/dry-run state
  - direct operator buttons for adapter health, Naver paused packets, Google draft packets, and Meta CAPI packets
- Acceptance evidence for this layer:
  - Operators can see whether each channel is missing credentials, blocked by permission, missing campaign, draft-ready, paused-write-ready, or executable.
  - Staging can record a full non-spend packet cycle before any live external write adapter is enabled.

## 40. 2026-06-03 Ad OS V86-V100 execution gate and rollback drill layer

- Added server-only V86-V100 tables:
  - `ad_os_adapter_execution_gates`
  - `ad_os_rollback_drills`
- Added APIs:
  - `POST /api/admin/ad-os/channel-adapters/execution-gate`
  - `POST /api/admin/ad-os/channel-adapters/rollback-drill`
- Execution gate purpose:
  - Evaluates whether a platform write packet can move toward limited autopilot.
  - Naver paused keyword packets are the only initial limited-write candidate.
  - Google and Meta remain draft/test-only and are blocked from limited write.
  - Human approval, tenant automation level, monthly/daily budget caps, max CPC, test-loss cap, kill switch, adapter readiness, packet readiness, and full-auto policy are all checked before eligibility.
- Rollback drill purpose:
  - Verifies the rollback payload and operational steps before any limited write is considered operational.
  - Naver rollback drill uses `pause_keyword` semantics and records dry-run verification steps.
  - Google draft and Meta CAPI test packets stay no-live-publish and are marked not-required or manual-review rather than live rollback.
- `/api/admin/ad-os/summary` and `/admin/ad-os` now expose:
  - execution gates by eligible/blocked/monitor-only/high-risk state
  - rollback drills by ready/blocked/not-required state
  - combined external write count across runtime, packets, gates, and drills
- Operating principle remains:
  - This layer does not spend money.
  - It proves whether the system is safe enough to begin a future Naver limited-write pilot under explicit approval and budget caps.

## 41. 2026-06-03 Ad OS V101-V120 Naver limited pilot control layer

- Added server-only V101-V120 tables:
  - `ad_os_limited_write_pilot_policies`
  - `ad_os_limited_write_pilot_attempts`
- Added API:
  - `POST /api/admin/ad-os/channel-adapters/naver/limited-pilot`
- Purpose:
  - Promotes the V76-V100 packet/gate/rollback chain into an auditable Naver limited pilot ledger.
  - Default policy is safe: `dry_run_only`, `live_external_write_enabled=false`, and `external_api_write=false`.
  - Live paused-keyword writes require all of these before a future executor can be enabled:
    - active pilot policy
    - Naver ready packet
    - eligible execution gate
    - ready rollback drill
    - human approval
    - monthly/daily/max-CPC/test-loss budget caps
    - explicit DB live-write flag
    - explicit environment flag `AD_OS_NAVER_LIMITED_WRITE_ENABLED`
- `/api/admin/ad-os/summary` and `/admin/ad-os` now expose:
  - limited pilot policies
  - dry-run succeeded attempts
  - blocked/live-blocked attempts
  - first blocker
  - external API write count
- Operating principle remains:
  - This layer still does not spend money.
  - It is the last staging/operations checklist before a future Naver paused-only external write executor is allowed.

## 42. 2026-06-03 Ad OS V121-V140 legacy Naver publisher safety interlock

- Added pure safety interlock logic for legacy Naver publisher routes:
  - `src/lib/ad-os-v121-v140.ts`
  - `src/lib/ad-os-v121-v140-db.ts`
- Updated legacy routes so they no longer call Naver external mutation APIs directly:
  - `POST /api/admin/ad-os/publish-naver-keywords`
  - `POST /api/admin/ad-os/publisher/naver/activate-paused`
- The old paused-keyword publisher now records decisions and can mark a keyword as eligible for the future audited executor, but it keeps `created_keywords=0` and `external_api_write=false`.
- The old activation publisher now records active-spend readiness only. It does not flip Naver keyword `userLock=false`.
- Any future legacy paused write requires all of these before it can be considered:
  - limited pilot policy `active`
  - policy level `live_paused_write`
  - `live_external_write_enabled=true`
  - monthly/daily/max-CPC/test-loss caps
  - environment flag `AD_OS_NAVER_LIMITED_WRITE_ENABLED`
  - request body `confirm_live_write=true`
- Any future active keyword activation additionally requires:
  - environment flag `AD_OS_NAVER_ACTIVE_KEYWORD_ENABLED`
  - request body `confirm_active_spend=true`
- Operating principle remains:
  - Legacy routes are now inspection/delegation routes, not external writers.
  - Real writes must go through a future audited executor that records packet, gate, rollback drill, policy, idempotency key, and mutation result in one chain.

## 43. 2026-06-03 Ad OS V141-V160 conversion PII storage hardening

- Added `sanitizeAdOsConversionPayload` for the conversion-event ingest path.
- `/api/admin/ad-os/conversion-events` now removes raw email, phone, customer name, passport, resident id, and nested PII-like fields before writing `ad_os_conversion_events.raw_payload`.
- The sanitizer keeps only SHA-256 first-party identifiers under `raw_payload.first_party_hashes`, plus a small `pii_redaction` evidence object.
- `quality_flags` now records whether raw PII was removed and whether first-party hashes are present, so data-quality dashboards can distinguish safe hashed signal from missing signal.
- Google/Meta conversion export packet builders now read `first_party_hashes` and can prepare upload candidates without requiring raw email or phone in `raw_payload`.
- Unit coverage proves raw PII is absent from sanitized payloads, Google upload packets can use hashed email, Meta upload packets can use hashed phone, and no raw PII appears in generated conversion export packets.

## 44. 2026-06-03 Ad OS V161-V180 external publish staging hardening

- Added `decideExternalPublishStaging` to separate three states that were easy to confuse:
  - approved internal change request,
  - staged audit/platform-job candidate,
  - externally confirmed applied result.
- `/api/admin/ad-os/external-publish` now creates mutation audit rows only and keeps approved external change requests in `approved` status while `external_api_write=false`.
- The route no longer marks approved requests as `applied` merely because channel gates pass. `applied` is reserved for a future audited executor that confirms an external mutation result.
- Run summaries now include `staged_for_executor_requests`, `applied_requests=0`, and a `staging` block with blockers such as `external_api_write_not_performed`.
- Unit coverage proves guarded apply can stage requests without marking them applied, dry-run remains unstaged, and explicit external result confirmation is required before applied semantics are allowed.

## 45. 2026-06-03 Ad OS V181-V200 conversion upload staging hardening

- Hardened `decideConversionUploadExecution` so dry-run conversion upload execution validates readiness but does not mark jobs as `uploaded`.
- Clean Google/Meta upload candidates now stay `approved` with `external_upload_id=null`, `uploaded_at=null`, and a `dry_run_verification_id` in `response_payload`.
- `/api/admin/ad-os/conversion-upload/execute` summary now separates `upload_ready_dry_run` from `uploaded_dry_run=0`.
- `/admin/ad-os` copy now says “전환 upload 준비 검증” instead of implying platform upload completion.
- Operating principle:
  - `uploaded` is reserved for a future platform adapter that actually receives and records an external upload id.
  - Dry-run readiness is useful evidence, but it is not an external upload result.

## 46. 2026-06-03 Ad OS V201-V220 external result confirmation layer

- Added `src/lib/ad-os-v201-v220.ts` and `POST /api/admin/ad-os/external-results/confirm`.
- Purpose:
  - Records an already-returned external platform result without calling Naver, Google, Meta, or Kakao from this route.
  - Keeps the execution route separate from the confirmation route, so `applied` and `uploaded` are not inferred from a dry run.
- Platform job confirmation:
  - Requires `confirm_external_result=true`.
  - Requires a linked `change_request_id`, `external_mutation_result_id`, and successful `external_resource_id`.
  - Only then moves `ad_os_platform_jobs.status=succeeded`, `ad_os_external_mutation_results.status=succeeded`, and `ad_os_change_requests.status=applied`.
  - Failed external results mark the platform job and mutation result failed, but keep the change request unapplied.
- Conversion upload confirmation:
  - Requires `confirm_external_result=true`.
  - Requires an `external_upload_id` before moving `ad_os_conversion_upload_jobs.status=uploaded`.
  - Failed upload confirmations mark the job failed and retain the blocked/error reason.
- Safety principle:
  - This route is confirmation-only and sets `external_api_write=false` because it does not execute external API writes itself.
  - External spend remains disabled unless a separate audited executor is built and explicitly enabled behind tenant policy, budget caps, kill switch, and environment flags.

## 47. 2026-06-03 Ad OS V221-V240 Naver paused-write executor gate

- Added `src/lib/ad-os-v221-v240.ts` and `POST /api/admin/ad-os/channel-adapters/naver/paused-write-executor`.
- Purpose:
  - Converts approved Naver `create_paused_keyword` platform jobs into an audited executor path.
  - Default mode is dry-run preflight. It checks payload, ad group id, automation level, and policy without calling Naver.
- Live paused keyword creation is allowed only when all conditions pass:
  - `requested_mode=live_paused_write`
  - `apply=true`
  - `confirm_live_write=true`
  - platform job is `naver/create_paused_keyword` and `approved` or `running`
  - keyword, bid, and `nccAdgroupId` are present
  - automation level is at least 3
  - latest Naver limited pilot policy is `active`, `pilot_level=live_paused_write`, and `live_external_write_enabled=true`
  - monthly budget cap, daily cap, max CPC, and test loss cap are set
  - environment flag, normally `AD_OS_NAVER_LIMITED_WRITE_ENABLED`, is enabled
- If live execution succeeds:
  - The route records an `ad_os_execution_attempts` row with `external_api_write=true`.
  - The platform job stays pending external result confirmation rather than directly applying the change request.
  - Operators must use `/api/admin/ad-os/external-results/confirm` with the returned Naver keyword id to mark the related change request as `applied`.
- Safety principle:
  - Active keyword activation and bid changes remain disabled in this executor.
  - Google/Meta/Kakao live campaign writes remain disabled.
  - A successful external write is not the same as applied semantics until confirmation records the external id.

## 48. 2026-06-03 Ad OS V241-V260 Google/Meta conversion upload adapter gate

- Added `src/lib/ad-os-v241-v260.ts` and `POST /api/admin/ad-os/conversion-upload/external-adapter`.
- Purpose:
  - Separates conversion upload readiness from actual Google/Meta external upload.
  - Keeps `/api/admin/ad-os/conversion-upload/execute` as dry-run readiness validation.
  - Uses the new external adapter only for the tightly gated upload step.
- Live conversion upload is allowed only when all conditions pass:
  - `requested_mode=live_upload`
  - `apply=true`
  - `confirm_external_upload=true`
  - job status is `approved` or `running`
  - consent is granted, signal quality is at least 60, event is fresh, dedupe is unique, and identifiers exist
  - global env flag `AD_OS_CONVERSION_UPLOAD_ENABLED` is enabled
  - platform env flag is enabled:
    - Meta: `AD_OS_META_CAPI_UPLOAD_ENABLED`
    - Google: `AD_OS_GOOGLE_CONVERSION_UPLOAD_ENABLED`
  - platform credentials are present:
    - Meta: pixel id plus CAPI/access token
    - Google: developer token, customer id, access token, and conversion action id
- If live upload succeeds:
  - The route records an `ad_os_execution_attempts` row with `external_api_write=true`.
  - The conversion job remains pending confirmation instead of immediately becoming `uploaded`.
  - Operators must call `/api/admin/ad-os/external-results/confirm` with the returned external upload id to set `ad_os_conversion_upload_jobs.status=uploaded`.
- Safety principle:
  - No conversion job becomes `uploaded` from a dry-run or from a platform upload response alone.
  - Google/Meta campaign publishing remains separate and disabled by default.

## 49. 2026-06-03 Ad OS V261-V280 operations queue visibility

- Extended `/api/admin/ad-os/summary` with an `ops_queues` layer derived from existing platform jobs, conversion upload jobs, and execution attempts.
- Added three normalized operator queues:
  - `ops_executor_queue`: approved/running platform jobs and conversion upload jobs that are ready for executor dry-run or gated live execution.
  - `ops_confirmation_queue`: jobs that have an external mutation/upload result pending human confirmation before `applied` or `uploaded` semantics are granted.
  - `ops_failed_queue`: blocked or failed platform jobs, conversion upload jobs, and executor attempts with blocker/next-action text.
- `/admin/ad-os` now shows these queues inside the Enterprise Runtime Layer with counts for execution, confirmation, blocked/failed, and live writes.
- Safety principle:
  - Operators can see exactly whether Ad OS is waiting for an executor, waiting for external result confirmation, or blocked by policy/data quality.
  - The UI does not introduce any new external write path; it only makes existing gates and pending states visible.

## 50. 2026-06-03 Ad OS V281-V300 row-level operations queue actions

- Added `POST /api/admin/ad-os/ops-queues/action` for row-level operator actions from `/admin/ad-os`.
- Supported safe actions:
  - `executor_dry_run`: validates one platform job or conversion upload job through the existing guarded runtime and writes an audit attempt when `apply=true`.
  - `confirm_failed`: marks one pending external platform/conversion result as failed through the existing confirmation deciders; success confirmation still requires the explicit external result API with an external id.
  - `acknowledge_blocker`: records that an operator reviewed a failed/blocked queue row without mutating external platforms.
- `/admin/ad-os` queue rows now expose only the action appropriate for their queue:
  - execution queue: `Dry-run`
  - external confirmation queue: `실패 확정`
  - failed/blocked queue: `차단 확인`
- Safety principle:
  - This layer still never calls Naver, Google, Meta, or Kakao.
  - It does not add a live write path and does not allow success confirmation without an external resource/upload id.
  - Live spend remains behind the dedicated channel adapter gates, tenant budgets, explicit confirmation flags, and environment flags.

## 51. 2026-06-03 Ad OS V301-V320 staging E2E smoke fixture

- Added `src/lib/ad-os-v301-v320.ts` and `src/lib/ad-os-v301-v320.test.ts`.
- Purpose:
  - Provides a deterministic Danang package smoke fixture for staging and CI.
  - Proves one product can generate scenarios, longtail keyword candidates, travel intent signals, creative drafts, a guarded Naver paused-keyword platform job, a clean Google conversion upload job, a data-quality snapshot, and a margin-aware portfolio plan.
  - Verifies the V281-V300 operations queue action policy only allows dry-run execution, failed-result confirmation, and blocker acknowledgement.
- Safety principle:
  - The fixture is pure TypeScript and does not read or write Supabase.
  - It does not call Naver, Google, Meta, or Kakao.
  - Every executor/conversion/ops action assertion requires `external_api_write=false`, so this becomes a regression tripwire before staging live-write pilots.

## 52. 2026-06-03 Ad OS V321-V340 incident response layer

- Added `src/lib/ad-os-v321-v340.ts` and `src/lib/ad-os-v321-v340.test.ts`.
- Purpose:
  - Converts existing platform jobs, conversion upload jobs, data-quality snapshots, execution attempts, and tenant workspaces into operator incident alerts.
  - Detects critical live-write flags, full-auto workspaces, limited automation without budget caps, blocked conversion uploads, duplicate dedupe/data-quality blockers, executor failures, and platform job guardrail blockers.
  - Exposes `enterprise_layer.incident_response` from `/api/admin/ad-os/summary` and shows it as the first Enterprise Runtime KPI on `/admin/ad-os`.
- Safety principle:
  - No new external write path is introduced.
  - Critical incidents recommend kill-switch review before any additional approval.
  - Degraded summary responses also surface as a critical runtime readiness incident, so operators do not mistake API failure for a clean system.

## 53. 2026-06-03 Ad OS V341-V360 agency reporting package

- Added `src/lib/ad-os-v341-v360.ts` and `src/lib/ad-os-v341-v360.test.ts`.
- Purpose:
  - Converts tenant workspaces, billing profiles, monthly tenant reports, audit exports, and incident status into a single agency/SaaS reporting readiness score.
  - Exposes `enterprise_layer.agency_reporting` from `/api/admin/ad-os/summary`.
  - Shows Agency Reporting as an Enterprise Runtime KPI on `/admin/ad-os` with report, audit, billing, readiness, and next-action status.
- Safety principle:
  - Client-facing report packaging is blocked when critical incidents or full-auto policy risks exist.
  - Degraded summary responses mark agency reporting as blocked until the data plane is healthy.
  - No external ad platform write path is introduced.

## 54. 2026-06-03 Ad OS V361-V380 completion audit layer

- Added `src/lib/ad-os-v361-v380.ts` and `src/lib/ad-os-v361-v380.test.ts`.
- Purpose:
  - Converts the Ad OS final-state requirements into a pass/warn/fail completion audit.
  - Audits external write safety, full-auto default-off policy, tenant budget guardrails, channel adapter visibility, platform job queues, conversion quality, margin learning facts, duplicate-content control, experiment standards, agency reporting, incident response, and runtime readiness.
  - Exposes `enterprise_layer.completion_audit` from `/api/admin/ad-os/summary`.
  - Shows Completion Audit as an Enterprise Runtime KPI on `/admin/ad-os` with readiness score, pass/warn/fail counts, and the next blocker.
- Safety principle:
  - This is deliberately not a "complete" flag. It prevents premature completion claims by requiring current evidence for each platform-grade requirement.
  - Degraded summary responses become blocked completion audits.
  - No external ad platform write path or database mutation is introduced.

## 55. 2026-06-03 Ad OS V381-V400 completion audit drilldown UX

- Extended `/admin/ad-os` Completion Audit from a score-only card into a compact drilldown.
- Purpose:
  - Sorts fail, warn, pass requirements by urgency and shows the top four directly in the Enterprise Runtime Layer.
  - Shows each requirement's status, evidence, and next action without opening raw JSON.
  - Keeps the high-level card visible while making the unfinished requirements actionable for operators.
- Safety principle:
  - Read-only UI change.
  - No external ad platform write path, database mutation, or automation level change is introduced.

## 56. 2026-06-03 Ad OS V401-V420 completion audit API

- Added `GET /api/admin/ad-os/completion-audit`.
- Purpose:
  - Makes the same completion audit shown on `/admin/ad-os` reusable by smoke tests, monitors, tenant report generators, and future agency dashboards.
  - Reuses `/api/admin/ad-os/summary`'s `enterprise_layer.completion_audit` so the dashboard and API cannot drift into different completion criteria.
  - Returns the full audit, compact summary, failed requirements, warning requirements, and explicit read-only safety metadata.
- Safety principle:
  - Read-only endpoint.
  - No external ad platform write path or database mutation is introduced.
  - Failure responses remain JSON and mark the endpoint as read-only with `external_api_write=false`.

## 57. 2026-06-03 Ad OS V421-V440 completion audit API hardening

- Hardened `GET /api/admin/ad-os/completion-audit` with an 8-second timeout around the shared summary builder.
- Purpose:
  - Prevents monitor calls from hanging when the summary data plane is slow.
  - Keeps failure responses machine-readable with `status=blocked` and a recovery next action.
- Safety principle:
  - Read-only endpoint remains read-only.
  - No external ad platform write path or database mutation is introduced.

## 58. 2026-06-03 Ad OS V441-V460 marketing health integration

- Extended `GET /api/admin/marketing/system-health` with read-only Ad OS completion checks.
- Purpose:
  - Makes the marketing System Health page show whether Ad OS is blocked, warning, or operationally ready using the same completion audit evidence as `/admin/ad-os`.
  - Adds explicit checks for completion audit status, external spend safety, and full-auto default-off policy.
  - Gives operators a direct next action instead of hiding Ad OS readiness behind raw JSON or a separate dashboard.
- `/admin/marketing/system-health` now highlights:
  - Ad OS completion score and top next action.
  - Whether any live external API write signal exists.
  - Whether full autopilot is still disabled by policy.
- Safety principle:
  - Read-only UI and API integration.
  - No external ad platform write path, database mutation, or automation level change is introduced.
  - The marketing health score now fails loudly when Ad OS completion evidence is unavailable, so operators cannot mistake a missing audit for a healthy system.

## 59. 2026-06-03 Ad OS V461-V480 command center completion gate

- Extended `/admin/marketing/command-center` with a read-only Ad OS Completion Gate.
- Purpose:
  - Shows completion audit status, readiness score, pass/warn/fail counts, and next action in the day-to-day marketing operations screen.
  - Highlights the four operator-critical requirements: external write safety, full-auto default-off policy, tenant budget guardrails, and incident response.
  - Links directly to `/admin/ad-os?panel=completion-audit` and `/admin/marketing/system-health` for drilldown.
- Safety principle:
  - UI-only change based on existing `/api/admin/ad-os/summary` data.
  - No external ad platform write path, database mutation, or automation level change is introduced.
  - The Command Center no longer treats product asset readiness as enough; Ad OS control-plane completion evidence is visible before operators scale campaigns.

## 60. 2026-06-03 Ad OS V481-V500 marketing dashboard completion summary

- Extended `/admin/marketing` with the same read-only completion audit summary used by Ad OS and the Command Center.
- Purpose:
  - Makes the first marketing dashboard screen show whether the advertising OS is ready, blocked, or needs attention.
  - Shows readiness score, pass/warn/fail counts, and the next action next to channel execution and tenant guardrail status.
  - Links operators to Command Center and System Health for action and evidence drilldown.
- Safety principle:
  - UI-only change based on existing `/api/admin/ad-os/summary` data.
  - No external ad platform write path, database mutation, or automation level change is introduced.
  - Marketing dashboard KPIs no longer imply that campaign scaling is safe unless Ad OS completion evidence is visible.

## 61. 2026-06-03 Ad OS V501-V520 completion view SSOT

- Added `src/lib/ad-os-completion-view.ts` and unit tests.
- Purpose:
  - Centralizes completion audit UI types, status-to-tone mapping, operator-critical requirement IDs, and fallback evidence.
  - Prevents `/admin/marketing`, `/admin/marketing/command-center`, and `/api/admin/marketing/system-health` from drifting on which completion requirements matter most to operators.
  - Keeps external write safety, full-auto default-off policy, tenant budget guardrails, and incident response as the shared first-screen requirements.
- Safety principle:
  - Pure TypeScript helper and UI/API refactor only.
  - No external ad platform write path, database mutation, or automation level change is introduced.
  - Completion display logic is now unit-tested so future UI changes cannot silently reinterpret blocked/ready states.

## 62. 2026-06-03 Ad OS V521-V540 completion audit deep link

- Added `/admin/ad-os?panel=completion-audit` handling.
- Purpose:
  - Makes links from Marketing Dashboard, Command Center, and System Health land directly on the Completion Audit evidence instead of only opening the top of Ad OS.
  - Scrolls the Completion Audit card into view and highlights it when the panel query is present.
- Safety principle:
  - UI-only navigation improvement.
  - No external ad platform write path, database mutation, or automation level change is introduced.

## 63. 2026-06-03 Ad OS V541-V560 staging smoke API

- Added `GET /api/admin/ad-os/staging-smoke` as a read-only operator smoke gate for the Ad OS control plane.
- The route reuses the deterministic Danang package fixture from V301-V320 to prove one product can generate scenarios, ultra-longtail keywords, travel intent signals, creative variants, a paused Naver platform job, a clean Google conversion upload candidate, a portfolio plan, and safe ops queue decisions.
- The response explicitly marks `read_only: true`, `fixture_only: true`, `database_mutation: false`, `external_api_write: false`, and `external_spend_krw: 0`.
- This does not replace DB-backed staging tests. It gives operators a fast JSON regression proof before they run Supabase migrations or external-platform dry-run flows.

## 64. 2026-06-03 Ad OS V561-V580 completion audit smoke UX

- Surfaced the staging smoke gate inside `/admin/ad-os?panel=completion-audit` so operators can see control-plane fixture evidence next to the completion audit.
- The UI shows pass/fail, assertion count, generated keyword count, creative variant count, external spend, and explicit DB/external-write off indicators.
- Added a `Read-only smoke` action and direct JSON drilldown to `/api/admin/ad-os/staging-smoke`.
- This remains a verification surface only. It does not mutate Supabase state, change automation level, or write to Naver/Google/Meta.

## 65. 2026-06-03 Ad OS V581-V600 operating inventory API

- Added `GET /api/admin/ad-os/operating-inventory` to turn the long Ad OS roadmap into a current operational inventory.
- The inventory groups readiness into control plane safety, operator UX, channel execution, conversion quality, booked-margin learning, creative factory, tenant SaaS packaging, and live autopilot readiness.
- Each area returns `operational`, `partial`, or `blocked`, plus evidence, next action, and risk level.
- The route is read-only and reports `database_mutation: false`, `external_api_write: false`, and `live_spend_krw: 0`.
