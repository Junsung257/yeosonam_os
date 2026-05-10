# /register 변경 이력 (P0~P1 정책 + 결정 이력)

> **목적**: `/register` 슬래시 커맨드의 누적된 정책 변경·결정 사항을 본문에서 분리. 본문(.claude/commands/register.md)은 절차 위주로 가볍게 유지하고, 시간 의존적인 변경 로그는 여기에 누적.
>
> **읽는 시점**: `/register` 실행 중 본문에서 "최근 정책 → docs/register-changelog.md" 라고 가리킨 항목을 확인할 때, 또는 사장님이 새 정책 결정 시 append.

---

## P0~P1 변경사항 (2026-04-27) — 반드시 준수

1. **`special_notes` 컬럼은 신규 등록에서 사용 금지.** 대신:
   - `customer_notes` — 고객 노출 OK 자유 텍스트 (모바일·A4 fallback 출처). W21 키워드 검증 적용.
   - `internal_notes` — 운영 전용 메모 (랜드사 협의사항·내부 알림). 고객 노출 차단.

2. **audit_status 는 4단계** (`blocked` / `warnings` / `info` / `clean`):
   - `clean` — 즉시 자동 승인.
   - `info` — W12 같은 안내성 경고만 존재. **자동 승인 OK** (기존 warnings 처럼 force 불필요).
   - `warnings` — 환각·축약 의심. `--force` 필요.
   - `blocked` — errors 존재. 수정 후 재감사.

3. **추가요금 통화 표기** — CRC `priceLabel` 이 KRW 는 `30,000원` / USD 는 `$30` / JPY 는 `¥3000` / CNY 는 `30元` 으로 자동 포맷. surcharges 객체 배열의 `currency` 필드만 정확히 채우면 됨.

4. **정액 마진 (commission_fixed_amount + commission_currency)** — 사장님이 입력에 "9만원" 같은 정액 표기 시:
   ```js
   const inserter = createInserter({
     landOperator: '랜드부산',
     commissionFixedAmount: 90000,   // 정액 KRW
     commissionCurrency: 'KRW',
     ticketingDeadline: '2026-04-29',
     destCode: 'TAO',
   });
   ```
   - 정액 모드 활성화 시 `commission_rate=0` 자동 설정 (상호배타)
   - `internal_notes` 에 정액 메모 중복 기재 불필요 (컬럼에 명시됨)
   - `dump_package_result.js` 에서 "commission: 90,000원/건 정액" 으로 자동 표기

5. **`product_highlights` 임팩트 순 정렬 (★ 2026-04-29 추가)** — 모바일 RecommendationCard / hero_tagline 합성이 첫 항목을 우선 사용하므로 임팩트 큰 셀링포인트가 [0]에 와야 함:
   - **우선순위 룰**: 직항 전세기 > 노쇼핑/노옵션 > 5성급 호텔 > 특정 호텔/관광지명 > 마사지/특식 > 기타
   - 노이즈 제거: "노팁/노옵션/노쇼핑" 자체를 highlights에 단순 나열 X (이미 product_type에 있음). 대신 "기사·가이드팁 전부 포함" 같이 **혜택 형태**로 작성
   - 길이: 칩 노출 시 ≤14자 권장. 길면 괄호 부속절로 보조 (예: "5성급 호텔 (달라터치 진이·우란대주점)")
   - 항목 수: 3~5개 (너무 많으면 임팩트 분산. 너무 적으면 hero_tagline + 칩 풀 부족)
   - LLM 추출 시 위 우선순위 prompt에 명시 → AI가 자동 정렬

6. **점수 시스템 v3 자동 영향 (★ 2026-04-30 추가)** — `/register` 후 `package_scores`가 출발일별로 자동 박힘:
   - **출발일 차원**: 한 패키지의 N개 price_dates 각각 score row 생성 (호화호특 7-8월 8개 출발일 → 8 row)
   - **그룹 키**: `{destination}|{YYYY-MM-DD}` — 정확 같은 날 출발 패키지끼리 비교
   - **자동 trigger**: approve route가 `recomputeGroupForPackage()` hook 호출 → ISR revalidate
   - **features 자동 추출**: itinerary_data 에서 hotel_avg_grade·shopping_count·meal_count·korean_meal_count·special_meal_count·free_time_ratio·flight_time·hotel_location 자동 산출
     → itinerary 일정에 한식 메뉴(불고기·삼겹살·비빔밥) 명시되면 효도 정책에서 점수 ↑
     → schedule activity 에 "자유시간" 명시되면 커플 정책에서 점수 ↑
     → hotel.note 에 "리조트"/"풀빌라" 명시되면 커플 정책에서 가산
     → meta.flight_out_time HH:MM 명시되면 항공 시간대 자동 분류
   - **검증**: 등록 직후 `/admin/scoring/funnel` 확인 → 같은 destination 같은 출발일 그룹에서 순위 확인
   - **작성 팁**: itinerary_data 작성 시 `hotel.note: "리조트형 풀빌라"` / `meals.dinner_note: "한식 (삼겹살 무제한)"` 같이 점수 추출이 가능하게 자연어 명시

---

## 결정 이력

- **2026-04-27 — 출확인원 모순 시 본문 우선**: 원문 헤더 RMK 와 상품 본문이 충돌할 때 **상품 본문 기준으로 등록**. 헤더 RMK 는 카테고리 통합 표기로 부정확할 수 있고, 본문이 상품별 구체 조건이라 신뢰도 높음. (사장님 결정 / 케이스: 투어비 하노이 5종 — RMK "사파/크루즈 8명" vs 본문 사파·디너크루즈 "6명" → 본문 그대로 유지)

- **2026-04-27 — 유류할증료(N월) 표기 = 발권기한 조건부 포함**: 원문에 "유류할증료(4월)" + "4/29 발권조건" 처럼 월/날짜가 붙어 있으면 **발권기한 전 발권 시 가격 유효**, 발권기한 이후 출발은 유류세 인상분/인하분이 별도 반영된다는 의미. 표준 처리: ① `inclusions` 에 `"왕복항공+TAX+유류할증료(YYYY-MM-DD 발권 기준)"` 명시 ② `excludes` 에 `"유류세 인상분"` 추가 ③ `ticketing_deadline` 정확히 기재. 사장님 결정 / 케이스: W투어 나트랑 카탈로그 — "(4월)" 의 의미가 "4월 출발만 포함" 이 아니라 "4/29 발권 마감 기준" 임을 명확히 함.

- **2026-04-27 — 신규 랜드사는 사장님 입력대로 즉시 추가**: 사장님이 `"<랜드사> N%"` 형태로 입력했고 `db/land-operators.json` / `land_operators` 테이블에 없으면 **그 이름 그대로 신규 INSERT**. 단 (a) 사장님 명시 Y 후만 (b) 커미션은 입력값 그대로 (랜드사·상품별 다름) (c) 코드(2-letter) 자동 생성 (d) 이름 중복(W투어/더블유투어 등)은 **향후 사장님이 일괄 정리** — 랜드사는 하나로 매칭되어야 함. 사장님 결정 / 케이스: W투어 — 자동 INSERT 금지 룰 (Step 1.5-C) 은 유지하되, "사장님이 명시 입력했으면 그대로 추가" 가 디폴트 동작.

- **2026-04-27 — 호텔 등급 표기 정형화 (4 단일 표기)**: "특급"·"+5성"·"5성급"·"정5성" 같은 변형은 모두 오해 소지. 표준 표기 4종으로 단일화: **`"4성"` / `"준4성"` / `"5성"` / `"준5성"`** (3성/준3성도 표준에 포함, 총 6종). 원문 "(5성특급)" → `"5성"`, "4.5성" → `"준5성"` 로 정형화.

- **2026-04-27 — 호텔 등급 vs 룸타입 vs 호텔종류 컬럼 분리 (ERR-hotel-grade-roomtype-mixed)**: `hotel.grade` 에 **등급만** 저장. 룸타입(디럭스룸·슈페리어룸)·호텔종류(리조트·게르·크루즈)·숙박정보(2인1실·3박)·호텔명(Vansana LPQ)이 grade 에 섞여 있으면 안 됨. 분리 필드: ① `hotel.grade` (3성·준3성·4성·준4성·5성·준5성·null) ② `hotel.room_type` (디럭스룸 등 — 신규 필드, 임시 note) ③ `hotel.facility_type` (resort·ger·cruise·cabin — 신규 필드). 비표준 숙박(게르·크루즈)은 `grade=null` + `facility_type`. 사장님 지적 / DB 분포 조사 결과: 710건 중 81건(11%)이 룸타입·호텔종류·호텔명이 grade 에 잘못 저장됨 — 신규 등록부터 분리 적용, 기존 81건은 백필 백로그 (`db/backfill_hotel_grade_split.js`).

- **2026-04-27 — 매너팁/가이드/기사/여행자보험 불포함은 원문 verbatim**: 자유일정·에어텔 상품에서 다음 항목들은 원문 표기를 그대로 보존 (모순 아님): ① **매너 팁 불포함** = 고객 혼동 방지용 표기 (가이드 없어도 명시) ② **가이드 불포함** + **차량/기사 불포함** = 자유일정에서 따라다니는 인력이 없다는 의미 (리조트 셔틀 픽업과 별개) ③ **여행자보험 불포함** = 에어텔 상품 특성상 빠짐. Agent 가 "가이드 없는데 매너팁이 왜?" 같은 모순 의심하지 말 것 — 원문 그대로. 사장님 결정 / 케이스: W투어 나트랑 셀렉텀 노아 에어텔.

- **2026-04-27 — 새벽 출국 항공편은 정상 패턴**: 제5일 표기에 03:10 같은 새벽 출발 시간이 등장하면 **호텔 오전 체크아웃(전일) → 새벽 비행기 출국** 패턴. 일반적인 동남아 야간발 항공편 운항 — Agent 가 "제4일 자정 직후 아닌가?" 모순 의심하지 말 것. 일정표 표기는 **제5일 03:10 출발** 그대로 유지. 사장님 결정.

---

> **신규 결정 추가 시**: 위 형식 (`- **YYYY-MM-DD — 한 줄 제목**: 본문 + 사장님 결정 / 케이스`) 으로 append. 본문(register.md)에 직접 적지 말 것.
