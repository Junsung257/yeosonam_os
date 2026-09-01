# 여소남 OS — 전체 기능 및 DB 스키마 현황 (2026-08-31 기준)

## 2026-08-31 블로그 자동발행 복구 안전계약

- 일일 발행 쿼터·일일 요약·최근 중복·롤아웃 관측의 기준을 원본 `content_creatives.status`가 아니라 실제 공개 자격 뷰 `public_blog_content_creatives`로 통일했다. 검수 반려·`noindex`·대표키 불일치로 숨겨진 글은 더 이상 발행 슬롯을 소모하지 않는다.
- 연구 실패 큐는 검증된 수요가 남고 허용된 정보성 의도이며 중복이 아닌 경우에만 1회 자동 재시도한다. 수요 없음, 상품 공개계약 미완성, 반복 실패, 위험 의도는 계속 차단한다.
- 동결 해제는 `recover_blog_publication_rollout_v1` 하나로 제한했다. 문제 글의 공개면 제거와 `URL_DELETED` 성공, 동결 이후 V5 비공개 카나리의 승인 attempt·완전한 prompt trace·결정 artifact·독립 편집 심사 통과를 DB가 확인하고, 성공 시에만 `pilot_3`로 복귀하며 불변 감사행을 남긴다.
- 운영 적용 순서는 코드/DB 배포 → 괌 공항-투몬 controlled canary 연구 재시도 → V5 비공개 생성 → 복구 dry-run → 감사형 동결 해제 → 정확한 단일 run 발행 → public/indexing read-back이다. 증거가 하나라도 없으면 동결을 유지한다.
- 운영 런타임이 승인된 괌 공항·관광청 원문을 반복해서 읽지 못하는 경우를 위해, exact URL·공식 registry id·active 상태·30일 이내 수집·미래 `valid_until`을 모두 만족하는 불변 `blog_information_source_versions`만 `reviewed_registry_snapshot`으로 대체 사용할 수 있다. 실시간 수집으로 위장하지 않으며, 전제 하나라도 어긋나면 글쓰기를 계속 차단한다. 괌 공항 교통 10개 승인 사실이 모두 모이면 연구 구조화와 최종 비교 본문은 모델 prose 대신 결정론 코드가 만든다.

## 2026-08-30 블로그 People-First 편집 하네스 V5

- 정보성 블로그는 모델 prose 전에 `blog-decision-artifact-v1`을 만든다. 제목 약속·직접 답변·공개 fact·정직한 출처 등급·계산 피연산자와 가정·근거 공백을 고정하고, 식비 시나리오 표와 57/67/85 USD 같은 합계는 모델이 아니라 결정론 코드가 만든다. 하루 총액을 뒷받침할 가격 묶음이 부족하면 제목을 메뉴 가격 예시 범위로 자동 축소한다.
- 자동발행은 기존 claim/SEO/render/중복 게이트에 더해 결정론 편집 검사와 DeepSeek Pro 독립 편집 심사의 usefulness·natural Korean·completeness·originality·source honesty를 모두 통과해야 한다. 한 차원이라도 실패하면 초안 뒤 재작성 1회만 허용하고 재실패·심사 호출/저장 실패는 격리한다. HIGH risk 사람 승인 규칙은 그대로다.
- `blog_generation_attempts`에는 실제 렌더 prompt/brief/claim packet 해시와 template/git/model/stage trace를 저장하며 새 승인 행은 DB constraint도 완전성을 강제한다. 편집 심사는 generation과 별도 예산 예약 행을 쓰되 같은 KST 일일 상한에 포함한다.
- 실제 괌 실패 글을 negative fixture로 박제했고 11 intent × pass/unanswered/source-dishonesty 33개 Promptfoo 사례와 집중 Vitest 계약을 CI에 연결했다. 운영 migration은 `20260830011340_blog_editorial_harness_v5.sql`이다.

## 2026-08-29 미래 블로그 생성 중복 방지 시스템

- 신규 블로그 생성·콘텐츠 허브·카드뉴스·랭킹·Creative Factory·자동발행·수동 승인 경로에 `blog-generation-dedup-v1` 게이트를 연결했다. 제목/슬러그의 결정론적 정규화와 동일 목적지·콘텐츠 종류의 유사도 검사를 통해 완전 중복은 차단하고, 유사 글은 비공개 검수 대기로 보낸다. 서로 다른 목적지의 실제 별도 글은 정상 경로를 계속 사용할 수 있다.
- 동시 생성 경합은 `blog_generation_dedup_claims`와 service-role 전용 원자 RPC가 맡는다. 생성 중 `reserved` lease, 저장 후 creative 연결, 실패 시 해제를 기록하며, 동일 creative의 승인된 교체만 자기 ID를 명시해 재사용할 수 있다.
- 기존 글은 자동 수정·삭제·병합·리다이렉트·제목 suffix backfill을 하지 않았다. 기존 중복은 기존 dry-run/운영 검수 대상으로 남긴다. 블로그 이미지는 이번 중복 계약의 범위에서 제외했다.
- 운영 반영 전 `supabase/migrations/20260829093545_blog_generation_dedup_claims.sql`을 적용해야 하며, 상세 계약은 `docs/blog-autopublish-contract.md`, 운영 대응은 `docs/blog-ops-runbook.md`에 기록했다.

## 2026-08-28 ChatGPT 구독형 공용 미디어 파이프라인

- 블로그·정보형 카드뉴스·홈 캠페인용 공용 미디어를 `media_assets` 원장과 전용 Storage bucket으로 통합했다. 생성 출처·프롬프트/brief digest·QA·검수·교체 이력을 보존하고, 공개 AI 이미지는 `AI 생성 참고 이미지`를 표시한다.
- 이미지는 `OPENAI_API_KEY`가 아니라 로그인된 Codex의 built-in ImageGen 구독 사용량으로 만든다. Vercel 내부 API는 전용 Bearer token으로 claim/complete/fail을 처리하고, 로컬 워커는 서버가 서명한 작업만 한 건씩 실행한다.
- 블로그 발행은 이미지 생성과 분리했다. 먼저 결정론적 브랜드 WebP로 발행하고 rollout 대상만 비동기 GPT 커버로 원자 교체한다. 공급사·공식·수동 사진과 동시 변경된 커버는 덮어쓰지 않으며 실패·한도 소진 시 기존 커버를 유지한다.
- 상품 상세/public snapshot은 documentary evidence 경계다. GPT 콘셉트 이미지와 코드형 캠페인 자산은 상품 hero/gallery로 승격할 수 없다. 정보형 카드뉴스는 한 master background를 재사용하고, 홈은 승인된 캠페인 자산만 별도 disclosure와 함께 사용한다.
- 운영 기본 안전장치는 안정 해시 rollout, KST 일일 claim 상한, lease, 공개 전 자동 QA, 수동 검수 UI(`/admin/marketing/media`)다. 상세 계약은 `docs/media-generation-current-ssot.md`가 단일 정보 소스다.

## 2026-08-24 어드민 로그인 운영 설정 복구·재발 방지

- 운영 `/login`은 실제 계정·비밀번호 문제가 아니라 Vercel Production의 `NEXT_PUBLIC_SUPABASE_URL` 누락과 공개키 계약 불일치 때문에 Supabase 요청 전 브라우저에서 실패했다. 새 표준인 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 클라이언트 번들에서 정적으로 참조하고, legacy anon 키는 전환기 fallback으로만 유지한다.
- 로그인 전용 Supabase 클라이언트는 세션 영속화·자동 갱신을 끈다. 앱의 기준 세션인 HttpOnly 서버 쿠키와 브라우저 localStorage가 같은 회전형 refresh token을 경쟁하는 경로를 제거했다.
- Vercel Production 빌드는 `NEXT_PUBLIC_SUPABASE_URL`, 공개키, `ADMIN_EMAILS`를 선검증한다. 누락·비 HTTPS URL이면 `prebuild`에서 실패하며 `npm run verify:admin-auth-env`로 로컬에서도 같은 계약을 강제할 수 있다.

## 2026-08-17 상품등록 DeepSeek 실제 샘플 재검증 보강

- 실제 샘플 HWP(`다낭 9월 499 스팟특가 3박4일`)를 pinned `deepseek-v4-flash` pass-a/pass-b에 다시 넣었다. rhwp 0.8.2 추출은 2,296자였고, 두 응답 모두 성공한 뒤 `499,000원(9/13~9/17, 8월 발권 조건)`과 `579,000원(9/21~9/22)` 두 규칙으로 합의했으며 source replay 검증도 통과했다.
- 모델이 같은 가격을 가리키면서 표 헤더·발권조건 라벨·주변 evidence를 조금 다르게 인용하는 경우는 결정론적으로 가격행·날짜행·발권조건행을 다시 묶는다. `9/13, 14, 15, 16, 17`처럼 월을 생략한 날짜 목록도 원문 replay에서 정상 검증한다. 값·적용범위가 실제로 다르면 계속 `human_required`로 차단한다.
- DeepSeek V4의 기본 thinking 응답이 JSON 출력 예산을 소진하는 경우를 막기 위해 상품등록 pinned 호출에만 `thinking: disabled`를 적용하고, 빈 응답에는 동일 요청 1회만 재시도한다. 다른 provider fallback이나 자동 확정은 없다.
- 구형 `extract-itinerary`의 직접 Gemini 호출도 제거했다. 텍스트 일정은 같은 DeepSeek gateway로 보내고, 이미지 일정은 지원 cohort 밖에서 `null`로 안전 종결한다. 등록 관련 경로의 직접 Gemini/Claude 호출 검색은 0건이다.
- 이 검증은 preview 키로만 수행했으며 로컬에는 Supabase service-role 키가 없어 provider-call ledger 비용 기록과 durable call ID가 생성되지 않았다. 따라서 이번 결과는 알고리즘·실제 provider 응답 확인이지 production 자동공개 인증이 아니다. `.env.prod`의 DeepSeek 키도 현재 placeholder 상태로 확인되어 교체·검증 전에는 공개를 해제하지 않는다.

## 2026-08-17 상품등록 V157 단일 DeepSeek·독립 원문 재검증 자동화 연결

- 정규화 `v6-canonical-2026-08-17.57`, workflow `product-registration-v6-workflow-23`, policy `product-registration-v6-policy-10-deepseek`로 승격했다. 기존에 꺼져 있던 critical-fact 단계를 실제 V6 workflow에 연결해, 결정론 가격 그래프가 풀지 못한 구간만 DeepSeek를 pass-a/pass-b로 별도 provider-call ledger에 각각 호출하고, 두 결과가 같은 후보·원문 anchor·quote hash를 가리킬 때만 revision override 후보로 저장한다.
- AI는 고객 사실을 직접 쓰지 않는다. source replay, 동일 적용범위 가격 충돌 검사, provider-call ID·input hash·policy version을 모두 통과해야만 canonical compiler가 원문 evidence에서 다시 만든 가격을 반영한다. 불일치·provider 장애·동일 범위 상충은 `human_required`/`provider_unavailable`/`invalid`로 자동 종결하며 기존 `publication_freeze=true`는 유지한다.
- 동일 원문·동일 정책·pass의 provider 결과는 ledger에서 재사용하여 재시도 중 중복 과금을 막고, 기존 human override는 자동 결과가 덮어쓰지 않는다. 결정론 parser가 이미 유일한 해를 낸 구간에는 AI 호출을 하지 않는다.
- 이번 변경은 실제 운영 DB·배포·고객 pointer를 변경하지 않았다. DeepSeek 운영 키가 없는 로컬에서는 provider stage가 실제 자동복구율을 증명할 수 없으므로, 다음 단계는 비공개 shadow workflow에서 provider-call ledger와 400개 이상 blind benchmark를 실행하는 것이다.

- 최신 정규화 `v6-canonical-2026-08-17.57`, workflow `product-registration-v6-workflow-23`, policy `product-registration-v6-policy-10-deepseek`로 private HWP 1,171개·고유 원문 1,047개·여행상품 원문 895개를 동일 lineage split과 기준일 `2026-08-16`에서 다시 실행했다. 추출 대상은 961/961 성공했고 더 정확한 호텔·등급·기간 경계로 상품 구간은 1,698개가 됐다. 아래 수치는 AI provider가 없는 기존 deterministic shadow 기준이며, 자동복구율 인증 수치가 아니다.
- 과거 일정 751구간과 원문 판매가 부재 27구간은 상품·고객 URL 없이 안전 종결한다. 판매 판정 대상 920구간 중 verified/degraded 구조 후보는 759구간(82.50%), 차단은 161구간이다. 개발은 546/633(86.26%), calibration은 77/103(74.76%), frozen은 개별 원문을 열지 않은 aggregate 기준 136/184(73.91%)다.
- 가격 parser는 더 이상 먼저 성공한 하나가 다른 후보를 버리지 않는다. 모든 parser가 금액·날짜·요일·호텔·등급·기간·evidence 후보를 만들고, source authority와 hard constraint가 유일한 해만 선택한다. `금액→날짜`, `날짜→금액`, 여러 날짜 뒤 공통금액, 한 가격열을 기간별 상품에 재사용하는 한국어 HWP 표를 지원하며, `별도문의/마감` 날짜에는 가격을 만들지 않는다.
- 동일 개수의 표 상품 경계는 공용 가격표가 일부 상품에만 명시적으로 연결된 경우에만 flat 경계를 대체한다. 이로써 가격이 있는 품격 상품과 가격이 없는 실속 상품을 별도 상품으로 유지하고, `요금표참조` 상품에 이웃 호텔·기간의 가격을 빌려 붙이던 기존의 위험한 공개 후보를 차단한다. 구조 후보율 하락은 이 안전 강화와 추가 상품 분리의 영향이며 정확도 하락으로 단정하지 않는다.
- 외부 Kernel 계약은 `RegistrationKernelInput → KernelFinding → PublicationDecision` 하나로 통일했다. replay·retry·IR/Band/scan adapter는 같은 V6 workflow를 사용하고, raw `travel_packages` proof와 임시 활성화는 허용하지 않는다. 고객 목록·상세·LP·채널 reader는 current publication pointer의 immutable snapshot만 읽으며 mutable V4 gate나 attraction DB를 요청 시 재평가하지 않는다.
- 엄격 Kernel-only 권위 검사는 `authorized=1`, `legacy=0`, `unapproved=0`으로 통과했다. 관련 집중 회귀 26파일·270테스트(조건부 skip 7), 후보/Kernel 집중시험 89개, TypeScript, production build와 postbuild 산출물·rhwp runtime 검사가 통과했다. 로컬 운영 비밀키 부재로 sitemap 데이터 조회는 fail-closed 경고였으며 빌드는 성공했다. 운영 DB·배포·고객 pointer는 변경하지 않았다.
- 현재 82.50%는 구조상 안전 후보율이지 정확도 인증이 아니다. 독립 이중검수 정답지는 0건이며 단순 구조 후보 95%에는 115구간, 같은 920구간에서 단측 Wilson 하한 95%에는 126구간을 더 정확하게 복구해야 한다. 최종 고객 오픈은 frozen 판매대상 400개 이상에서 관측 97% 이상·critical exact match 99.5% 이상·치명적 오공개 0건을 연속 두 번 증명해야 한다. `publication_freeze=true`를 유지한다.

## 2026-08-17 상품등록 V147 기간·가격축 다중상품 복구

- 최신 정규화 `v6-canonical-2026-08-17.47`, workflow `product-registration-v6-workflow-13`로 private HWP 1,171개·고유 원문 1,047개를 동일 lineage split과 기준일 `2026-08-16`에서 다시 실행했다. 추출 대상 961개는 961/961 성공했고 여행상품 구간은 1,673개다.
- 과거 일정 754구간과 실제 판매가 부재 31구간(중복 4구간)은 상품 없이 안전 종결한다. 판매 판정 대상 892구간 중 verified/degraded 구조 후보는 721구간(80.83%), 차단은 171구간이다. 개발 509/617(82.50%), calibration 83/100(83.00%), frozen aggregate 129/175(73.71%)다.
- 실제 연길 원문에서 `4일 일반·노쇼핑 + 3일 일반·노쇼핑` 네 일정표와, 상품 수보다 적은 두 가격열을 한 상품으로 합치던 오류를 수정했다. 기간 행(3일/4일)과 상업조건 가격열(노쇼핑 여부)을 함께 매칭해 네 상품으로 분리하고 각 상품에는 해당 기간·가격열만 연결한다. 네 상품 모두 원문 가격·호텔·일정·상업조건을 분리한 `published_degraded` 구조 후보로 종결한다.
- 관광설명의 `3,400여개`처럼 수량·거리·면적 숫자를 판매가로 읽지 않는다. 실제 판매가가 없는 일정표는 가짜 3,400,000원 상품 대신 `discarded_source_incomplete`와 관리자 검토 알림으로 종결한다.
- 직접 상품 생성·수정·삭제, 근거 없는 stub·clone, mutable 고객문구·안내문·강제 승인, 과거상품 status 직접 archive와 mutable dynamic pricing을 제거했다. 자동 archive는 catalog identity가 있는 상품만 availability overlay로 닫고, 검색 embedding은 travel_packages 대신 현재 immutable public snapshot에 결박된 별도 projection으로 저장한다. 권위 기준선은 `authorized=1`, `legacy=114`, `unapproved=0`으로 줄었으나 Kernel-only 합격 조건인 legacy 0에는 아직 도달하지 않았다.
- 이 수치는 구조상 안전 후보율이지 정확도 80.54%라는 뜻이 아니다. 독립 이중검수 정답지는 아직 0건이며, frozen publication-eligible 400구간 이상·관측 97%·Wilson 하한 95%·치명적 오공개 0건을 연속 두 번 증명할 때까지 `publication_freeze=true`를 유지한다. 운영 DB migration·배포·고객 pointer는 이번 회귀검증에서 변경하지 않았다.

## 2026-08-17 상품등록 실제 HWP → 고객 모바일 proof 최종 검증

- 실제 푸꾸옥 HWP를 운영 V6 workflow로 다시 처리해 원문 → EvidenceIR → 불변 revision → typed 사실 → 불변 snapshot → signed 비공개 `/packages`·`/lp` → 390×844 Chrome proof를 통과시켰다. 결과는 `ready_degraded_not_published`이며 유일한 공개 차단 사유는 `PUBLICATION_FREEZE_ACTIVE`다. 고객 public pointer는 만들지 않았다.
- 최종 snapshot hash `6aac1ba2af63b6dcaec6e9deec0d00f2440cfab5934e3eb0d2aa9d63a1af3630`가 상세·LP·proof에서 정확히 일치했다. 두 화면은 HTTP 200, CTA 열림, 한글 폰트, 깨진 이미지 0, 금칙/누락 문구 0, hydration 오류 0으로 합격했다.
- 고객 화면에는 9/10 799,000원·9/18 699,000원, 포함/불포함, 1인당 USD 50 기사·가이드 경비, 쇼핑 2회, 대체 숙소 묶음, 표준약관 fallback이 원문대로 표시된다. 출발확정 근거가 없는 날짜에 확정 배지를 붙이지 않으며 LJ119/LJ120 시간은 다른 상품에서 빌리지 않고 최종 확인 상태로 숨긴다.
- proof가 고객 행동·리뷰점수·광고 engagement·Web Vital을 쓰지 않도록 격리했고 관련 없는 리뷰 요약도 제거했다. 진단 중 생성된 시험 전용 analytics는 삭제했으며 고객 데이터는 없었다.
- 전체 Vitest 738파일·5,661테스트(기존 조건부 skip 7), TypeScript, production build, 상품등록 권위 계약(`authorized=1 legacy=136 unapproved=0`)이 통과했다. 운영 Supabase의 상품등록 보안 WARN/ERROR는 0이며 중복 catalog index도 제거했다. 30분 이상 멈춘 V6 작업은 과거/시험 4건을 정식 격리 종결한 뒤 0건이다.
- 이 결과는 실제 원문 한 건의 end-to-end 고객 사용성을 입증하지만 95% 전수 정확도 인증은 아니다. 최신 정규화 `v6-canonical-2026-08-17.47`로 고정 corpus를 다시 실행하고, 독립 이중검수 publication-eligible frozen 400구간 이상을 연속 2회 합격하기 전까지 `publication_freeze=true`를 유지한다.

## 2026-08-16 상품등록 무료 우선 미디어 원장·고객 표시 통합

- 상품 사진은 이제 `불변 revision에 연결된 권리 확인 이미지 → tenant/목적지별 검증 무료 이미지 풀 → Wikimedia Commons → Pexels → 브랜드 기본 이미지` 순서로 결정한다. Wikimedia는 정확한 Wikidata 목적지 라벨과 CC0·Public Domain·CC-BY만 허용하고, Pexels는 목적지명이 alt에 확인되며 가로·해상도 기준을 통과한 사진만 사용한다.
- 확보한 무료 이미지는 tenant·provider asset ID·목적지 key로 원장에 남겨 재사용한다. provider·원본 페이지·작가·라이선스·확인시각·목적지 적합성·콘텐츠 안전상태를 함께 저장하며 service-role RPC만 revision에 연결할 수 있다. 외부 provider 실패나 사진 부재는 상품을 차단하지 않고 브랜드 이미지로 안전 축약한다.
- 기존 업로드 후 `products.thumbnail_urls`를 직접 바꾸던 `auto-photo-match` writer를 제거했다. V6 revision aggregate → immutable snapshot → 목록 카드·상세·모바일 LP가 같은 `hero_media`를 사용하고, URL 도메인 추정 대신 `reference_only`, 고객 라벨, 출처와 라이선스 링크를 표시한다. broad attraction 사진 resolver는 raw 관리자 proof에만 남고 고객 snapshot을 덮어쓸 수 없다.
- 순방향 migration `20260816112631_product_registration_free_media_provenance.sql`과 같은 배포 묶음의 terminal outcome·route alias·legacy RPC 퇴역 migration을 운영 DB에 적용했다. 적용 전 운영과 동일한 현재 schema에서 네 migration을 한 transaction으로 실행·계약 검사·rollback했고, 적용 후 bucket·컬럼·RPC 권한과 migration 이력을 다시 확인했다. `authority_mode=shadow`, `publication_freeze=true`이며 고객 pointer는 변경하지 않았다.
- 전체 Vitest 736파일·5,640테스트가 통과했고 7개는 기존 조건부 skip이다. production build·TypeScript·변경 파일 lint·상품등록 권위 계약이 통과했다. 빈 로컬 DB 전체 재구축은 2026-03-31 첫 legacy migration이 선행 `customers` 테이블을 가정하는 기존 migration-baseline 결함으로 중단됐고, 이번 네 migration 자체는 운영 schema transaction 검증과 실제 적용을 모두 통과했다.

## 2026-08-16 상품등록 V138 가이드비 상업 문맥·실원문 전수 회귀검증

- 정규화 `v6-canonical-2026-08-16.38`로 private HWP 1,171개·고유 원문 1,047개·여행상품 원문 895개를 고정 lineage split에서 다시 처리했다. 추출 대상 961개는 961/961 성공했고 상품 구간은 1,711개다.
- 과거 일정뿐인 754구간과 실제 판매가가 없는 원문 10구간은 상품·snapshot·고객 URL 없이 안전 종결했다. 공개 판정 대상 947구간 중 verified/degraded 구조 후보는 730구간(77.09%), 차단은 217구간이다. 과거·원문 불완전 종료까지 포함한 자동 안전 종결은 1,494/1,711(87.32%)이다.
- split별 구조 후보율은 development 508/649(78.27%), calibration 87/103(84.47%), frozen은 개별 원문을 열지 않은 aggregate 기준 135/195(69.23%)다. V119와 비교 가능한 활성 비동결 757구간에서 회복 0·회귀 0이다. V95 이후 상품 구간 분리와 terminal contradiction 집합이 더 엄격해져 분모가 달라졌으므로 V95 비율과 직접 비교하지 않는다.
- 공급사별 공백이 들어간 `포 함 사 항`, 역순 HWP 표의 금액 있는 가이드비, 근처의 불포함 제목, `▶`로 나뉜 가이드 서비스와 에티켓팁을 각각 독립 문맥으로 판정한다. 포함 구역의 금액 없는 기사·가이드팁은 포함으로 유지하고, 역순 행의 `$50/인`은 현지 별도비로 유지한다. 마사지팁·싱글차지 금액을 가이드비로 빌리지 않는다.
- 실제 포함/노팁과 가이드비 불포함이 한 상품에서 충돌하면 계속 차단한다. 같은 원문의 별도 상품이 포함만 명시하면 그 상품은 독립적으로 통과한다. 구조 후보율을 높이기 위해 이 모순 차단을 약화하지 않았다.
- 전체 Vitest 734파일·5,626테스트가 통과했고 7개는 기존 조건부 skip이다. 상품등록 학습검증, TypeScript, golden corpus, OCR/PDF 후보 proxy, 상품등록 계약, 권위 계약(`authorized=1 legacy=137 unapproved=0`), migration-prefix 기준선이 통과했다.
- live 업로드 회귀는 이 작업공간에 Supabase 환경이 없어 skip됐고 실제 Chrome 모바일 proof도 실행하지 않았다. 이 결과는 구조상 공개 후보율이지 독립 정답지 exact-match 정확도가 아니다. 검수된 frozen 300구간 이상·연속 2회 합격·실업로드→동일 hash 모바일 proof가 없으므로 `publication_freeze=true`를 유지하며 운영 DB·배포·고객 pointer는 변경하지 않았다.

## 2026-08-16 상품등록 V95 등급·기간 상품 정체성 및 고객 사실 격리

- 정규화 `v6-canonical-2026-08-16.27`로 private HWP 1,171개·고유 원문 1,047개·여행상품 원문 895개를 동일 lineage split에서 다시 처리했다. 추출 대상 961개는 961/961 성공했고 상품 구간은 1,641개다.
- 과거 일정뿐인 737구간과 실제 판매가가 없는 원문 10구간은 상품·snapshot·고객 URL 없이 안전 종결했다. 공개 판정 대상 894구간 중 verified/degraded 구조 후보는 797구간(89.15%), 차단은 97구간이다. 전체 자동 안전 종결은 1,544/1,641(94.09%)다.
- 공개 판정 대상 split별 구조 후보율은 development 567/615(92.20%), calibration 89/103(86.41%), frozen은 개별 원문을 열지 않은 aggregate 기준 141/176(80.11%)다. V94와 비교 가능한 723개 비동결 구간에서 회복 0·회귀 0이며, 승격은 독립 검수 정답지 부재 때문에 계속 차단한다.
- 실제 서안 원문의 `[실속]/[품격] × 3박5일/4박6일`을 네 상품으로 분리한다. HWP 출발일 머리글이 비어 있고 `22, 29품격확정일`처럼 상태 문구가 날짜에 붙어 있어도 월·요일·등급 열을 근거로 각 가격을 연결한다. 발권조건·포함내역 같은 병합 footer는 상품 등급으로 오인하지 않는다.
- 공통 가격표는 모든 상품이 볼 수 있게 유지하되 고객에게 보이는 가이드비·옵션·쇼핑·표준 안내는 각 상품의 로컬 구간에서 다시 투영한다. 따라서 실속의 가이드/기사비 불포함과 품격의 가이드비 포함·노옵션·노쇼핑이 서로 섞이지 않는다. 로컬 구간만으로 전체 V3 해석을 대체했던 중간안은 285개 회귀를 일으켜 폐기했고, 가격은 공통 문맥을 보존하면서 고객 사실만 격리하는 방식으로 확정했다.
- 원문 설명의 `37년에 걸쳐` 같은 기간 표현은 2037년 출발 근거가 될 수 없다. 파일명·상품 제목·가격표의 실제 연도 문맥만 사용한다. 과거 출발일과 미래 출발일이 같이 남아 있을 때 발권기한 연도는 최초 미래 출발을 기준으로 정해 `7/30`을 과거 연도로 잘못 돌리지 않는다.
- 방어 규칙으로 가이드비 포함과 현지지불 금액이 동시에 노출되는 상품, 노옵션인데 고객 옵션이 있는 상품, 노쇼핑인데 쇼핑 일정이 있는 상품은 공개를 차단한다. 실제 서안 네 상품은 가격·기간·DAY·고객 조건이 각 상품에 맞고, 호텔 `또는 동급`만 안전 축약한 degraded 후보로 재생된다.
- 전체 Vitest 734파일·5,590테스트가 통과했고 7개는 기존 조건부 skip이다. TypeScript, 상품등록 계약 검사, 권위 계약(`authorized=1 legacy=137 unapproved=0`), whitespace 검사가 통과했다. 운영 Supabase·배포·고객 pointer는 변경하지 않았고 실제 Chrome 모바일 proof도 이번 로컬 회귀에서 실행하지 않았다.
- 이 결과는 구조상 공개 후보율이지 원문을 가린 독립 이중검수 exact-match 정확도가 아니다. calibration과 frozen이 아직 95%에 못 미치며 frozen 300구간 이상의 이중검수 정답지·치명적 오류 0건·실제 업로드→snapshot→모바일 proof가 없으므로 `publication_freeze=true`를 유지한다.

## 2026-08-16 상품등록 V82 전체 오류 재감사·원문 회귀검증

- 정규화 `v6-canonical-2026-08-16.17`로 private HWP 1,171개·고유 원문 1,047개·여행상품 원문 895개를 동일 lineage split에서 다시 처리했다. 추출 대상 961개는 961/961 성공했고 상품 구간은 1,632개다.
- 과거 일정뿐인 717구간과 실제 판매가가 없는 원문 10구간은 상품·snapshot·고객 URL 없이 안전 종결했다. 공개 판정 대상 905구간 중 verified/degraded 후보는 768구간(84.86%), 차단은 137구간이다. 과거·원문 불완전 종료를 포함한 자동 안전 종결은 1,495/1,632(91.61%)다.
- development는 538/622(86.50%), calibration은 90/104(86.54%), frozen은 개별 사례를 열지 않은 aggregate 기준 140/179(78.21%)다. 비동결 비교 가능 726구간에서 9구간이 회복됐고 3구간이 새로 차단됐다. 새 차단 3건은 예약금 300,000원을 판매가로 오인하거나 다른 기간·호텔의 9월 가격을 7~8월 상품에 붙이던 위험을 제거한 안전 수정이며, 이전의 안전하지 않은 결과로 되돌리지 않는다.
- 청도 골프 원문은 가격표와 반복 일정이 두 상품으로 잘못 분리되던 문제를 고쳐 1상품·128개 출발일 가격·가격 충돌 0건으로 재생했다. 성도 원문은 Premium/Crown과 3박5일/4박6일을 네 상품 축으로 분리했고 각 축의 날짜 가격 충돌은 0건이다. 발리 원문은 3박5일과 4박6일이 각자의 지역 가격표만 사용하며 공통 머리말의 다른 상품 가격을 섞지 않는다.
- 예약금·계약금은 성인 판매가가 될 수 없다. 상품 구간의 호텔/등급/기간을 원문 가격 축에서 유일하게 식별할 수 없으면 다른 상품 가격을 복사하지 않고 차단한다. 새 등급 행렬 해석은 실제 검증된 Premium/Crown 양식에만 한정해 목적지가 다른 한국어 등급표에 일반화되는 오염을 막았다.
- 유류할증료가 포함과 불포함에 동시에 기재된 경우 고객 예상 총액을 만들지 않고 `commercial_terms_conflict`로 공개를 차단한다. 가이드비는 불포함이면 상품가나 고객 예상 부담액에 합산하지 않는 기존 규칙을 유지한다.
- 상품등록 관련 Vitest 167파일·1,253테스트, TypeScript, 변경 파일 lint, 학습엔진 전체 검증, 권위 계약(`authorized=1 legacy=140 unapproved=0`), whitespace 검사가 통과했다. Supabase 환경이 필요한 live 업로드 회귀와 실제 Chrome 모바일 proof는 이번 로컬 검증에서 실행되지 않았다.
- 공개 판정 대상 단순 95%에는 92구간, 단측 95% Wilson 하한 95%에는 103구간을 추가로 오류 없이 회수·독립 검수해야 한다. 현재 수치는 구조상 안전 처리율이지 독립 이중검수 exact-match 정확도가 아니므로 `publication_freeze=true`를 유지하며 운영 DB·배포·고객 pointer는 변경하지 않았다.

## 2026-08-16 상품등록 V80 고객예산·기간상품 표 결합 전수 재검증

- 정규화 `v6-canonical-2026-08-16.15`로 private HWP 1,171개·고유 원문 1,047개·여행상품 원문 895개·상품 구간 1,636개를 동일 split에서 다시 계산했다. 추출 대상 961개는 961/961 성공했다.
- 과거 일정뿐인 723구간과 판매가가 실제로 없는 10구간은 상품·고객 URL 없이 안전 종결했다. 공개 판정 대상 903구간 중 verified/degraded 후보는 761구간(84.27%), 차단은 142구간이다. 과거·원문 불완전 종료를 포함한 자동 안전 종결은 1,494/1,636(91.32%)이다.
- development는 532/619(85.95%), calibration은 86/104(82.69%), frozen은 개별 사례를 열지 않은 aggregate 기준 143/180(79.44%)다. 직전 V79와 비교 가능한 비동결 728구간에서 코타키나발루 3박5일/4박6일 가격 2구간이 회복됐고 회귀는 0개다.
- 상품가에 가이드비가 불포함으로 적혀 있으면 가이드비는 상품가와 고객 예상 부담액에 더하지 않고 불포함에 금액·통화·단위를 보존한다. 고객 예상 부담액은 `성인 기준 상품가 + 원문에 금액이 확정된 별도 유류할증료`만 합산한다. 유류할증료가 상품가에 포함이면 추가하지 않고, 별도이지만 금액 미정이면 총액을 만들지 않고 확인 필요로 표시한다.
- row/column 병합된 `출발일 | 패턴 | 상품가` 표는 `3박5일`과 `4박6일`을 각각 별도 기간 상품으로 만들고 각 행의 요일·가격을 같은 기간에만 연결한다. 반대로 실제 `중중 더블온천팩`, `실속 비에이 3박4일`, `품격 비에이 3박4일` 원문은 모두 상품 구간 1개·variant 1개다. 중중/실속 가격표는 중복 날짜와 가격 충돌이 0개이며, 품격 비에이는 현재 모든 출발일이 지나 가격 없이 안전 종료될 뿐 두 상품으로 분리되지 않는다. 시각적 그룹 범위를 첫 가격으로 전체 확장해 두 상품처럼 보이게 하던 오류를 제거했다.
- 고객 상세와 모바일 LP는 고정 문구 `유류세 포함`을 사용하지 않는다. snapshot에 원문 근거 고객예산 계약을 저장하고, 가이드비 제외 및 유류할증료 포함/별도/미정 상태를 그대로 표시한다.
- 상품등록 Vitest 153파일·1,034테스트, TypeScript, 변경 파일 lint, 권위 계약(`authorized=1 legacy=140 unapproved=0`)이 통과했다. 운영 DB·배포·고객 pointer는 변경하지 않았고 `publication_freeze=true`를 유지한다.
- 이 수치는 구조상 안전 처리율이지 독립 정답지 exact-match 정확도가 아니다. 공개 판정 대상의 단순 95%에는 97구간, 단측 95% Wilson 하한 95%에는 108구간을 오류 없이 더 회수·독립 검수해야 한다. 독립 이중검수 frozen 정답지와 실제 고객 모바일 proof가 완료되기 전에는 고객 전면 오픈을 승인하지 않는다.

## 2026-08-15 상품등록 V78 사용자 업무규칙 반영·전수 재검증

- 정규화 `v6-canonical-2026-08-15.13`으로 실제 private HWP 1,171개·고유 원문 1,047개·여행상품 원문 895개·상품 구간 1,636개를 다시 계산했다. 추출 대상 961개는 961/961 성공했다.
- 과거 일정뿐인 713구간과 판매가가 실제로 없는 10구간은 상품·고객 URL 없이 안전 종결했다. 공개 판정 대상 913구간 중 verified/degraded 후보는 760구간(83.24%), 차단은 153구간이다. 과거·원문 불완전 종료를 포함한 자동 안전 종결은 1,483/1,636(90.65%)이다.
- development는 533/625(85.28%), calibration은 85/106(80.19%), frozen은 개별 사례를 열지 않은 aggregate 기준 142/182(78.02%)다. 직전 V77과 비교 가능한 비동결 736구간에서 나리타·오사카·후쿠오카 골프 3구간이 회복됐고 회귀는 0개다.
- 기간·요일 기본가보다 원문에 숫자가 적힌 `제외일자`·특수일 가격이 우선한다. `별도문의`·문의기간에 숫자가 없으면 주변 기본가를 상속하지 않고 그 날짜는 고객 가격표에서 제외한다. 실제 다낭 원문은 9/22 869,000원·9/23 1,599,000원·9/24 1,169,000원을 적용하고 9/25 별도문의에는 가격을 만들지 않는다.
- 하나의 상품에서 `A호텔, B호텔 또는 동급`은 미확정 대체 숙소 묶음으로 보존한다. 반면 휴양지 가격표의 `헤난 알로나 비치`와 `프리미어 코스트`처럼 숙소가 상품 축으로 나뉘면 일정이 같아도 별도 상품이다. `USJ 8만원 UP`은 별도 상품이 아니라 같은 상품의 선택 옵션이다.
- 출발일이 없는 실제 `[진에어] 오사카나라교토 3일 일정표.hwp`가 존재한다. 가격·항공·일정이 있어도 판매 출발일을 다른 상품이나 현재 날짜로 만들어내지 않고 `blocked_action_required`로 유지한다. 판매가가 실제로 없는 원문은 사용자 결정대로 등록 대상에서 폐기하되 private 원문은 감사용으로 보존한다.
- 단일상품 문서의 표 머리말에 `2026년 8월 ~ 2027년 3월`이 있고 본문 구간에는 연도가 빠진 경우 문서 공통 근거를 그 상품에 연결한다. 다중상품 문서는 계속 상품 구간별로 연도를 판정해 다른 상품의 연도가 새지 않게 한다.
- 상품등록 Vitest 141파일·911테스트, 추가 집중 회귀 74테스트, TypeScript, 변경 파일 lint, 권위 계약(`authorized=1 legacy=140 unapproved=0`)이 통과했다. 운영 DB·배포·고객 pointer는 변경하지 않았고 `publication_freeze=true`를 유지한다.
- 이 수치는 구조상 안전 처리율이지 독립 정답지 exact-match 정확도가 아니다. 95% 단순 지점에는 108구간, 단측 95% Wilson 하한 기준에는 119구간을 오류 없이 더 회수해야 한다. 독립 이중검수 frozen 정답지와 모바일 proof가 완료되기 전에는 고객 전면 오픈을 승인하지 않는다.

## 2026-08-15 상품등록 V75 실제 원문 정책 재검증

- 정규화 `v6-canonical-2026-08-15.12`로 private HWP corpus를 다시 계산했다. 실제 파일 1,171개·고유 원문 1,047개·여행상품 원문 895개·상품 구간 1,636개이며, 추출 대상 961개는 961/961 성공했다.
- 과거 일정뿐인 713구간은 새 상품을 만들지 않고 종료했고, 실제 판매가가 없는 10구간은 원문만 private 보존했다. 공개 판정 대상 913구간 중 verified/degraded 안전 후보는 755구간(82.69%), 차단은 158구간이다. 과거 제외·원문 불완전 폐기까지 포함한 자동 안전 종결은 1,478/1,636(90.34%)이다.
- development는 528/625(84.48%), calibration은 85/106(80.19%), frozen은 개별 원문을 열지 않은 aggregate 기준 142/182(78.02%)다. 직전 V74와 비교 가능한 736구간에서 1개가 회복됐고 회귀는 0개다.
- HWP 표의 `상품명 | 출발일 | 상품가`가 행 병합된 다중상품 형식, 기본 기간 가격과 특정 기간 override, 한 표 안의 3박4일/4박5일 월별 출발일·가격을 상품별로 분리한다. `449,-` 같은 축약은 판매가 문맥에서 449,000원으로 복원하고, 항공 운항일정의 숫자는 판매가로 승격하지 않는다.
- 공통 날짜 목록 뒤에 나오는 유일한 성인 판매가는 HWP의 평탄화된 읽기 순서와 무관하게 같은 상품 표 안에서만 연결한다. `$100/인`, 가이드비, 싱글차지, 계약금, 커미션 등 비판매 금액은 `1인` 문구가 있어도 성인 판매가가 될 수 없다.
- 상품등록 관련 Vitest 141파일·907테스트와 전체 회귀 732파일·5,544테스트, TypeScript, 변경 파일 lint, 권위 계약(`authorized=1 legacy=140 unapproved=0`), whitespace 검사가 통과했다. 재추출 API의 직접 `products`/`travel_packages` 수정은 제거된 상태이며 낡은 legacy writer 기준표도 현재 코드와 일치시켰다.
- 이 결과는 구조상 안전 처리율이지 정답지 exact-match 정확도가 아니다. 95% 지점에는 현재 공개 판정 대상에서 113구간, 단측 95% Wilson 하한 95%에는 124구간을 오류 없이 더 회수해야 한다. 독립 이중검수 frozen 정답지가 없으므로 고객 전면 오픈은 승인하지 않으며 운영 `publication_freeze=true`를 유지한다.

## 2026-08-15 상품등록 V68 전체 정책 적용·실제 원문 재검증

- 실제 HWP 1,171개·고유 원문 1,047개·여행상품 원문 895개·상품 구간 1,636개를 같은 분할로 재처리했고, 추출 대상은 961/961 성공했다.
- 과거 일정뿐인 709구간은 새 상품으로 만들지 않고 안전 종료했다. 판매가가 실제로 없는 원문 1구간은 private 원문만 남겼다. 활성 927구간 중 verified/degraded 구조상 공개 후보는 760구간(81.98%), 차단은 166구간이다. 과거 제외와 원문 불완전 종료까지 포함한 자동 안전 종결은 1,470/1,636(89.85%)이다.
- 개발군은 535/638(83.86%), calibration은 86/106(81.13%), frozen은 개별 원문을 열지 않은 합계만 139/183(75.96%)이다. 직전 V66과 비교 가능한 구간에서 1개가 회복되고 회귀는 0개다.
- 95% 단순 지점에는 활성 안전 후보가 121구간 더 필요하다. 고객 오픈 기준인 단측 95% Wilson 하한 95%에는 892/927, 즉 현재보다 독립 검수된 안전 구간 132개가 더 필요하다. 독립 2인 검수 frozen 정답지는 아직 완료되지 않아 정확도 95%나 고객 오픈 완료로 선언하지 않으며 `publication_freeze=true`를 유지한다.
- 실제 북큐슈 BX 원문의 영문 월 표기, 전체 요일명, `1일·2일·3일` 일정표, 파일명의 `2박3일`을 하나로 묶었다. 2026-04-08 접수 기준 출발일별 가격 77개와 3일 일정이 재생되며, 호텔 `동급`만 안전 축약한 degraded 후보가 된다. 현재 2026-08-15에는 모든 일정이 지나 새 상품으로 되살리지 않는다.
- 발권기한은 더 이상 상품을 즉시 폐기하는 조건이 아니다. 기한이 지났으면 원문 가격·출발일은 보존하되 `현재 좌석·요금 재확인` 상담 전용으로 표시하고 일반 예약·광고 대상에서 제외한다. 자동 보관은 실제 출발일이 모두 지난 경우에만 한다.
- 미매칭 관광지는 원문 일정 문장으로는 보여주고 관리자 검토 큐에 남긴다. 관광지 상세 카드·설명·사진·링크는 붙이지 않으며 DB에 자동 생성하지 않는다.
- 취소규정이 없으면 승인된 여소남 표준약관 hash를 snapshot에 고정한다. 원문 취소규정이 있으면 원문이 우선하며, 같은 기준일에 위약률이 충돌하면 표준약관으로 덮지 않고 차단한다.
- AI가 가격·날짜 등 고객 사실을 확정하는 workflow 경로는 환경변수와 관계없이 금지했다. AI는 구조 후보만 보조하며, 사실은 원문 근거를 결정론적으로 재생하지 못하면 차단한다.

## 2026-08-15 상품등록 V60 실제 원문 재검증

- 실제 HWP 1,171개·고유 원문 1,047개를 다시 처리했다. 여행상품 원문 895개에서 상품 구간 1,636개가 나왔고, 추출 대상은 961/961 성공했다.
- 현재 판매 가능한 942구간 중 746구간이 verified/degraded 구조상 공개 후보여서 안전 자동공개 후보율은 79.19%다. 과거 일정뿐인 694구간과 판매가가 실제로 없는 원문 1구간까지 포함하면 1,441/1,636(88.08%)이 사람 개입 없이 안전 종결된다. 단순 95% 지점에는 149구간, 고객 오픈용 단측 95% Wilson 하한 95%에는 160구간을 오류 없이 더 회수하고 독립 검수해야 한다.
- 연도 없는 날짜는 한국 업로드일 기준 184일 판매 범위 안에서만 추론한다. 8월 업로드의 9월은 올해, 1월은 내년이 될 수 있지만 이미 지난 5~7월을 다음 해 상품으로 되살리지 않는다. 이번 보정으로 과거 일정 오차 9구간을 정상 종료했고 회귀는 0건이었다.
- 같은 셀에 `날짜 목록 + 기존가 → 최종가`가 있는 실제 다낭·푸꾸옥 원문을 행 단위로 연결했다. 두 상품이 차단에서 verified 후보로 회복됐고 전체 비동결 비교에서 신규 회귀는 0건이었다. 가격과 날짜를 교차 조합하던 예전 결과는 더 이상 사용하지 않는다.
- 3박5일/4박6일은 별도 상품이며, 같은 날짜·같은 일정이어도 호텔이 다르면 별도 상품이다. 보홀 호텔 3종×기간 2종, 울란바토르 기간별 가격, 송백 골프 특수일 가격을 실제 원문 행과 대조했다.
- 이 수치는 정답지 정확도가 아니라 구조상 안전 공개 후보율이다. 독립 2인 검수 frozen 정답지는 아직 0구간이므로 critical exact match는 측정 불가이며 `publication_freeze=true`를 유지한다.
- 이 V60 검증에서 발견했던 canonical 발권기한 누락은 최신 V68에서 수정됐다. 지난 발권기한은 상품을 폐기하지 않고 `기한 경과 · 현재 좌석/요금 재확인` 조건으로 보존한다. 다만 독립 frozen 정답지와 고객 모바일 proof 합격 전까지 전면 고객 오픈을 선언하지 않는 원칙은 유지한다.

## 2026-08-15 상품등록 실제 HWP 고객 흐름 검증
- 2026-08-15 실제 원문 1,171개(고유 1,047개)를 private corpus로 다시 측정했다. 여행상품 원문 895개·상품 구간 1,634개이며, 추출 대상 961개는 961/961 완료했다. 날짜정책 V3 기준 과거 일정뿐인 472구간은 등록 제외로 안전 종결됐고, 활성 1,162구간 중 933구간이 verified/degraded 공개 후보, 1구간이 판매가 없는 원문 폐기 후보, 228구간이 차단됐다. 공개 후보·과거 제외·원문 불완전 폐기를 합친 자동 안전 종결은 1,406/1,634(86.05%)다. 직전 동일 corpus 대비 공개 후보는 25구간 늘고 차단은 24구간 줄었다.
- 개발군은 활성 802구간 중 657(81.92%), calibration은 119구간 중 96(80.67%), frozen은 세부를 열지 않은 aggregate 기준 활성 241구간 중 180구간이 공개 후보다. 판매가 없는 원문은 고객 상품으로 만들지 않고 private 원문만 감사용으로 보존하며 revision·snapshot·고객 URL을 만들지 않는다. 다만 `799 특가`, `499 특가`, `요금표`, 다중상품 공통 가격표처럼 가격이 있을 가능성이 있는 경우는 폐기하지 않고 가격 해석 오류로 차단한다.
- 판매가 부재 판정은 최종 benchmark에서 각 상품 구간의 `sourceSalePricePresent`를 두 검수자가 원문만 보고 독립 판정해야 한다. 이 값이 없는 정답지는 benchmark가 거부하며, 정상 원문을 폐기한 건수는 고객 오픈 기준상 반드시 0이어야 한다. 최신 shadow의 폐기 후보는 31구간에서 1구간으로 줄었고, 빠진 30구간은 정상 후보를 보호하기 위해 차단·개선 또는 안전 공개 대상으로 되돌렸다.
- 랜드사 원문은 사람이 고치지 않는다. 공통 금액 해석기가 판매가 문맥 안의 `899,`, `699,---`, `999,-`를 각각 899,000원, 699,000원, 999,000원으로, `399 특가`를 399,000원으로, `839.000`을 839,000원으로 정규화한다. `839,000 → 599,000`은 기존가 839,000원과 최종 판매가 599,000원을 함께 보존하고 고객 화면에서는 동일 원문 행이 할인 관계를 명시한 경우에만 할인 표기를 노출한다. 외화·유류·현지비·가이드비·옵션·커미션 숫자는 판매가로 승격하지 않는다.
- frozen을 제외한 실제 여행 HWP 731개 가격 형식을 다시 읽은 결과 추출 실패는 0건이었다. 최신 자동 정규화 후 `899,` 계열이 있는 7개 source 중 가격 차단 source는 7개에서 3개로, `399/499/799 특가` 계열은 24개에서 21개로, 가격 제목·금액 분리 셀은 22개에서 20개로 줄었다. 남은 차단은 표기 오타를 사람이 고칠 문제가 아니라 가격-출발일 범위·다중상품 귀속·증거 재생 같은 구조 문제로 분류한다.
- 원본 파일과 원래 파일명은 private Storage와 lineage에 그대로 보존한다. 깨진 문자나 분리형 한글 파일명 자체는 차단 사유가 아니며, 본문·표·원문 hash가 권위 근거다. 라우팅용 파생 이름은 정규화할 수 있지만 원래 이름을 덮어쓰지 않는다. 원문에 커미션이 없으면 상품등록 내부 기본값 9%를 사용하고, 명시된 유효 커미션이 있으면 원문값이 우선한다. 커미션은 고객 판매가 증거로 사용하거나 고객 화면에 노출하지 않는다.
- 연도 없는 월/일은 신규 운영 업로드에서만 접수 당시 한국 날짜를 기준으로 가장 가까운 미래 날짜에 귀속한다. 단, 원문 요일이 현재 연도의 이미 지난 날짜와 정확히 맞으면 그 과거 일정으로 종결하고 다음 해로 넘기지 않는다. 미래 후보와 원문 요일이 다르면 차단한다. 재시도는 원래 기준일·정책버전을 보존하고 명시적 재처리만 새 기준일과 V3 정책을 받는다. archive·legacy backfill에는 이 규칙을 적용하지 않는다.
- 원문에 연도가 직접 적힌 날짜는 항상 우선하며 과거면 제거하고 다음 해로 넘기지 않는다. 모든 출발일이 과거면 revision·snapshot·고객 URL 없이 `ALL_DEPARTURES_PAST`로 안전 종결하고 관리자 화면에는 `과거 일정 — 등록 제외 완료`로 표시한다. 상품 출발연도와 전자담배 금지 같은 법규 시행연도를 문맥으로 분리한다.
- 가격 근거가 일반 제목을 가리키던 문제를 수정해 `399.000원`, `1,159,-` 같은 실제 원문 금액 줄에 연결한다. 선박 제원의 `총 탑승객 5,655명`을 5,655,000원 판매가로 오인하던 사례도 차단했다. 날짜·기간·요일 적용범위가 없는 금액은 이제 구조 단계부터 차단한다.
- 별도 요금표와 일정표를 묶기 위한 mutual-best source bundle resolver, tenant/supplier/cohort 격리 스키마, revision-bundle lineage, 다중 원문 EvidenceIR를 추가했다. 합쳐진 근거도 실제 원문 document/extraction/hash를 유지한다. 다만 이 경로는 supplier profile 및 이중검수 benchmark 전까지 shadow-only다.
- 다중 파일 업로드는 이제 명시적 batch ID·순서·개수를 저장한다. 같은 batch는 원문 결합 후보 검색 범위일 뿐 상품 동일성 증거가 아니며, 최신 개발군 643개 source shadow에서 안전한 자동 결합은 0건이었다. 직전 진단의 가까운 후보 50건 중 49건은 상품명 동일성이 부족해 차단했다.
- 실제 학습 루프는 frozen 개별 사례를 절대 열지 않고 development 오류만 위험도·공급사 lineage·오류 유형별로 다양하게 뽑는다. 최신 cycle은 검토 원문 34개와 독립 AI 교차검증용 silver 후보 12개를 만들었으며, silver는 정답지나 고객 공개 증거로 사용할 수 없다. 정책 승격은 독립 이중검수 frozen 300구간 이상과 두 번 연속 합격 전에는 자동 차단된다.
- 최신 검증은 전체 731개 테스트 파일·5,484개 테스트, TypeScript, authority 계약(`authorized=1 legacy=143 unapproved=0`), 변경 파일 lint와 whitespace 검사를 통과했다. 이번 가격 정규화·9% 기본 커미션·파일명 비차단 변경은 운영 DB migration이나 배포를 수행하지 않았고 `publication_freeze=true`를 유지한다.
- readiness는 frozen 300구간 외에도 실제/수동 붙여넣기 100구간, HWP-붙여넣기 비교 lineage 100개, 핵심사실 parity 100%를 요구한다. 현재 운영의 text source 16개는 전부 legacy backfill이어서 실제 운영 붙여넣기 표본은 0건이다. 신규 붙여넣기와 HWP 추출에는 공통 lineage fingerprint를 기록하지만 생성 fixture는 합격 증거가 아니다. 관련 신규 migration은 아직 운영에 적용하지 않았고 `publication_freeze=true`를 유지한다.
- 한글 전체 날짜 행과 별도 `여행경비` 행이 있는 실제 표, 또는 한 상품 머리말 안의 유일한 전체 날짜와 유일한 `상품가`를 정확한 날짜-판매가 쌍으로 해석하도록 보완했다. 여러 금액이 경쟁하면 첫 금액을 임의 선택하지 않고 차단한다. 실제 황산 원문 4개 구간은 가격 누락/잘못된 다음 해 등록 대신 과거 일정 제외로 자동 종결됐고 활성 안전 상품의 회귀는 0건이었다.
- 남은 최대 차단은 판매가를 canonical 가격으로 확정하지 못한 source 39개, 가격과 출발일 적용 관계 34개, exact 금액 evidence 18개, 포함·불포함 17개, DAY 일정 16개 등이다. 여기서 “판매가 미확정”은 원문 자체에 가격이 없다는 뜻이 아니라 공통 가격표·가격 축약·별도 카드의 범위를 아직 확정하지 못했다는 뜻이다. 과거 디렉터리나 비슷한 제목만으로 결합하지 않고, 동일 upload batch 안에서도 상품 정체성과 범위가 결정적으로 일치할 때만 합친다.
- 같은 HWP 안에서 가격표 카드와 일정표 카드가 분리된 경우에는 상품 정체성·등급·DAY 존재 여부를 보수적으로 비교해 3개의 가짜 상품 구간을 합쳤다. 월별 `날짜 목록 → 가격` 공급사 표, `마감` 날짜 제외, `기존가 → 최종 특가` 선택, `10 월`처럼 날짜와 요일이 붙은 셀을 월로 오인하는 오류도 실제 원문으로 수정했다.
- 실제 원문 대조에서 장가계 3U 문서는 제외일과 특가 우선순위를 정확히 적용했고, 오사카 문서는 가격 카드와 3일 일정을 한 상품으로 복원해 verified가 됐다. 큐슈 문서는 66개 날짜·가격을 정확히 결합했지만 기준일 이전 일정뿐이라 고객 상품 없이 안전 종료됐으며, 시즈오카 문서는 마감일을 빼고 화살표 뒤 최종 판매가를 사용했다.
- `/admin/upload`의 선택형 4자리 `출발연도 보조정보`는 예외용으로 유지한다. 정상적인 연도 없는 신규 일정은 자동으로 가장 가까운 미래에 귀속되므로 반복 관리자 입력이 필요하지 않으며, 보조정보도 원문의 명시 연도를 덮어쓰지 않는다.
- 직전 측정 후 새 HWP 16개·여행상품 구간 24개가 추가됐다. 기존 lineage와 같은 경로의 수정본은 과거 split을 유지하고 완전히 새 lineage만 결정론적으로 배정한다. 공통 비동결 구간 비교에서 연도 전달 개선으로 1개 구간이 추가 복구됐고 회귀는 0건이다.
- 2026-08-13 로컬 통합 브랜치에서 다중상품 문서 끝의 공통 포함·불포함·취소조건을 각 상품 구간에 안전 상속하는 문맥 계층을 추가했다. 동일 제목이 여러 번 나오면 상품별 조건으로 간주해 섞지 않는다.
- 고객 시차 계산은 DB의 절대 UTC 오프셋을 한국 기준 차이로 변환하도록 고쳐 코타키나발루(UTC+8)를 `한국보다 1시간 느림`으로 표시한다.
- 공개 포인터는 정확한 published snapshot·revision·passed proof·renderer build와 한 transaction에서 일치해야 하며, 기존 불일치 포인터는 순방향 migration 적용 시 감사행을 남기고 자동 격리된다.
- 기존 항공정보 574건 중 원문 편명·양쪽 시간·단일 출발일·노선을 모두 검증할 수 있는 것은 58행/24개 날짜별 사실/17편이다. 독립 원문 두 개가 즉시 일치하는 사실은 2개뿐이므로 나머지는 자동 보완 근거로 승격하지 않는다. 신규 원문 명시값은 최우선이며 누락값만 독립 검증 자료로 채운다.
- 기존 고정 40개 HWP 회귀표본은 추출·정규화 40/40, 상품 구간 66개이며 V6 기준 verified 1, 안전 축약 degraded 52, 자동 차단 13이다. 구조상 자동 종결·공개 후보는 53/66(80.30%)이고 critical evidence는 248/248이다.
- 이 역사적 40개 표본의 80.30%는 정답지 대조 정확도가 아니다. 운영 DB에는 `structural_only`, `passed=false`, exact match 미측정으로 기록해 99.5% 정확도 게이트를 우회하지 못하게 했다.
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

> **Clobe 현금정산 실사용 흐름 (2026-08-24, 운영 DB 적용·코드 배포 후보):** OpenLife 신한 4128 계좌는 수동 동기화를 유지하며, `YYMMDD_고객_랜드사[_목적]` 메모가 있는 여행 거래만 예약과 연결한다. 최종정산 전 메모 수정은 같은 provider 거래·예약에 반영하고, 최종정산 후 변경은 자동수정하지 않고 검토로 보낸다. 여러 입금자와 여러 입출금은 메모 key별 한 예약으로 합산하고, 수익은 상품가가 아닌 실제 입금−실제 출금이다. 600,500원 단일 출금 보정, Clobe cash finalize, 복수 예약 payout/refund 원자 배정, 직접 allocation RPC 차단, 명령 테이블 RLS·인덱스 보강은 운영 DB에 적용됐다. PR #1144의 단순화 UI는 정식 코드 배포 후 이 DB command를 사용한다. 상세: `docs/settlement-current-ssot.md`, `docs/audits/2026-08-24-admin-dashboard-deep-ux-review/README.md`.

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
> **과거 V5 공개 검증 기록 (2026-08-10, 현재 비공개):** 당시 샘플 상품 `41441e88-097e-4362-89c7-92be9653ce02`는 package-bound immutable revision과 모바일 수렴 검증을 통과했다. 그러나 현재 기준에서 snapshot renderer가 `local-v5-canary`여서 운영 빌드 proof 계약을 만족하지 않으므로, 2026-08-13 publication pointer invariant 적용 시 pointer version 9의 `blocked` 상태로 자동 격리됐다. 이 기록은 V5 검증 이력일 뿐 현재 고객 공개 가능 판정이 아니다. 다시 공개하려면 현 운영 renderer build에서 새 immutable snapshot과 모바일 proof를 생성하고 CAS pointer gate를 통과해야 한다.
