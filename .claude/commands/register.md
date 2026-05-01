# 통합 상품 등록

> **[자동 설정]** 이 커맨드는 파싱 정확도와 데이터 무결성을 위해 **Sonnet 4.6**으로 자동 처리됩니다.
> 사용자는 모델을 선택할 필요가 없습니다. `/register` 호출 → 자동 Sonnet 사용.

사용자가 입력한 원문과 랜드사/마진 정보입니다:

$ARGUMENTS

---

## 🆕 P0~P1 변경사항 (2026-04-27) — 반드시 준수

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

## 🔴 Rule Zero: 원문 원본 불변 보존 (ERR-FUK-rawtext-pollution@2026-04-19)

**`raw_text` 필드에는 사용자가 붙여넣은 원문을 글자 하나 변형 없이 저장.**
- ❌ **금지**: 요약, 축약, 정규화, 오타 교정, 줄바꿈 정리, 섹션 재배치, 괄호 통일
- ✅ **허용**: BOM 제거, UTF-8 인코딩 정규화만
- 파서 요약본은 `parsed_data.summary` 또는 `product_summary`에 별도 저장
- `raw_text_hash = sha256(raw_text)`를 반드시 같이 저장 → 사후 변조 탐지

**왜 중요한가**: raw_text는 감사(E1~E4)의 기준점입니다. 요약본을 저장하면 "여행자보험 → 2억 여행자보험" 같은 주입이 raw_text와 inclusions 양쪽에 동시 존재하게 되어 **감사가 영구적으로 통과**해버립니다. 오늘 LB-FUK-03-01/02에서 실제로 발생했습니다.

**인서트 전 체크**:
```js
const crypto = require('crypto');
const raw_text = USER_INPUT_VERBATIM;   // 절대 가공 금지
const raw_text_hash = crypto.createHash('sha256').update(raw_text).digest('hex');
```

---

## 🚨 Step 0: 필수 사전 참조 (파싱 시작 전)

파싱 시작 전 반드시 다음 **3개 파일**을 Read:

1. `db/error-registry.md` — 누적된 오류 이력 (최근 10건 체크리스트)
2. `.claude/commands/manage-attractions.md` — **관광지 처리 가이드 (MUST READ)**
3. `CLAUDE.md` 섹션 0 — Zero-Hallucination Policy

## 🚫 관광지 자동 시드 금지 (ERR-20260418-33)

**이미 완전한 관광지 관리 파이프라인이 존재합니다.** 새로 만들지 마세요.

- ❌ `db/seed_XXX_attractions.js` 같은 임시 시드 스크립트 생성 금지
- ❌ Agent가 AI로 short_desc/long_desc 생성해서 DB INSERT 금지
- ❌ 상품 등록 중 관광지 자동 생성 금지
- ✅ 매칭 실패한 관광지는 **자동으로 `unmatched_activities`에 플래그만 찍고 종료**
- ✅ 사용자가 `/admin/attractions/unmatched` 페이지에서 수동 처리 (CSV 다운로드 → 외부 편집 → CSV 업로드)

**이 단계를 생략하지 마십시오.** 과거에 발견되어 해결한 오류가 다시 나오면 시스템 신뢰도가 무너집니다.

---

## 🚨 Zero-Hallucination Policy (AI 파싱 절대 준수 규칙)

### 1. 숫자는 1:1 매핑 (템플릿 기본값 금지)

- "최소 성인 **10명** 이상" → `min_participants: 10` (절대 4 아님)
- 원문에 인원이 **명시되지 않으면** `null` (템플릿 기본값 4 쓰지 말 것)
- 가격/시간/일수도 동일: 원문 그대로 1:1

**이유**: ERR-20260418-01 (타이베이 10명 → 4명 조작)

### 2. 예시 목록은 축약 금지

- 원문: "(라면스프, 소세지/햄, 육포, 소고기고추장볶음(튜브형 포함), 육류가 들어간 면 종류, 베이컨 등)"
- ✅ 올바른 파싱: `notices_parsed[0].text`에 괄호 전체 그대로 보존
- ❌ 금지: "위반 시 벌금"으로 한 단어 요약 / "등"으로 예시 대체

**이유**: ERR-20260418-02 (대만 라면스프 하나에 수백만 원 벌금 리스크 직결)

### 3. 의심스러우면 원문 문자열 보존 (Quote > Summary)

- 요약하지 말고 원문 그대로 quote
- `raw_text` 필드에 항상 원문 전체 보존 (Rule Zero 참고 — sha256 해시 동반 저장)

### 3-1. 보험/특전 금액 주입 절대 금지 (ERR-FUK-insurance-injection@2026-04-19)

- 원문에 **"2억"/"1억"/"여행자보험 N만원"** 같은 금액 표기가 **없으면** `inclusions`에 금액 삽입 금지
- ✅ 올바름: 원문이 `"여행자보험"` → DB도 `"여행자보험"`
- ❌ 금지: 원문이 `"여행자보험"` → DB에 `"2억 여행자보험"` (일반 패키지 관행을 무의식 차용)
- 동일 규칙이 **호텔 등급(4성급 등), 라운딩 홀 수(54H), 식사 횟수**에도 적용

**자동 탐지**: `post_register_audit.js`의 Rule E1이 금액 토큰 존재 여부를 raw_text와 대조.

### 3-2. `itinerary_data.days[].regions`는 원문 "지역/일자" 컬럼 1:1 매핑 (ERR-FUK-regions-copy@2026-04-19)

- 여러 상품(정통/품격 등)을 한 원문에서 파생할 때 **Day별 regions 배열을 복사해 쓰면 안 됨**
- 각 상품의 원문 "지역" 칸에 적힌 이동 경로 그대로 저장
  - 예: 품격 Day2 = `"사세보 → 나가사키 → 사세보"` → `["사세보","나가사키","사세보"]`
  - 정통 Day2 = `"사세보"` → `["사세보"]`
- 모든 Day에서 regions가 완전히 같은 경우 `post_register_audit` Rule E2가 경고 발생

### 3-3. `excluded_dates` ∩ `surcharges` 날짜 교집합 금지 (ERR-FUK-date-overlap@2026-04-19)

- **출발 불가능한 날짜에 추가요금을 받는다는 건 모순**
- 원문에 "항공제외일 3/18~20"과 "일본공휴일 추가요금 3/18~20"이 동시에 있으면:
  - `excluded_dates`에만 넣고 `surcharges`에서는 제외
  - 또는 반대. 둘 다 넣지 말 것
- 자동 탐지: Rule E3

### 3-4. 🆕 원문 verbatim + attractions aliases 매칭 (ERR-BHO-ssot-overcorrect@2026-04-27)

**최종 원칙** (사장님 결정 2026-04-27):
- `schedule.activity` 와 `optional_tours[].note` = **원문 verbatim** (랜드사 표기 그대로 보존)
- `attractions` 테이블 = **활동 카탈로그** (관광지+체험+마사지+투어 모두 포함, name + 풍부한 aliases)
- 매칭은 `attractions.aliases` 가 흡수 — 한 활동의 다양한 랜드사 표기를 단일 카드에 매핑
- `product_summary` (마케팅 카피) = SSOT 정상 표기 사용 (verbatim 강요 안 함)

**왜 이게 정답인가**:
1. **원문 충실**: 랜드사가 "전신마사지"라 쓰면 일정에 "전신마사지" 그대로 (verbatim 보존, 환각 0)
2. **DB SSOT**: attractions 가 SSOT — 같은 활동의 다양한 표기를 aliases 로 흡수
3. **Compound improvement**: 등록 누적될수록 aliases 풍부해져 다음 랜드사 등록 자동 매칭률↑
4. 랜드사마다 표기 다름이 정상 — A: "전통오일마사지" / B: "전신마사지" / C: "오일마사지". 모두 같은 활동.

**attractions 테이블 활용 범위 (확장)**:
관광지(sightseeing) · 체험(activity) · 투어(tour) · 웰니스(wellness) · 식사(meal) · 자연(nature) · 호텔(hotel) · 시장(market)

**랜드사 표기 다양성 흡수 예시** (보홀 - 마사지):
```
attractions row:
   name    : "전통오일마사지"
   aliases : ["전신마사지","오일마사지","전통마사지","마사지","Traditional Oil Massage","Whole Body Oil Massage"]

A 랜드사 원문: "전통오일마사지 1시간"  → schedule verbatim, attractions 매칭 ✅
B 랜드사 원문: "전신마사지 1시간"      → schedule verbatim, attractions alias 매칭 ✅
C 랜드사 원문: "오일마사지 60분"       → schedule verbatim, attractions alias 매칭 ✅
→ 세 패키지 모두 같은 attraction 카드 (사진/설명) 노출
```

**처리 결정 트리**:
```
원문에서 활동/관광지 발견
   │
   ├─ schedule / opt_tours.note = 원문 verbatim 으로 저장 (랜드사 표기 보존)
   │
   ├─ attractions 매칭 시도 (name + aliases · ILIKE / equality / contains)
   │     ├─ ✅ 매칭 → DB attraction 카드 렌더링 (사진·설명·뱃지)
   │     └─ ❌ 미매칭 → 신규 등록 또는 기존 attraction 의 aliases 에 추가
   │                   (`/admin/attractions` 또는 `/admin/attractions/unmatched`)
   │
   └─ 누적 → aliases 풍부해질수록 매칭률↑ (compound improvement)
```

**금지 사항**:
- ❌ AI 상식 기반 무근거 표기 변환 ("타리스어 → 타르시어", "초콜렛 → 초콜릿" 자동 변환)
- ❌ DB SSOT 표기로 schedule 강제 변경 (원문이 "타리스어원숭이"면 그대로 둘 것)
- ❌ 매칭 실패 시 활동 무시 — 반드시 사장님 검토 큐로 또는 신규 등록 추천

**self-check** (Step 6 보강):
- [ ] schedule activity 가 원문과 일치하는가? (랜드사 표기 보존)
- [ ] 활동/관광지가 attractions 테이블에 있는가? 없으면 등록 추천 또는 미매칭 보고
- [ ] aliases 풍부한가? 자주 등장하는 표기 변종 모두 흡수했는가?
- [ ] product_summary 는 SSOT 정상 표기 사용 (마케팅 카피, verbatim 강요 안 함)

**비교 — 같은 항목 3가지 처리 방식**:

| 시나리오 | schedule activity | 평가 |
|---|---|---|
| AI 자동 정상화 | `▶보홀 데이투어 (타르시어원숭이·초콜릿힐·…)` | ⚠️ 환각 (AI 추측) |
| DB SSOT 강제 | `▶보홀 데이투어 (안경원숭이·초콜릿힐·…)` | ⚠️ 원문 표기 손실, 랜드사별 차이 묻힘 |
| ✅ **원문 verbatim + aliases 매칭** | `▶보홀 데이투어 (타리스어원숭이.초콜렛힐.멘메이드포레스트)` | ✅ 원문 충실 + attractions 카드 매칭 OK |

**보홀 attractions 일괄 보강 (2026-04-27)**:
- "안경원숭이" — aliases: ["타르시어원숭이","타리스어원숭이","Tarsier","Bohol Tarsier",...]
- "초콜릿힐" — aliases: ["초콜렛힐","Chocolate Hills","초콜릿 힐스",...]
- "전통오일마사지" — aliases: ["전신마사지","오일마사지","전통마사지","Traditional Oil Massage",...]
- "보홀 아일랜드 호핑투어" — aliases: ["보홀호핑투어","호핑투어","아일랜드호핑",...]
- "맨메이드 포레스트" — aliases: ["멘메이드포레스트","빌라르 마호가니 숲","Bilar Manmade Forest",...]
- "보홀 팡라오성당" — aliases: ["성어거스틴성당","Saint Augustine Church Panglao",...]
- 등 보홀 활동 카탈로그 17건 (관광지 5 + 신규 활동 12)

### 3-5. 🆕 LLM 호출 인프라 정책 (P0 — 2026-04-27)

**모든 신규 Anthropic Claude 호출은 다음 3원칙 준수**:

#### A. Prompt Caching 분리 (불변/가변)
- 시스템 프롬프트 + tool schema = `cache_control: { type: 'ephemeral' }` 적용
- 가변(원문·사용자 입력)은 `messages.user` 끝에 배치
- 5분 TTL 동안 cache hit 시 ~87.5% 비용 절감 (cache_read 0.10x)
- 검증 사례: ProjectDiscovery 59% / YUV.AI 70% 절감
- **금지**: 시스템 프롬프트 안에 "오늘 날짜" 같은 가변 변수 → 캐시가 박살남

```ts
// ✅ 올바른 예
const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
  tools: [{ ..., cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: dynamicInput }],
});
```

#### B. tool_use 로 schema 강제 (free-form JSON 파싱 금지)
- `tools[].input_schema` 로 JSON Schema 강제 + `tool_choice: { type: 'tool', name: ... }`
- 파싱 에러 0%, retry 코드 거의 사라짐 (Anthropic 권장)
- 또는 `anthropic-beta: structured-outputs-2025-11-13` 헤더 + `response_format` (동등 효과)
- **금지**: `JSON.parse(response.content[0].text)` 같은 free-form parse + 정규식 코드블록 제거

#### C. 모델 선택 가이드 (Cursor "Apply 모델" 패턴)

| 작업 | 모델 | 비용 비고 |
|---|---|---|
| 정규화 sketch / 환각 위험 큰 추출 | **claude-sonnet-4-6** | 1.0x baseline |
| 단순 메타데이터 추출 / 카피 / 분류 | **claude-haiku-4-5-20251001** | ~3x 저렴 |
| 깊은 reasoning / 멀티모달 | claude-opus-4-7 | 5x 비싸 — 드물게만 |
| CoVe 감사 / claim 검증 | gemini-2.5-flash | 가장 저렴 — 이미 적용 |

**원칙**: 작업 복잡도와 비용을 매핑. "전부 Sonnet" 또는 "전부 Opus" 안티패턴.

#### 적용 사례 (2026-04-27 1차 보강)
- `src/lib/normalize-with-llm.ts` — Sonnet 4.6, system+tools cache, cache hit 로깅
- `src/lib/ai.ts` `generateWithClaude` / `generateAdVariants` — Haiku 4.5, tool_use, system+tools cache
- `src/app/api/products/scan/route.ts` — Haiku 4.5 (Opus 4.6 → 다운그레이드), tool_use, system+tools cache

#### 적용 효과 (예상)
- 등록 사이클 6 패키지 연속 처리 시 cache hit ~85% → LLM 비용 ~85% 절감
- free-form JSON 파싱 에러 사라짐 → retry 루프 단순화
- Haiku 4.5 다운그레이드로 단순 호출 추가 ~3x 절감
- **종합 예상**: 월 LLM 비용 ~70% 절감 + 환각 30~40% 감소

### 3-6. 🆕 EPR few-shot retrieval (P1 — 2026-04-27)

**Rubin et al. NAACL 2022 (arXiv 2112.08633)** 학술 검증된 자가학습 패턴 도입.

#### 작동 방식
```
신규 raw_text
   ↓ Gemini gemini-embedding-001 (1536d, RETRIEVAL_QUERY)
query embedding
   ↓ search_travel_packages_semantic RPC (HNSW cosine, min_similarity 0.55)
유사 등록 top-K (4건)
   ↓ buildFewShotPromptFragment()
prompt fragment (메타 한 줄 + 원문 1500자/건)
   ↓ normalize-with-llm.ts 의 user message prefix 로 주입
Claude Sonnet 4.6 (system+tools cache 유지)
   ↓ tool_use 정규화
NormalizedIntake (정확도 ↑)
```

#### 진짜 Compound Improvement
- **등록할수록 demo 풀 풍부해짐**: Step 7-E 가 신규 패키지 raw_text 를 즉시 임베딩 (다음 등록부터 demo 후보)
- 사장님이 정정한 케이스가 다음 추출의 무료 prompt 학습 자료로 작용
- 6개월 누적 시 동일 랜드사·지역 추출 일관성 ↑↑, 정정 빈도 60~70% 감소 (학술 측정 기준)

#### 안전 장치
- **demo 메타 그대로 복사 금지** prompt 명시 — "사실 추출은 반드시 이번 원문에만 근거"
- min_similarity 0.55 미만은 demo 사용 안 함 (오염 방지)
- retrieval 실패 시 폴백 — few-shot 없이 진행 (프로세스 막지 않음)
- excludePackageIds 옵션 — 자기 자신·archived·실패 케이스 제외

#### 비용·성능
- 신규 query embedding: ~$0.0001/건 (Gemini)
- HNSW 검색: ~5~20ms (인덱스 적용됨)
- prompt 토큰 추가: 4 demo × 2000 토큰 ≈ 8000 토큰
- system+tools cache 와 결합: demo 는 가변이므로 cache prefix 깨지 않음 (system+tools 만 cache)

#### 모듈 위치
- `src/lib/few-shot-retriever.ts` — `retrieveSimilarExamples()` + `buildFewShotPromptFragment()`
- `src/lib/normalize-with-llm.ts` — fewShotEnabled (기본 true) 로 자동 통합
- `db/templates/insert-template.js` Step 7-E — 등록 직후 raw_text 임베딩 자동 생성

#### 우회
- `fewShotEnabled: false` — 특정 호출만 비활성
- `SKIP_EPR_EMBEDDING=1` — 임베딩 자동 생성 스킵 (cron 이 백필)

### 3-7. 🆕 Reflexion 정정 메모리 (P1 — 2026-04-27)

**Shinn et al. NeurIPS 2023 (arXiv 2303.11366)** — episodic memory 누적으로 같은 실수 반복 차단.

EPR 과 보완 관계:
- **EPR** (Section 3-6) = 성공 사례 (raw_text + 메타 demo) → "이렇게 정상화하라"
- **Reflexion** (Section 3-7) = 정정 교훈 (don't do X, prefer Y) → "이런 함정 피하라"
- 두 layer 결합 → LLM 이 양면 학습 → 정정 빈도 60~70% 감소 (학술 측정)

#### 작동 흐름
```
사장님이 등록된 패키지 정정
   ↓ POST /api/extractions/corrections { field_path, before, after, reflection, severity }
extractions_corrections 테이블 누적
   ↓ 동일 랜드사 다음 등록 시
getRelevantReflections() — land_operator+destination 매칭 → severity+recency 점수 정렬
   ↓ buildReflectionPromptFragment()
"## 과거 정정 사례 (반드시 회피해야 할 패턴)" 섹션
   ↓ normalize-with-llm 의 user message 최상단 (Reflexion → EPR → 원문 순서)
Claude Sonnet 4.6 (system+tools cache 유지)
   ↓ 동일 실수 차단된 NormalizedIntake
trackReflectionApplied() — applied_count 증가 (효과 측정)
```

#### 정정 기록 API
```bash
POST /api/extractions/corrections
{
  "package_id": "<uuid>",                     # 자동으로 land_operator+destination 보강
  "field_path": "itinerary_data.days[1].schedule[2].activity",
  "before_value": "▶전통오일마사지 1시간",
  "after_value":  "▶전신마사지 1시간",
  "reflection": "원문 일정 verbatim 우선 — 포함사항(전통오일마사지)과 일정(전신마사지) 표기 다를 때 일정 표기 보존",
  "severity": "high",
  "category": "verbatim-violation"
}
```

#### 우선순위 정렬
1. 동일 랜드사 + 동일 지역 (가장 강한 신호)
2. 동일 지역 (다른 랜드사)
3. 동일 랜드사 (다른 지역)
4. 글로벌 critical/high (모든 등록에 적용)

#### 효과 측정
- `applied_count` — 각 reflection 이 prompt 에 주입된 누적 횟수
- 정정 주제별 추세 — `category` 컬럼 (hallucination / overcorrect / verbatim-violation / schema-mismatch / missing)
- 6개월 후 재정정 빈도 추적 → 학습 효과 정량 검증

#### 모듈 위치
- `src/app/api/extractions/corrections/route.ts` — POST/GET/PATCH
- `src/lib/reflection-memory.ts` — `getRelevantReflections()` + `buildReflectionPromptFragment()`
- `src/lib/normalize-with-llm.ts` — reflectionEnabled (기본 true) 자동 통합
- `extractions_corrections` 테이블 + `increment_correction_applied` RPC

#### 우회
- `reflectionEnabled: false` — 특정 호출만 비활성
- `is_active=false` UPDATE — 잘못된 reflection 비활성화 (PATCH)

### 3-12. 🆕 Per-field confidence (Step 2 / P3-#1 — 2026-04-27)

Pre-INSERT cross-validate gate 가 의심 필드별 confidence 점수를 산출 → `travel_packages.field_confidences` jsonb 에 영구 저장.

#### 저장 형식
```jsonc
{
  "overall_confidence": 0.82,
  "fields": {
    "inclusions[2]":     { "score": 0.4, "severity": "high",     "reason": "원문에 '2억' 표기 없음" },
    "min_participants":  { "score": 0.3, "severity": "critical", "reason": "원문 명시 없음, 템플릿 기본값 의심" }
  },
  "recommendation": "review",
  "reasoning": "...",
  "validated_at": "2026-04-27T...",
  "validator": "gemini-2.5-flash"
}
```

#### 활용
- 어드민 패키지 페이지에서 `score < 0.7` 필드 빨간색 highlight (별도 세션에서 UI 통합)
- 사장님 review 시간 대폭 단축 (낮은 confidence만 우선 검토)
- ISR 빌드 게이트로 활용 가능 (`overall_confidence < 0.7` → 자동 재검토 큐)

#### 비용
- 추가 호출 없음 (Pre-INSERT gate 가 이미 호출 — 결과 활용만)
- DB 추가 저장: jsonb 1KB 미만/건

### 3-9. 🆕 Wikidata POI ground truth (P2-#5 — 2026-04-27)

**왜 Wikidata?**
- **CC 라이선스 → DB 영구 저장 OK** (Google Places 는 30일 캐싱 한도 — ToS 위반 위험)
- 다국어 라벨 (ko/en/ja/zh) + GPS + 사진 + 카테고리 무료
- QID 가 절대 안정적 ID

**적용 대상**:
- attractions 마스터 보강 → `wikidata_qid` 컬럼 (이번 마이그레이션 추가)
- 향후 unmatched suggest 에 Wikidata 후보 통합 (별도 세션)

**모듈**: `src/lib/wikidata-poi.ts`
- `searchWikidata(query)` — 자유 텍스트 검색
- `getWikidataPoi(qid)` — 다국어 라벨/GPS/이미지/카테고리 상세
- `searchPoisInRegion(regionQid)` — 지역+카테고리 SPARQL 검색
- `poiToAttractionPayload()` — attractions INSERT 페이로드 변환

**Google Places API 도입 보류 사유** (사장님 확인 후 별도 결정):
- ToS 7.b: place_id 외 데이터 30일 캐싱 한도
- 우리 attractions 영구 저장 + aliases 누적 구조 → 위반 위험
- 어드민 검색 도구로만 한정 시 사용 가능 (place_id 만 저장)

### 3-10. 🆕 unmatched_activities 등록 직후 자동 적재 (P2-#6 — 2026-04-27)

**기존**: 랜딩 페이지 로드 시 사용자 브라우저에서 적재 (지연 + 사용자 의존).
**개선**: `insert-template.js` Step 7-F — 등록 직후 서버사이드 자동 매칭/적재.

#### 흐름
```
INSERT 직후
   ↓ Step 7-F
모든 등록 패키지의 ▶ activity 수집
   ↓
attractions 매칭 (region/country 필터 + name+aliases ILIKE)
   ↓
미매칭 항목만 unmatched_activities upsert (occurrence_count 누적)
   ↓
사장님 즉시 /admin/attractions/unmatched 에서 1클릭 alias 적립 가능
```

**우회**: `SKIP_UNMATCHED_INGEST=1`

### 3-11. 🆕 LLM Gateway 추상화 lib (P2-#7 — 2026-04-27)

**모듈**: `src/lib/llm-gateway.ts` — 단순 호출 (마케팅 카피·메타 추출·judge 등) 통합 진입점.

#### 라우팅 (Cursor "Apply 모델" 패턴)
| Task | Primary | Fallback |
|---|---|---|
| extract-meta | claude-haiku-4-5 | gemini-2.5-flash |
| card-news | gemini-2.5-flash | claude-haiku-4-5 |
| summary | gemini-2.5-flash | claude-haiku-4-5 |
| classify | gemini-2.5-flash | claude-haiku-4-5 |
| judge | gemini-2.5-flash | (없음 — 단일 호출 의미) |

**기능**:
- 자동 fallback (primary 실패 → fallback 시도)
- Prompt Caching (Claude system+tools)
- structured output (Claude tool_use / Gemini responseSchema)
- elapsed_ms 측정 (모니터링)

**향후 사용**:
- `ai.ts` 호출처 점진 마이그레이션 (별도 세션)
- 신규 LLM 호출은 모두 이 Gateway 통과 권장

**복잡한 흐름은 자체 fallback 보유 (예: normalize-with-llm.ts)** — Gateway 도입 안 함.

### 3-8. 🆕 다중 모델 교차검증 + AI Gateway fallback (P2-#4 — 2026-04-27)

**철학**: Gemini Flash 1회 호출 ($0.0003) << 잘못 노출된 상품 1건의 사고 비용. 비용 무시하고 안전망 두껍게.

#### A. AI Gateway fallback (`normalize-with-llm.ts`)
- Claude Sonnet 정규화 실패 → Gemini 2.5 Flash 자동 폴백
- API 다운/요금초과 시 영업 중단 방지
- 우회: `engine: 'gemini'` 직접 지정

#### B. Pre-INSERT 교차검증 게이트 (`insert-template.js`)
- INSERT 직전 Gemini Flash 가 Sonnet 결과를 비판 검토
- `recommendation`: pass / review / reject
- `reject` 또는 CRITICAL 1건+ 또는 confidence < 0.5 → **INSERT 차단**
- `review` 또는 confidence < 0.7 → INSERT 진행 + audit_status=warnings 강등
- 비용: ~$0.0003/건. 사고 방지 ROI 100x+
- 우회: `SKIP_PRE_INSERT_GATE=1`

#### C. 학술 근거
- SelfCheckGPT (Manakul EMNLP 2023, arXiv 2303.08896) — 다중 응답 일관성
- LLM-as-Judge survey (Gu 2024, arXiv 2411.15594) — 교차검증 패턴

#### D. 한계 (correlated failure)
두 모델이 같은 환각 만들 수도 있음. 100% 안전 ≠ 사실. 단일 모델보다는 두꺼운 안전망.

#### E. Anthropic Structured Outputs Beta 검토 (보류)
- 우리 tool_use input_schema 가 이미 동등 효과
- Beta 헤더 추가는 SDK 호환성 검증 후 별도 세션에서 적용
- 현재는 tool_use 가 schema 100% 강제

#### 자동 추적 (P2-#1, 2026-04-27 추가)
사장님이 어드민에서 패키지 필드 인라인 편집하면 PATCH /api/packages 가 **자동으로 정정 캡처**.
- 추적 대상: `inclusions`/`excludes`/`notices_parsed`/`optional_tours`/`product_summary`/`product_highlights`/`itinerary_data`/`accommodations`/`min_participants`/`ticketing_deadline`/`price`/`surcharges`/`excluded_dates`
- severity 자동 분류: 인원·기한·가격=CRITICAL, 포함·일정=HIGH, 카피·숙소=MEDIUM, 태그=LOW
- category 기본값 'manual-correction' — 사장님이 `/admin/extractions/corrections` 에서 정확한 카테고리·교훈 추가
- 교훈(reflection) 텍스트는 비어 있어도 prompt 에 주입됨 (before/after diff 자체로 학습 신호)

#### 어드민 대시보드
`/admin/extractions/corrections` — 누적 정정 목록 + applied_count + 통계.
- 교훈 텍스트 추가/수정 (1줄 자연어 — 예: "원문 일정 verbatim 우선")
- severity·category 정정
- 잘못된 정정 비활성화 (영구 삭제 금지)
- 필터: 목적지·severity 별

### 4. 스키마 이중성 함정 주의

- `surcharges`는 반드시 **객체 배열**로 저장: `{ name, start, end, amount, currency, unit }`
  - `excludes`에 "$10/인/박" 문자열로만 넣으면 A4 포스터가 날짜를 못 읽음 (ERR-20260418-03)
- `optional_tours[].price`는 **문자열 형식** 통일 (예: "$35/인")

### 4-1. 날짜 필드 맥락 파싱 규칙 (ERR-date-confusion 방지)

원문의 `YYYY.M.D` / `YYYY-MM-DD` 날짜는 **맥락에 따라 다른 필드에 매핑**:

| 원문 패턴 | 의미 | DB 필드 |
|---------|------|--------|
| "X까지 발권" / "X까지 예약" | 발권기한 | `ticketing_deadline` |
| "X.Y 배포" / "X.Y 업데이트" / 상품명 뒤 단순 날짜 | 버전/배포일 | null (DB에 해당 필드 없음) |
| "X부터 출발" / 매일 출발 | 출발 시작일 | `price_dates` 첫 항목 |
| "X~Y 적용" / "X~Y 기간" | 가격 기간 | `price_tiers[].date_range` |
| "X~Y 제외" / "항공제외일" | 제외일 | `excluded_dates` |

**핵심 체크**: 원문에 "발권", "예약 마감", "티켓팅" 등 키워드가 **없으면** `ticketing_deadline = null` 설정.

### 5. 파싱 후 self-check 체크리스트

INSERT 전에 Agent가 스스로 점검:

- [ ] 원문에 "N명 이상" 표기가 있다면 `min_participants`와 일치하는가?
- [ ] 원문 비고 섹션 길이 대비 `notices_parsed` 합계 길이 ≥ 70%인가?
- [ ] 원문 "출확/출발확정" 표기가 `price_dates[].confirmed: true`에 반영되었는가?
- [ ] 원문 써차지 날짜 범위가 `pkg.surcharges` 객체 배열에 모두 있는가?
- [ ] 원문 쇼핑센터 "N회" 수치가 `special_notes`에 정확히 반영되었는가?
- [ ] 일정 내 관광지가 `attractions` 테이블에 있는지 확인 후 없으면 시드 필요 플래그
- [ ] **[신규]** `departure_days` 가 평문(`"월/수"`) 인가? `["금"]` 같은 JSON 배열 문자열 금지 (W16)
- [ ] **[신규]** `optional_tours[]` 의 "2층버스" / "리버보트" 같은 모호 이름에 `region` 필드가 채워져 있는가? (W17)
- [ ] **[W26 — ERR-HSN-render-bundle]** `inclusions` 배열의 각 항목이 **콤마 없는 단일 토큰**인가? `"항공료, 택스, 유류세"` 한 문자열 금지 → `["항공료","택스","유류세",...]` 로 분리해야 A4 포스터 아이콘 매칭 정상.
- [ ] **[W27 — ERR-HSN-render-bundle]** 각 일차의 `schedule` 에서 `type:'flight'` activity 가 **하루 최대 1개**이고, activity 텍스트가 `"출발지 출발 → 도착지 도착 HH:MM"` (→ 토큰 포함 단일 문장) 포맷인가? 출발·도착을 2개 flight 로 분리 금지 → 모바일 히어로 도착 시간 "—" + DAY 타임라인 이중 렌더 유발.
- [ ] **[W28 — ERR-HSN-render-bundle]** 호텔 관련 activity 는 `"호텔 투숙 및 휴식"` 고정 문구만 허용. `"호텔 체크인 및 휴식"` / `"라운드 후 석식 및 호텔 투숙"` 같은 **앞절 붙이기 금지** — DetailClient 가 "호텔.*투숙" 매칭 시 activity 전체를 스킵해 앞부분 정보 손실 유발. 필요한 경우 별도 normal activity 로 분리 (예: `"라운드 후 석식"` → 별행 + `"호텔 투숙 및 휴식"` 은 기본 호텔 카드에서 자동 표시).
- [ ] **[W29 — ERR-HSN-render-bundle]** `notices_parsed` PAYMENT/RESERVATION 타입에 **"출발N일전"** 형태(예: "항공 발권후(출발21일전) 취소시") 가 있으면 standard-terms 가 날짜 자동 주입할지 확인. negative lookbehind 적용됐지만 레거시 데이터는 원문 편집 권장 (Zero-Hallucination 방어).
- [ ] **[W30 — ERR-HET-render-over-split@2026-04-21]** `▶` 접두사 activity 에 `(…)` 괄호가 있을 때, **괄호 안이 서브 관광지 리스트가 아니라 체험/부연설명/연혁**이면 괄호 안 콤마를 `,` 대신 `·` (중점) 으로 쓸 것. 또는 괄호 자체를 제거하고 `note` 필드에 넣을 것. `splitScheduleItems` 가 W30 휴리스틱(suffix 유무 + 서술 키워드)으로 자동 방어하지만 **원문에 `(체험 A, B, C)` 형태가 나오면 Agent 가 애초에 `·` 로 변환 후 INSERT** 하는 것이 가장 안전.
   - ❌ `'▶유목민 생활 체험 (초원 오토바이, 활쏘기, 몽골족 간식)'` — 과다 분리 유발
   - ✅ `'▶유목민 생활 체험 (초원 오토바이·활쏘기·몽골족 간식)'`
   - ✅ `'▶왕소군묘 (2000년 역사·중국 4대 미인 중 한 명·평화의 상징)'`
   - ✅ `'▶샹사완 사막 액티비티 체험 (써핑카트·사막낙타체험·모래썰매)'`
   - 예외(분리 OK): `'▶호이안 구시가지 (풍흥의 집, 일본내원교, 떤키의 집) 유네스코 지정 전통거리 관광'` — 괄호 뒤 suffix 있고 괄호 안은 진짜 서브 관광지.
- [ ] **[W31 — ERR-FUK-camellia-overcorrect@2026-04-28]** `▶` 접두사 activity 에 **괄호 없이 콤마**만 있는 경우, **단일 명소 서술문**이면 콤마 그대로 INSERT — Agent 가 `·` 로 미리 변환할 필요 없음. `splitScheduleItems` 가 W31 휴리스틱(전체 활동 텍스트의 DESCRIPTIVE_KW + 콤마 직전 서술 어미 검출)으로 자동 보호.
   - ✅ `'▶높이 234M, 8000장의 유리로 단장한 후쿠오카 타워 관광'` — "M·단장한" 매칭 → 분리 X
   - ✅ `'▶큐슈 3대 신사 중 하나인 미야지다케 신사 관광'` — "중 한 명" → 분리 X
   - ✅ `'▶후쿠오카 성터가 남아있는 꽃놀이 명소 마이즈루 공원'` — "꽃놀이/명소" → 분리 X
   - ✅ `'▶학문의 신을 모신 태재부 천만궁'` — "신/모신" → 분리 X
   - ✅ `'▶오타루운하, 키타이치가라스, 오르골당'` — 짧은 명사 나열 → 분리 OK (3개)
   - **schedule = 원문 verbatim** 정책 (3-4 절). attractions SSOT 정상화 (예: "태재부 → 다자이후") 하지 말 것 — `attractions.aliases` 가 흡수.
- [ ] **regions vs 교통편 컬럼 구분 (ERR-FUK-camellia-overcorrect@2026-04-28)** — 원문 일정표의 "지역" 컬럼만 `itinerary_data.days[].regions` 로 매핑. **"교통편" 컬럼**(카멜리아·전용버스·기차·항공편 등)은 `regions` 가 아니라 `schedule[].transport` 또는 `flight()` 활동의 transport 인자로. 예: D1 "지역=부산 / 교통편=카멜리아" → `regions: ['부산']` (`['부산', '카멜리아']` 금지).
- [ ] **단어 추가 (괄호 보강) 환각 금지 (ERR-FUK-camellia-overcorrect@2026-04-28)** — 원문 토큰에 "(부연설명)" 추가하지 말 것. 예시 ❌: 원문 "왕복훼리비" → DB "왕복 훼리비 (카멜리아)" / 원문 "쇼핑센터 1회" → DB "쇼핑센터 1회 (면세점)". 부연 설명은 다른 필드에 배치 (예: `inclusions` 는 verbatim, `internal_notes` 또는 `customer_notes` 에 맥락 보강).

### 6. 🚨 DAY 교차 오염 방지 (ERR-KUL-02/03)

**한 원문에 여러 상품(예: 3박5일 + 4박6일)이 공존하는 경우 가장 빈번한 실수.**

AI가 3박5일 DAY N의 일정을 4박6일 DAY N에 복사하거나, 두 상품이 공유하는 호텔/관광지가 있다고 가정해 임의 삽입하는 패턴.

**필수 준수 규칙**:

1. **상품별 독립 컨텍스트 파싱**
   - 원문에서 각 상품 블록을 명확히 분리 (예: `[D7] ... 3박5일` 과 `[D7] ... 4박6일`)
   - 한 상품의 일정을 파싱할 때 **다른 상품의 일정 텍스트를 참조 금지**
   - DAY별 파싱은 해당 상품 블록 내부에서만 수행

2. **랜드마크 원문 대조 필수**
   - 각 DAY의 관광지 목록은 **해당 상품 블록 원문에 실제로 존재하는 명칭만** 포함
   - 예: 4박6일 원문에 "메르데카 광장"이 없으면 4박6일 일정에 절대 포함 금지
   - validator W18이 이를 자동 탐지: 원문에 없는 랜드마크 등장 시 경고

3. **유사 일정에 대한 경계**
   - "두 상품 모두 쿠알라룸푸르 시티투어"라고 비슷해 보여도, **원문이 명시하는 관광지 세트가 다를 수 있음**
   - 3박5일: 왕궁/국립이슬람사원/메르데카/KLCC
   - 4박6일: 왕궁/국립이슬람사원/KLCC (메르데카 없음)
   - 원문을 한 글자 한 글자 확인 후 반영

4. **self-check**
   - [ ] 각 DAY의 모든 관광지가 해당 상품 원문 블록에 텍스트로 존재하는가?
   - [ ] 원문에 없는 "공통으로 있을 법한" 장소를 임의 추가하지 않았는가?
   - [ ] 같은 원문의 다른 상품과 비교 시 일정 차이점이 원문 그대로 반영되었는가?

### 6. validatePackage 경고가 뜨면 **반드시 원문 대조**

- `[W13 ERR-...] min_participants 원문 불일치` 경고 → 즉시 수정 (조작 방지)
- `[W14 ERR-...] notices_parsed 축약 의심` 경고 → 원문 확인 후 예시 복원
- `[W15 ERR-...] surcharges 기간 누락 의심` 경고 → `pkg.surcharges` 객체 배열 보강

---

## Step 1: 입력 파싱

사용자 입력에서 추출:
- **랜드사명** + **마진율%** (예: "투어폰 9%")
- **발권기한** (있으면 YYYY-MM-DD)
- **원문 본문** (나머지 전체)

## 🆕 Step 1-b: inclusions 추출 verbatim 강제 규칙 (ERR-BHO-TB-01@2026-04-30)

> **발생 패턴**: AI가 포함사항 항목을 "자연스럽게" 다듬는 과정에서 원문에 없는 표현이 삽입됨.

**금지 변환 예시:**

| 원문 | ❌ AI 변환 (금지) | ✅ 올바른 verbatim |
|---|---|---|
| `유류할증료(5월기준)` | `유류할증료(2026-05-31 발권 기준)` | `유류할증료(5월기준)` |
| `한국인 매니저 안내(상시 카톡연결-현지맛집, 차량렌탈, ...)` | `한국인 매니저 안내(상시 카톡연결)` | 원문 전체 그대로 |
| `여행자보험` | `2억 여행자보험` | `여행자보험` |

**자동 탐지**: `post_register_audit.js` W32 — inclusions 각 항목이 raw_text의 verbatim substring인지 검증.

**insert-template.js helpers 올바른 패턴 (ERR-BHO-TB-02@2026-04-30)**:
```js
// ✅ 올바름 — helpers 는 inserter 객체 내부에 있음
const inserter = createInserter({ ... });
const { helpers: { flight, normal, optional, shopping, meal } } = inserter;

// ❌ 금지 — module.exports 에 없음
const { flight, normal, computeRawHash } = require('./templates/insert-template');
```

**computeRawHash 사용 (ERR-BHO-TB-03@2026-04-30)**:
```js
// ✅ v2026-04-30 이후: module.exports 에 포함됨
const { createInserter, computeRawHash } = require('./templates/insert-template');

// ⚠️ BHO 어셈블러 사용 시: buildBoholPackages() 가 rawText 에서 자동 계산 (별도 호출 불필요)
```

---

## 🆕 Step 1.5: 카탈로그 일관성 사전 검증 (ERR-NHA-multi-airline-catalog@2026-04-27)

> **목적**: INSERT/IR 파이프 진입 전에 **원문 자체의 모순**을 먼저 식별. 모순이 있으면 등록 진행을 중단하고 사장님에게 결정 요청. Step 6.5 의 self-audit 은 "DB 필드 vs 원문" 대조이지 "원문 내부 모순" 은 잡지 못함.
>
> **언제 가장 빈번한가**: 한 카탈로그가 **여러 항공편/여러 호텔 등급/여러 적용기간** 을 동시에 묘사할 때 (예: 같은 목적지를 BX·VJ 두 항공으로 동시 견적, 정통/품격 두 호텔등급 동시 견적). 가격표가 1개라 **어느 옵션 기준인지 불명확**한 케이스가 가장 많음.

### 1.5-A. 항공편 정체성 충돌 검출

원문에서 항공사 코드(2-letter IATA + 숫자)와 출발 시간을 모두 수집한 뒤 **충돌 여부 검사**.

```
[검출 패턴]
- 헤더: "[BX-에어부산]" + "BX 781 19:30"
- 본문/일정표: "VJ919 10:55" 또는 "[VJ]"
→ 항공사 충돌 (BX vs VJ) + 출발시간 충돌
```

**판정 규칙**:

| 케이스 | 처리 |
|---|---|
| 단일 항공사 + 단일 시간 | ✅ 정상. 그대로 진행 |
| 단일 항공사 + 다중 시간 (예: 오전 출발/오후 출발) | ⚠️ 출발편 옵션. price_tiers 분리 또는 별도 상품 — 사장님 확인 |
| **다중 항공사** (예: BX vs VJ) | 🛑 **STOP**. 다음 4개 질문 후 진행: |

**STOP 시 사장님 확인 항목 (필수)**:
1. 가격표는 어느 항공편 기준? (BX / VJ / 양쪽 동일)
2. 어떤 항공편으로 등록? (각각 별도 상품 / 1개만)
3. 일정표가 한 항공편 기준이면 다른 항공편은 시간만 교체?
4. 발권기한이 항공편별로 다른가?

### 1.5-B. 가격표 ↔ 옵션 출처 검증

가격표 위/아래에 **항공/호텔/유형 표기가 둘 이상** 있으면 가격표 출처가 모호하다는 증거.

```
[안전 패턴]
[항공 BX781] → [가격표] → [일정표 BX781]
→ 가격표 출처 명확 (BX 기준)

[위험 패턴]
[항공 BX781] → [가격표] → [VJ 헤더] → [일정표 VJ919]
→ 가격표가 BX/VJ 어느 쪽 기준인지 모호
```

**자동 휴리스틱**:
- 가격표 직전 8줄 안에 항공편 코드 A 등장
- 가격표 직후 8줄 안에 항공편 코드 B 등장
- A ≠ B → 모호 플래그 → **사장님 확인 필수**

### 1.5-C. 신규 랜드사 검출 (2026-04-27 사장님 정책 반영)

`db/land-operators.json` 또는 `land_operators` 테이블에 **랜드사명이 없으면** INSERT 시 FK 위반으로 실패.

**자동 검사** (Agent 가 Step 1 직후 수행):
```bash
node -e "console.log(!!require('./db/land-operators.json')['<랜드사>'])"
```

**미등록 시 처리** (사장님 결정 2026-04-27):
- ✅ 사장님이 `"<랜드사명> N%"` 형태로 명시 입력했으면 **그 이름 그대로 신규 INSERT 진행** (디폴트)
- ✅ 커미션은 사장님 입력값 그대로 (랜드사·상품별 다름)
- ✅ 코드(2-letter) 자동 생성 (예: 투어폰=TP, W투어=WT, 더투어=TT)
- ✅ 사장님 1회 확인 메시지: "랜드사 `<이름>` 신규 등록합니다 (코드 `<XX>`, 커미션 `N%`). 진행 OK?" — Y 받은 후 INSERT
- ❌ "다른 이름 오타 아닌가요?" 같은 의심 질문 금지 (사장님이 명시했으면 그대로 추가가 원칙)
- 🗒️ **이름 중복 정리**(W투어 vs 더블유투어 등)는 사장님이 향후 일괄 처리 — 등록 단계에서는 사장님 입력 그대로

**왜**: 랜드사는 정산·세금 정보가 붙는 마스터 테이블이지만, 사장님이 직접 명시 입력한 경우는 신뢰. 누락 필드(business_number, contact 등) 는 사장님이 어드민에서 사후 보완.

### 1.5-E. 호텔 등급 vs 룸타입 컬럼 분리 (2026-04-27 사장님 정책 — ERR-hotel-grade-roomtype-mixed)

**`hotel.grade` 는 등급만 저장. 룸타입·호텔종류·숙박정보는 다른 필드.**

#### E-1. `hotel.grade` 표준 7종

| 표준 표기 | 의미 |
|---|---|
| `"3성"` / `"준3성"` | 3성급 / 준3성급 |
| `"4성"` / `"준4성"` | 4성급 / 준4성급 |
| `"5성"` / `"준5성"` | 5성급 / 준5성급 |
| `null` | 비표준 숙박 (게르/크루즈/선실 등) — facility_type 으로 분리 |

원문 표기 → 표준 매핑:

| 원문 표기 | 표준 grade | 비고 |
|---|---|---|
| `(5성특급)` / `5성+` / `정5성` / `5+` / `5성급` | `"5성"` | "특급"·"+"·"급" 모두 제거 |
| `4.5성` / `준5성급` / `(준5성)` | `"준5성"` | 4.5성도 준5성으로 |
| `(4성특급)` / `4성급` / `정4성` | `"4성"` | |
| `준4성급` / `(준4성)` | `"준4성"` | |
| `5성) ...` (괄호 짝 깨짐) | `"5성"` | 정규화 |
| `시외4성급` / `비지니스급` | `"4성"` + note | 부가 설명은 note 로 |

#### E-2. `hotel.room_type` (신규 필드 — 향후 스키마 추가, 임시는 note)

❌ **다음 값들이 현재 잘못 grade 에 저장되어 있음 (백필 대상)**:

| 잘못된 grade 값 | 정정 방향 |
|---|---|
| `"디럭스룸"` (21건) / `"슈페리어룸"` (14건) | `room_type` 필드로 이동, grade 는 호텔 등급 별도 |
| `"슈페리어 가든뷰"` (4건) | `room_type` 필드로 이동 |
| `"5성급, 2인1실"` (4건) | grade=`"5성"`, room_type=`"2인1실"` 로 분리 |

표준 룸타입 (참고): `디럭스룸 / 슈페리어룸 / 스위트룸 / 패밀리룸 / 가든뷰 / 시티뷰 / 오션뷰 / 풀뷰`

#### E-3. `hotel.facility_type` (신규 필드 — 비표준 숙박)

비표준 숙박은 grade=null + facility_type 으로:

| 원문 표기 | facility_type | grade | note |
|---|---|---|---|
| `리조트` / `5성급 리조트` | `"resort"` | `"5성"` 또는 null | 호텔 등급이 명시된 경우만 grade |
| `게르` / `전통 게르` / `럭셔리 게르` | `"ger"` | null | 등급 개념 없음 |
| `크루즈` / `5성 크루즈` | `"cruise"` | grade 명시된 경우만 | |
| `선실` | `"cabin"` | null | |

#### E-4. `hotel.grade` 에 들어가면 안 되는 것 (절대 금지)

- ❌ 호텔명: `"Vansana LPQ"`, `"Grand riverside"` (4건씩) → `hotel.name` 으로
- ❌ 숙박정보: `"3박"`, `"2인1실"` → 별도 필드
- ❌ 룸타입: 위 E-2 표 참고

#### 적용 위치

- `accommodations[]`: `"셀렉텀 노아 깜란 리조트(5성)"` — 등급만 괄호
- `itinerary_data.days[].hotel.grade`: 표준 7종 중 1개 (또는 null)
- `itinerary_data.days[].hotel.room_type`: 디럭스룸 등 (현재는 note 로 임시 저장)
- `itinerary_data.days[].hotel.facility_type`: 게르/크루즈 등 비표준 숙박

#### DB 현황 (2026-04-27 분류 결과)

```
710건 중:
  ✅ 진짜 등급:  629건 (88%) — 13종 표기 변동 → 7종 정형화 필요
  🛏️ 룸타입:     35건 (5%)  — 디럭스룸·슈페리어룸 → room_type 으로 이동
  ❓ 기타:       28건 (4%)  — 게르·크루즈·선실 → facility_type
  🏨 호텔종류:   18건 (3%)  — "리조트" 단독 → grade=null
```

**왜 중요한가**: 컬럼 책임 분리 (ERR-special-notes-leak 와 같은 패턴). grade 에 룸타입/호텔명이 섞이면 ① 모바일 별 표시 깨짐 (ERR-HET-hotel-grade-ambiguity@2026-04-22 재발) ② 등급 필터/검색 결과 왜곡 ③ 신규 등록 시 어떤 값을 넣을지 컨벤션 부재.

**백필 백로그**: `db/backfill_hotel_grade_split.js` (향후) — 35+28+18 = 81건 분리 + 629건 정형화. 사장님 명시 승인 후 진행.

### 1.5-D. 유류할증료 + 발권기한 표기 (2026-04-27 사장님 정책)

원문 패턴: `"유류할증료(N월)"` + `"YYYY-MM-DD 발권조건"` + 적용기간이 발권기한 이후까지 확장 → **정상 패턴** (모순 아님).

**의미**: 발권기한 전 발권 시 표기 가격 유효. 발권기한 이후 출발은 유류세 인상분/인하분이 별도 반영됨.

**표준 처리**:
- ✅ `inclusions`: `"왕복항공+TAX+유류할증료(YYYY-MM-DD 발권 기준)"` 명시
- ✅ `excludes`: `"유류세 인상분"` 추가 (사장님 정책)
- ✅ `ticketing_deadline`: 발권기한 정확히 기재
- ❌ "(4월) 의미가 4월 출발만 포함" 같은 자의적 해석 금지

**Agent 가 STOP 해야 하는 진짜 모순 패턴**: 발권기한이 적용기간보다 **이전이고 유류할증료(N월) 표기 없는 경우** → 사장님 확인.

### 1.5-F. 호텔 등급 표기 변동 (1.5-E 와 함께 적용)

```
원문 헤더: "(5성특급) 셀렉텀 노아 깜란"
원문 일정표: "5성) 셀렉텀 노아"
→ 자동 정형화: 양쪽 모두 "5성" (1.5-E 매핑 표 참조)
→ 사장님 확인 불필요 (정형화 룰 자동 적용)
```

### 1.5-Z. False Positive 제외 (모순 아님 — Agent 가 의심하지 말 것)

다음 패턴은 자유일정·에어텔·동남아 항공편의 **정상 패턴** — Step 1.5 검증에서 제외:

| 의심 패턴 | 실제 의미 | 처리 |
|---|---|---|
| `"불포함: 가이드"` + `"불포함: 매너 팁"` | 자유일정에 따라다니는 가이드/매너팁 모두 없음 (고객 혼동 방지용 명시) | 원문 verbatim |
| `"포함: 리조트 셔틀 픽업"` + `"불포함: 차량/기사"` | 리조트 자원 셔틀 vs 가이드 동행 차량/기사는 별개 | 원문 verbatim |
| `"불포함: 여행자보험"` (에어텔/리조트 패키지) | 에어텔 상품 표준. 한국 일반 패키지와 다름 | 원문 verbatim |
| 제5일 03:10 출발 (새벽) | 호텔 오전 체크아웃(전일) → 새벽 비행기 출국 | 일정표 표기 그대로 |
| `"매일운항"` + 가격표에 일부 요일 비싼 가격 | 운항은 매일, 요일별 가격 차등 | price_tiers 분리만 |

### 자동 검증기 (향후 P3)

`db/audit_raw_text_consistency.js` 로 자동화 예정. 현재는 Agent 가 self-check 로 수행:

- [ ] **A. 항공편 정체성**: 원문 내 항공사 코드 종류 ≤ 1
- [ ] **B. 가격표 출처**: 가격표 인접 8줄 내 항공/호텔 라벨 일관
- [ ] **C. 랜드사 등록**: `land-operators.json` 에 존재
- [ ] **D. 발권/적용기간**: 발권기한이 적용기간 안에 포함되는가
- [ ] **E. 호텔 등급**: 원문 내 호텔 등급 표기 일관 (5성특급 ↔ 5성 같은 변동 없음)

**1개라도 실패** → 등록 중단 → 사장님 확인 후 재시작.

## Step 2: 지역 감지

원문에서 아래 키워드를 탐색하여 지역 코드 판별:

| 키워드 | 지역 | 코드 |
|--------|------|------|
| 서안, 병마용, 화청지, 진시황, 화산(중국) | 서안 | XIY |
| 칭다오, 청도, 잔교, 태산, 노산 | 칭다오 | TAO |
| 장가계, 천문산, 천자산, 원가계, 보봉호 | 장가계 | DYG |
| 나트랑, 달랏, 판랑, 캄란, 빈펄 | 나트랑 | NHA |
| 라오스, 비엔티엔, 루앙프라방, 방비엥 | 라오스 | LAO |
| 몽골, 울란바토르, 테를지, 게르 | 몽골 | MNG |
| 다낭, 호이안, 후에, 바나힐 | 다낭 | DAD |
| 하노이, 하롱베이, 닌빈 | 하노이 | HAN |
| 보홀, 초콜릿힐, 타시에르 | 보홀 | BHO |
| 후쿠오카, 유후인, 벳부 | 후쿠오카 | FUK |

감지 결과를 사용자에게 확인: "**[서안] 지역으로 감지되었습니다. 맞습니까?**"

## 🆕 Step 2.5: IR 파이프 (Canary, 2026-04-21 도입)

Phase 1.5 로 도입된 **Intake Normalizer (IR) 파이프** 가 기본 권장 경로가 됩니다.
원문 → Zod-IR → pkg 3단 구조로 환각·축약·조작을 구조적으로 차단합니다.

### IR 파이프 사용법 — 3가지 엔진 선택 가능

```bash
# 0) 서버 실행 필수
npm run dev

# [A] DIRECT 엔진 — Claude Code 세션(이 대화)이 직접 IR 작성, LLM 호출 0원 ⭐ 추천
#   사장님이 /register <원문> 하면 Agent가 IR JSON을 scratch/*.json 에 쓴 다음:
node db/register_via_ir.js <raw.txt> --engine=direct --ir=<scratch/ir.json> --insert

# [B] Gemini 2.5 Flash 엔진 — 저렴·빠름 (~0.003$/건)
node db/register_via_ir.js <raw.txt> --operator=<랜드사> --margin=<N> --engine=gemini --dry-run
node db/register_via_ir.js <raw.txt> --operator=<랜드사> --margin=<N> --engine=gemini --insert

# [C] Claude Sonnet 4.6 API — 프리미엄 품질 (~0.03$/건)
node db/register_via_ir.js <raw.txt> --operator=<랜드사> --margin=<N> --engine=claude --insert
```

### 엔진 비교 및 추천

| 엔진 | 비용 | 품질 | 배치 | 추천 상황 |
|---|---|---|---|---|
| **direct** (Claude Code 세션) | **0원** | **95%+** | ❌ 대화형 | **월 ~30건까지, 최고 품질**. 사장님 현재 규모에 최적 |
| gemini (Flash) | 0.003$/건 | 85% | ✅ | 자동화·배치·반복 상품 |
| claude (Sonnet API) | 0.03$/건 | 95% | ✅ | 중요 상품·복잡 원문 |

### 경로 최종 결정 플로우

| 상황 | 경로 |
|---|---|
| 어셈블러 존재 (XIY/TAO/DAD) | **경로 A (어셈블러)** — 무과금 패스트트랙 유지 |
| 어셈블러 없음 + Claude Code 대화형 (사장님 `/register` 호출) | **IR direct** (0원, 최고 품질) |
| 어셈블러 없음 + 자동화·배치 필요 | **IR gemini** (저렴) |
| 의심 상품·복잡 원문 | **IR claude** (프리미엄 API) |
| LLM 불가 + 급함 | **레거시 수기 insert 스크립트** (경로 B-1) |

### Direct 모드 Agent 워크플로우 (사장님 `/register` 호출 시)

사장님이 `/register <원문>` 하면:
1. Agent 가 `NormalizedIntakeSchema` 를 읽고 **IR JSON 을 직접 작성**
2. `scratch/ir-<region>-<timestamp>.json` 에 저장
3. `node db/register_via_ir.js <raw.txt> --engine=direct --ir=<scratch/ir.json> --insert` 실행
4. /api/register-via-ir 가 Zod 검증 → pkg 변환 → INSERT → post-audit
5. 결과값 한 화면 리포트

→ **LLM API 호출 0원 · 사장님 대기 시간 2~5분 · 품질 95%+**

### 신규 지역 사전 준비
```bash
# 어셈블러 BLOCKS 가 있으면 attractions 테이블 부트스트랩 (1회)
node db/bootstrap_attractions_from_assemblers.js --region=<지역> --insert
# 그 후 /admin/attractions 에서 long_desc·사진 수기 보완
```

### IR 파이프 산출물
- `normalized_intakes` 테이블에 IR 원본 저장 (status: draft→converted)
- `travel_packages` 에 pkg INSERT
- `unmatched_activities` 에 lookup 실패 세그먼트 자동 큐잉
- 자동 약관 조립 (terms-library resolver) 으로 `notices_parsed.auto` 채움

### 파일 맵 (Phase 1.5 자산)
- `src/lib/intake-normalizer.ts` — Zod 스키마 (7-kind segment)
- `src/lib/normalize-with-llm.ts` — Claude Sonnet 4.6 tool use
- `src/lib/ir-to-package.ts` — 기계 변환
- `src/lib/terms-library.ts` — 자동 약관 resolver
- `src/app/api/register-via-ir/route.ts` — API
- `db/register_via_ir.js` — CLI 래퍼
- `db/bootstrap_attractions_from_assemblers.js` — 신규 지역 부트스트랩

---

## 🆕 Step 2.7: 파싱 직후 Pre-INSERT Self-Check (W26~W29 재실행 방지)

> **목적**: INSERT 제출 전에 Agent 가 **스키마 위반을 선제 검출**해서 재실행 사이클을 막는다.
> 2026-04-21 호화호특 등록 시 W28 에 걸려 INSERT 1회 낭비 (~60초 + 5K 토큰).
> 이 체크를 스크립트 작성 중에 강제하면 재발 차단.

Agent 는 `inserter.run(packages)` 를 호출하기 **직전** 아래 5개를 self-check:

```js
for (const p of packages) {
  // 1) W26 — inclusions 콤마 포함 단일 문자열 금지
  for (const inc of (p.inclusions || [])) {
    if (typeof inc === 'string' && inc.split(/,(?=\s*\D)/).length > 1)
      throw new Error(`[W26 self-check] inclusions "${inc}" 콤마 포함 — 개별 배열로 분리`);
  }
  // 2) W27 — 하루 flight 여러개면 반드시 "→" 토큰
  const days = Array.isArray(p.itinerary_data) ? p.itinerary_data : (p.itinerary_data?.days || []);
  for (const d of days) {
    const flights = (d.schedule || []).filter(s => s.type === 'flight');
    if (flights.length > 1 && flights.some(f => !/→|↦|⇒/.test(f.activity || '')))
      throw new Error(`[W27 self-check] Day ${d.day} flight ${flights.length}개 but "→" 토큰 누락`);
  }
  // 3) W28 — "호텔 투숙/휴식" 앞절 붙이기 금지 ("석식 후 호텔 투숙 및 휴식" 같은 활동)
  for (const d of days) {
    for (const s of (d.schedule || [])) {
      if (s.type !== 'normal' || !s.activity) continue;
      if (/호텔\s*(?:투숙|휴식|체크인|체크 인)/.test(s.activity) && !/^[*\s]*호텔/.test(s.activity))
        throw new Error(`[W28 self-check] Day ${d.day} "${s.activity}" — 앞절 붙이기 금지. 별도 normal 로 분리`);
    }
  }
  // 4) W29 — notices_parsed PAYMENT 에 "출발N일전" 있으면 surcharges 날짜 주입 경계 재확인
  // 5) raw_text >= 50자 + raw_text_hash 동반
  if (!p.raw_text || p.raw_text.length < 50)
    throw new Error('[RuleZero self-check] raw_text 누락');
}
```

**이 블록을 등록 스크립트 상단에 inline 로 넣거나**, 공용화되면 `insert-template.js` 의 `preflightCheck(packages)` 로 이관한다.

---

## Step 3: 라우팅 (3분기 자동 판단)

> **🟢 사장님 안내**: `/register`만 부르면 **Agent가 자동으로 분기**합니다. 어셈블러 존재 여부, 기존 상품 수, 중복 여부 모두 자동 판단. 사장님이 어셈블러 호출법을 외울 필요 없음.

### 3-0. 어셈블러 존재 여부 확인 (Agent 자동 실행)

```bash
ls db/assembler_{region_code 소문자}.js 2>/dev/null
```

**현재 어셈블러 존재 지역** (자동 갱신 안 됨 — `ls db/assembler_*.js` 로 항상 재확인):
- `assembler_xian.js` → 서안 (XIY)
- `assembler_qingdao.js` → 칭다오 (TAO)
- `assembler_danang.js` → 다낭/호이안 (DAD) ← 2026-04-20 추가
- `assembler_bho.js` → 보홀 (BHO) ← 2026-04-30 완성 (라이브러리 모드)

**BHO 어셈블러 사용 방법 (경로 A)**:
```js
// db/insert_bohol_{operator}_packages.js (~100줄)
const { createInserter, computeRawHash } = require('./templates/insert-template');
const { buildBoholPackages } = require('./assembler_bho');

const inserter = createInserter({ landOperator: '랜드사명', commissionRate: N, ... });
const { helpers: { flight, normal } } = inserter;  // ← 올바른 helpers 사용 패턴

const packages = buildBoholPackages({
  inserter, hotels, flightOut, flightIn,
  priceDates3D, priceDates4D,  // db/lib/parse-price-table.js로 추출 권장
  inclusions, excludes, notices, rawText,
});
inserter.run(packages);
```

**가격표 날짜 이상치 탐지**: `db/lib/parse-price-table.js`의 `parsePriceRows()` 사용 → 월 오타·요일 불일치·날짜 중복 자동 탐지.

**모델 선택**: BHO 어셈블러 존재 → **Haiku 4.5 사용 가능** (호텔명/항공편/가격표 단순 추출). Sonnet 불필요.

**존재**: → 경로 A (즉시 어셈블러 실행, MD 추가 분석 최소화 — 토큰 ~90% 절감)
**없음**: → 3-1로 진행

### 3-0-a. 중복 자동 SKIP (모든 경로 공통)

`insert-template.js`의 `findDuplicate()` + `isSamePriceDates()` + `isSameDeadline()`이 자동 검사:
- **동일 랜드사 + destination + product_type + duration + 출발일 겹침 + 가격 동일 + 마감 동일** → 즉시 SKIP (토큰 0)
- 가격만 변경 → 기존 archived + 신규 INSERT
- 완전성 점수 -20% 이상 하락 → `pending_replace` 보류 (라이브 교체 차단, ERR-KUL-safe-replace)

→ 사장님이 같은 원문을 두 번 붙여넣어도 안전. 자동 SKIP.

### 3-1. 해당 지역 기존 상품 수 조회 (🆕 N=3 자동 트리거)

```sql
SELECT COUNT(*) FROM travel_packages
 WHERE destination ILIKE '%{지역명}%'
```

- **등록된 상품 2개 이하** (이번 상품 포함 시 1~3번째): → **경로 B-1** (insert-template만)
- **등록된 상품 3개 이상** (이번 상품 포함 시 4번째+) 또는 이번이 **3번째 상품**: → **경로 B (B-1 + B-2 어셈블러 자동 생성)**

**임계값 N=3 근거**:
- 2개 이하는 공통 패턴 확신 불가 (우연의 일치)
- 3개부터 공통 블록 vs 차별 블록 구분 가능
- 호텔 풀 / 식사 풀 / 템플릿(실속/품격) 자연스럽게 추출

---

### 경로 A — 어셈블러 존재 (XIY, TAO 등)

```bash
# 1. 원문 저장
# db/sample.txt에 원문 저장

# 2. dry-run
node db/assembler_{region}.js db/sample.txt --operator <랜드사> --commission <N> --deadline <날짜> --dry-run

# 3. 검수 리포트를 사용자에게 보여주기

# 4. 사용자 승인 후
node db/assembler_{region}.js db/sample.txt --operator <랜드사> --commission <N> --deadline <날짜> --insert

# 5. 정리
rm db/sample.txt
```

### 경로 B — 어셈블러 없음 (신규 지역)

**Step 3-1 결과에 따라 분기:**

- 🟡 **B-1 단독** (해당 지역 상품 1~2개일 때): 상품 등록만 수행, 어셈블러는 아직 생성하지 않음
- 🟢 **B-1 + B-2 동시 수행** (해당 지역 상품 3개 이상 시): 상품 등록 + 어셈블러 자동 생성

즉, **이번 상품이 해당 지역의 3번째 상품**이 되는 순간 어셈블러를 생성합니다:
- 기존 2개 + 이번 신규 1개 = 총 3개 상품 분석
- 공통 블록 추출 → BLOCKS 배열
- 상품 타입별 조합 → TEMPLATES 배열 (실속/품격 등)

#### B-1. 상품 등록 (즉시)
`/register-product` 커맨드의 규칙을 따른다:
1. `.claude/commands/register-product.md`를 **Read**하여 스크립트 생성 규칙 참조
2. `db/templates/insert-template.js`의 `createInserter()` 활용 (Zod 검증 내장)
3. `db/insert_{dest}_{id}_packages.js` 생성 → 사용자 확인 후 실행

#### B-2. 어셈블러 자동 부트스트랩 (🆕 P3 #1, 2026-04-27 도입)

상품 등록 완료 후, **반드시** `db/auto_bootstrap_assembler.js` 를 호출해 STUB 어셈블러를 생성한다.

```bash
node db/auto_bootstrap_assembler.js --region=<지역명> --dest-code=<XYZ>
```

자동 추출 산출물 (`db/assembler_<slug>.stub.js`):
- **BLOCKS** — 등록된 N개 상품의 `itinerary_data` 에서 `▶...` 마커 활동을 빈도순으로 정렬, 자동 추출
- **DESTINATION.hotel_pool** — 등록 상품의 `accommodations` 통합 (등급 분류는 수기 보완 필요)
- **AIRLINES** — 등록 상품의 `airline` / `departure_airport` 자동 매핑
- **COMMON_INCLUSIONS / COMMON_EXCLUDES** — 절반 이상 등장한 항목 (지역 공통 패턴)

**자동화 안 되는 부분 (Agent 또는 사장님이 stub 검수 후 보완):**
- BLOCKS 의 `keywords` 정제 (자동은 단순 토큰만 추출)
- BLOCKS 의 `score` 검토 (점수 가중치는 수기 결정)
- TEMPLATES 작성 (실속/품격 같은 상품 유형별 BLOCK 조합)
- `parseRawText` / `buildProduct` / `insertToDB` 구현 — `db/assembler_qingdao.js` 등 참고

검수 후 `.stub.js` → `.js` 로 rename 하면 다음 등록부터 자동 사용된다 (Step 3-0 어셈블러 존재 감지).

**보고 포맷:**
```
✅ db/assembler_{slug}.stub.js 자동 부트스트랩 완료
   ├ BLOCKS: N개 (등장 빈도순)
   ├ 호텔 풀: H개
   ├ 공통 inclusions: I개 / excludes: E개
   └ 다음: stub 검수 → assembler_{slug}.js 로 rename → 다음 등록부터 자동 사용
```

**기존 어셈블러 존재 시**: 스크립트가 거부 (덮어쓰기 방지). 보완하려면 직접 편집.

---

## 중복 방어 (모든 경로 자동)

- **어셈블러 경로**: `insertToDB()`에 내장된 중복감지 (destination + product_type + duration)
- **insert-template.js 경로**: `findDuplicate()` + `isSamePrice()` + Zod 검증
- 완전 동일 → **SKIP** (토큰 소모 없이 즉시 종료)
- 가격/기한 변경 → 기존 **archived** + 신규 등록

## 검증 (모든 경로)

INSERT 전에 `insert-template.js`의 `validatePackage()` 자동 실행:
- price_dates: YYYY-MM-DD 형식 + 양수 가격 + 최소 1개
- itinerary_data.days: 최소 1일 + day >= 1
- schedule[].activity: 빈 문자열 금지
- schedule[].type: 'transport' 금지 (TransportBar 크래시)
- highlights.remarks: string[] 강제 (객체 배열 금지)
- **[W-final F3]** raw_text 50자 이상 + raw_text_hash 일치 강제 (ERROR — INSERT 차단)

---

## 🧠 Step 6.5: Agent Self-Audit (MANDATORY, 제로-코스트)

> **목적**: Gemini 유료 호출 없이 Claude Code 세션(Agent 본인)이 파싱 직후
> self-audit 을 수행한다. **확증 편향을 막기 위해 반드시 Reflection + CoT 강제**.
>
> **시점**: 파싱 완료 → validatePackage 통과 → **Agent self-audit** → INSERT
>
> **비용**: 0 (이 세션의 Claude 사고 능력 사용)
>
> **왜 이게 효과적**: 원문을 가장 잘 아는 건 지금 세션에서 파싱한 Agent 본인.
> 외부 API로 재감사하는 것보다 같은 컨텍스트에서 self-check 하는 것이 정확하고 빠름.

### 🔒 확증 편향 방지 — 반드시 지킬 것

AI 가 "내가 쓴 답이 맞냐?" 라고 자문하면 99% 합리화합니다. 이를 막기 위해:

1. **raw_text 직접 인용 강제**: "원문에 있다"고 답하기 전 **원문에서 해당 문구를 verbatim 복사**할 것
2. **Chain-of-Thought 강제**: 각 claim 마다 `<thinking>` 블록으로 단계별 검증 과정 기록
3. **근거 없으면 `supported: false`**: "아마 있을 것 같다" 금지. 원문에 **없으면 없다고** 답할 것

### Self-Audit 프로토콜 (Agent 가 따라야 하는 절차)

파싱된 pkg JSON 에서 아래 필드별로 **검증 대상 claim** 을 뽑고, 각 claim 마다:

1. **원문 인용** — raw_text 에서 claim 의 근거 문구를 verbatim 찾아 복사
2. **생각 사슬** — `<thinking>` 으로 "이 문구가 해당 claim 을 뒷받침하는가?" 검토
3. **판정** — `supported: true | false | null` (null 은 원문 모호할 때만)

검증 필수 필드:

| 필드 | 타겟 에러 | severity |
|---|---|---|
| `min_participants` | ERR-20260418-01 (템플릿 4 조작) | HIGH |
| `ticketing_deadline` | ERR-date-confusion (발권 vs 배포일 혼동) | HIGH |
| `inclusions` 중 **금액/등급/N박 토큰** | ERR-FUK-insurance-injection ("2억 여행자보험") | CRITICAL |
| `surcharges` 기간+금액 | ERR-20260418-03/14 | HIGH |
| `notices_parsed` 중 **PAYMENT 타입** | ERR-FUK-clause-duplication | CRITICAL |
| `itinerary_data.days[i].regions` | ERR-KUL-02/03, ERR-FUK-regions-copy (DAY 교차) | HIGH |
| `optional_tours[]` region 정합 | ERR-KUL-04 | MEDIUM |

### 출력 형식 (INSERT payload 의 `agent_audit_report` 필드에 저장)

```json
{
  "parser_version": "register-v2026.04.21-sonnet-4.6",
  "ran_at": "2026-04-21T12:00:00Z",
  "claims": [
    {
      "id": "min_participants",
      "field": "min_participants",
      "severity": "HIGH",
      "text": "최소 출발인원 10명",
      "evidence": "원문 3줄: '성인 10명 이상 출발 가능'",
      "supported": true,
      "note": null
    },
    {
      "id": "inclusions:2",
      "field": "inclusions",
      "severity": "CRITICAL",
      "text": "포함: 2억 여행자보험",
      "evidence": null,
      "supported": false,
      "note": "원문에는 '여행자보험' 만 있음. '2억' 표기 없음 — 금액 환각 의심"
    }
  ],
  "overall_verdict": "warnings",
  "unsupported_critical": 1,
  "unsupported_high": 0
}
```

### 판정 결과 → 액션

- **모든 claim supported: true** → `overall_verdict: "clean"`, 바로 INSERT 진행
- **CRITICAL 하나라도 `supported: false`** → `overall_verdict: "blocked"`, **INSERT 중단 + 재파싱**
- **HIGH `supported: false` 만 있음** → `overall_verdict: "warnings"`, INSERT 진행 하되 post-audit 가 warnings 로 승격
- **unclear(null) 만 있음** → `overall_verdict: "warnings"`, 사용자에게 원문 확인 요청

### 구현 메커니즘

- `db/templates/insert-template.js` 의 INSERT payload 에 `agent_audit_report` 필드가 추가되어 있음
- Agent 가 이 JSON 을 생성해서 pkg 객체에 얹어 `createInserter().run()` 호출
- DB 에 영속 → `post_register_audit.js` 가 이 보고를 읽어 warnings 로 승격 (Gemini 호출 없이)

### 🚫 금지 사항

- 외부 API 호출 (Gemini/OpenAI) — 이 단계는 순수 Claude 세션 내에서만
- "보통 이 정도 상품은 이럴 것이다" 라고 상식 추론 — 반드시 raw_text 만 근거
- claim 을 건너뛰기 — 위 표의 모든 타겟 필드를 반드시 처리

---

## 🚨🚨🚨 Step 7: 등록 후 자동 감사 (**MANDATORY — 절대 생략 금지**)

### 메타 규칙 (ERR-process-violation + ERR-process-violation-auto-approve@2026-04-21)
> **사용자가 명시적으로 지시하지 않아도, INSERT 성공 즉시 반드시 `post_register_audit.js`를 실행하고,
> `audit_status=clean` 이면 **자동으로 approve API 까지 호출해 `status='active'` 활성화 + 최종 결과값 도출까지 완수**한다.**
> **"어드민에서 직접 승인하세요" / "나중에 하세요" / "수동 단계" 안내 금지. 모든 단계를 Agent 가 완수한다.**
> **사장님은 원문만 붙여넣는다. 등록-감사-승인-결과값 전부 Agent 책임.**
> **이 규칙 위반 시 ERR-process-violation* 계열로 error-registry.md 에 기록.**

### 자동 실행 체크리스트 (Agent self-check — 전부 수행 필수)
- [ ] INSERT 성공 직후 `node db/post_register_audit.js <inserted-id-1> <inserted-id-2> ...` 호출했는가? (insert-template.js `run()` 이 자동 spawn)
- [ ] W1~W19 경고 결과를 사용자에게 보고했는가?
- [ ] 렌더 audit 결과(최저가/호텔/항공편 표시 여부)를 사용자에게 보고했는가?
- [ ] 경고가 있으면 자동 수정 가능한 것은 즉시 DB UPDATE 했는가? (meta 누락 / 과거 출발일 등)
- [ ] **[필수] audit_status=clean 상품은 Agent 가 `PATCH /api/packages/[id]/approve {action:'approve'}` 호출해 `status='active'` 활성화했는가?** (7-A 참조)
- [ ] **[필수] 활성화 후 DB에서 최종 결과값(status/price/판매 URL/A4 URL/출발일 수/호텔/항공편) 조회해 한 화면 리포트로 출력했는가?** (7-B 참조)
- [ ] **[필수] 방금 등록한 상품의 시각·텍스트 회귀 baseline 이 생성됐는가?** (7-D 참조 — dev 서버 켜져 있을 때만 자동 실행)
- [ ] audit_status=warnings 상품만 사장님께 "감사 리포트 확인 후 `force=true` 로 승인하시겠습니까?" 1회 질문. audit_status=blocked 는 수정 후 재감사 필수.

### 구현 메커니즘
1. `db/templates/insert-template.js` 의 `run()` 함수는 INSERT 후 자동으로 `post_register_audit.js` 를 spawn 실행한다 (이미 통합됨).
2. 신규 작성하는 모든 `db/insert_*.js` 스크립트는 main() 끝에 `spawnSync('node', ['db/post_register_audit.js', ...ids])` 를 포함해야 한다.
3. 환경변수 `SKIP_POST_AUDIT=true` 로만 스킵 가능 (CI/테스트 목적).

INSERT 완료 후 **반드시** 다음 순서로 자동 실행:

### 7-1. ISR 캐시 무효화
상품 UPDATE/INSERT 후 ISR 캐시를 즉시 무효화하여 모바일 랜딩 페이지가 1시간 대기 없이 바로 갱신되도록 함.
- API route (`/api/packages` POST/PATCH)에서 `revalidatePath` 자동 호출 — 이미 구현됨
- DB 직접 수정 스크립트라면: `curl POST /api/revalidate { paths: ["/packages/[id]"], secret: $REVALIDATE_SECRET }`

### 7-2. 원문 ↔ 렌더 엔터티 대조 감사
```bash
node db/audit_render_vs_source.js <방금 등록한 package_id>
```

이 감사가 자동으로 체크:
- 원문의 모든 **가격**(1,249,000 등)이 렌더에 표시되는가?
- 원문의 모든 **호텔명**이 렌더에 표시되는가?
- 원문의 모든 **관광지(▶ 항목)**가 렌더에 표시되는가?
- 원문의 모든 **항공편 번호**가 렌더에 표시되는가?
- 일차 수가 일치하는가?

### 7-3. AI 감사 (E5/E6) — **opt-in 전용** (W-final 2026-04-21 최종)

**기본 정책: Gemini 는 호출하지 않음.** 감사는 Agent Self-Audit (Step 6.5) 가 제로-코스트로 수행.
Gemini 는 **두 번째 의견이 필요할 때만** 사용자가 명시적으로 켜서 호출.

**ON 강제** (유료 호출 수반):
- `--ai` 또는 `POST_AUDIT_AI=1`
- 월 비용 캡 (`POST_AUDIT_AI_MONTHLY_CAP_KRW` 기본 5000원/월) 도달 시 자동 OFF

**OFF 기본**:
- 명시 안 하면 OFF. Agent self-audit + E1~E4 구조 감사 + RAG + 렌더 검증만 수행

**언제 Gemini 를 켜는가**:
- Agent self-audit 결과가 의심스러울 때 (외부 교차검증 필요)
- 신규 지역 첫 등록 후 품질 샘플링
- 사장님이 "AI 감사 켜서" 명시

**비용**:
- E5 (렌더 cross-check) — 상품 1건당 ~0.5원, 90초
- E6 (CoVe claim 검증) — 상품 1건당 ~0.3원, 5~10초
- 월간 누적은 [scratch/audit_ai_usage.json](scratch/audit_ai_usage.json)에 기록
- 80% 소진 시 경고, 100% 도달 시 자동 OFF

**E5 vs E6 차이**:
- **E5** (ai_audit_helper.js) — 원문 ↔ **렌더링 HTML** 전체 대조. "송영비 경고 증발" 같은 축약 잡음.
- **E6** (cove_audit.js) — 원문 ↔ **DB 필드별 claim** 하나씩. "2억 여행자보험" 같은 구체 환각 타겟.

**타겟 에러 (W3)**:
- ERR-20260418-01 (min_participants 템플릿 기본값)
- ERR-20260418-02 (notices_parsed 예시 축약)
- ERR-KUL-02/03 (DAY 교차 오염)
- ERR-FUK-insurance-injection ("2억 여행자보험" 환각)
- ERR-FUK-regions-copy (Day별 regions 복사)
- ERR-date-confusion (ticketing_deadline 오매핑)

### 7-D. 시각·텍스트 회귀 Baseline 자동 생성 (ERR-HET-visual-regression-infra@2026-04-22)

등록된 상품의 모바일 랜딩 페이지가 **다음 코드 변경 시 렌더 회귀**로 깨지지 않도록 playwright 기반 baseline 을 즉시 생성.

**자동 실행**: `insert-template.js` Step 7-D 가 `db/generate_visual_baseline.js` 호출.
1. `travel_packages` 에서 `short_code`, `title` 조회
2. `tests/visual/fixtures.json` upsert (product=short_code 기준 dedup)
3. `UPDATE_BASELINE=1 npx playwright test tests/visual --grep <short_code> --update-snapshots --workers=1`
4. baseline 파일 생성: `tests/visual/packages.spec.ts-snapshots/<product>-mobile-*.png` + `tests/visual/baselines/<product>-text.hash`

**실행 조건**:
- dev 서버(localhost:3000) 가 응답 중일 때만 실행 (2초 health check). 꺼져 있으면 자동 skip + 수동 재실행 안내.
- `SKIP_VISUAL_BASELINE=1` 로 명시적 스킵 가능.
- baseline 생성 실패가 등록 프로세스를 막지 않음 (status=active 유지).

**재발 방지 목적 — 오늘 호화호특에서 발견된 렌더 오류 시리즈**:
- ERR-HET-single-charge-misclass (싱글차지 "기간별 추가요금" 오분류)
- ERR-HET-attraction-global-dedup (관광지 카드 중복)
- ERR-HET-mobile-shopping-missing (모바일 쇼핑센터 섹션 누락)
- ERR-HET-a4-shortdesc-duplicate (A4 short_desc 반복)

baseline 있으면 위 오류들이 다음 코드 변경 시 **텍스트 해시/픽셀 차이** 로 자동 감지되어 회귀 차단.

**수동 실행** (dev 서버 재시작 후 등):
```bash
npm run dev  # 다른 터미널
node db/generate_visual_baseline.js <insertedId1> <insertedId2>
# 또는 전체 재생성
UPDATE_BASELINE=1 npm run test:visual -- --workers=1
```

---

### 7-4. 감사 게이트 (자동 blocking)

`post_register_audit.js` 결과에 따라 `audit_status` 자동 결정:
- **clean** (🟢): 즉시 승인 가능
- **warnings** (🟡): 어드민이 `force=true` 로 승인해야 고객 노출
- **blocked** (🔴): 수정 후 재감사 필수. 승인 API 자체가 409 반환

게이트 우회 불가:
- `/api/packages/[id]/approve` PATCH가 audit_status 체크
- 고객 노출 쿼리(`getApprovedPackages`, `/packages`, `/packages/[id]`)가 `audit_status.neq.blocked` 이중 가드

### 7-A. 자동 승인 (CLEAN 전용, MANDATORY) — **ERR-process-violation-auto-approve@2026-04-21**

**post-audit 결과 `audit_status === 'clean'` 인 모든 상품에 대해 Agent 가 즉시 수행.**
**`insert-template.js` run() 이 post-audit 성공 시 자동으로 `db/approve_package.js` 를 spawn** — Agent 별도 호출 불필요.

```bash
# insert-template.js 가 자동 실행하는 것 (수동으로는 이렇게):
node db/approve_package.js <id1> <id2> ...             # CLEAN 만 active 로 승격
node db/approve_package.js --force <id1> <id2> ...     # warnings 강제 승인
```

- **`db/approve_package.js` 는 Supabase 직접 UPDATE** → dev 서버(localhost:3000) 다운 중이어도 작동 (2026-04-21 호화호특 등록 시 사고 재발 방지).
- **(2026-04-22 보강 — ERR-process-violation-dump-after-approve)** `approve_package.js` 는 승격 성공 건에 대해 내부에서 자동으로 `dump_package_result.js` 를 spawn 해 **active 상태 풀덤프**까지 수행. Agent 가 `approve --force <ids>` 한 줄만 부르면 `UPDATE + 풀덤프` 가 원자적으로 끝남 — 별도 재덤프를 기억할 필요 없음. 우회: `SKIP_DUMP_RESULT=1`.
- **blocked** 상품은 자동으로 skip. 수정 → 재감사 → 재승인 수동 루프.
- **warnings** 상품은 기본 skip. 사장님에게 감사 리포트 핵심 3줄 요약 + `--force` 여부 1회 질문 후 재실행.
- `/api/packages/[id]/approve` REST 엔드포인트는 여전히 유효 (어드민 UI 에서 사용).

### 7-B. 최종 결과값 도출 (MANDATORY)

승인 후 DB 에서 방금 등록한 상품들의 **실제 판매 상태값**을 조회해 사장님이 한눈에 확인 가능하게 출력.

```sql
SELECT short_code, title, status, price, commission_rate,
       jsonb_array_length(price_dates) AS date_count,
       accommodations,
       itinerary_data->'meta'->>'flight_out' AS flight_out,
       itinerary_data->'meta'->>'flight_in'  AS flight_in,
       audit_status
  FROM travel_packages
 WHERE id IN (<inserted-ids>);
```

### 7-C. 최종 리포트 사용자에게 출력 (한 화면)

위 7-A, 7-B 를 마친 **후** 다음 형식으로 출력:

```
✅ 상품 등록·활성화 완료
   - 이번 경로: A (어셈블러 사용) / B-1 (수동 등록) / B (B-1 + B-2 어셈블러 자동 생성)
   - AI 감사: OFF (디폴트) / ON (POST_AUDIT_AI=1)

📦 판매 상태 (auto-approved)
   ┌────────────────┬───────────────┬────────┬──────────┬────────┬──────────────────┐
   │ short_code     │ 최저가        │ 출발일  │ 항공편    │ audit  │ status           │
   ├────────────────┼───────────────┼────────┼──────────┼────────┼──────────────────┤
   │ BA-TXN-04-01   │ 849,000원     │ 3건     │ BX3615   │ 🟢clean│ ✅ active (판매중)│
   └────────────────┴───────────────┴────────┴──────────┴────────┴──────────────────┘

🔗 고객 노출 URL
   - 모바일: http://localhost:3000/packages/<id>
   - A4 포스터: http://localhost:3000/admin/packages/<id>/poster

🔍 감사 결과 (E1~E4 + 렌더):
   ✅ prices · hotels · flights · days 전부 통과

💰 AI 감사 비용: 0원 / 5,000원 월캡 (E5 0회, E6 0회)
```

**사장님께 "어드민 가서 승인해주세요" 안내 금지.** 이미 Agent 가 승인 완료한 상태로 보고.
warnings 가 있는 경우에만 감사 리포트 요약 + `force=true` 여부 질문.

**다음 등록을 빠르게 만드는 한 줄 안내** (사장님이 알아야 함):
- 같은 지역 추가 등록 시 그냥 `/register`만 다시 부르면 됨 (Agent 자동 라우팅)
- 같은 원문 두 번 → 자동 SKIP (토큰 0)
- 의심 상품에만 AI 감사 켜기: `--ai` 또는 `POST_AUDIT_AI=1`

### 7-5. Visual Regression 베이스라인 (대표 상품만, 선택)
상품이 대표 상품 라인업에 포함되면 Playwright 스냅샷 추가:
1. `tests/visual/fixtures.json` 에 `{ id, title, product }` 항목 추가
2. `npm run test:visual:update` 한 번 실행하여 베이스라인 생성
3. 이후 코드/데이터 변경 시 `npm run test:visual` 자동 회귀 탐지

---

## 결정 이력

- **2026-04-27 — 출확인원 모순 시 본문 우선**: 원문 헤더 RMK 와 상품 본문이 충돌할 때 **상품 본문 기준으로 등록**. 헤더 RMK 는 카테고리 통합 표기로 부정확할 수 있고, 본문이 상품별 구체 조건이라 신뢰도 높음. (사장님 결정 / 케이스: 투어비 하노이 5종 — RMK "사파/크루즈 8명" vs 본문 사파·디너크루즈 "6명" → 본문 그대로 유지)

- **2026-04-27 — 유류할증료(N월) 표기 = 발권기한 조건부 포함**: 원문에 "유류할증료(4월)" + "4/29 발권조건" 처럼 월/날짜가 붙어 있으면 **발권기한 전 발권 시 가격 유효**, 발권기한 이후 출발은 유류세 인상분/인하분이 별도 반영된다는 의미. 표준 처리: ① `inclusions` 에 `"왕복항공+TAX+유류할증료(YYYY-MM-DD 발권 기준)"` 명시 ② `excludes` 에 `"유류세 인상분"` 추가 ③ `ticketing_deadline` 정확히 기재. 사장님 결정 / 케이스: W투어 나트랑 카탈로그 — "(4월)" 의 의미가 "4월 출발만 포함" 이 아니라 "4/29 발권 마감 기준" 임을 명확히 함.

- **2026-04-27 — 신규 랜드사는 사장님 입력대로 즉시 추가**: 사장님이 `"<랜드사> N%"` 형태로 입력했고 `db/land-operators.json` / `land_operators` 테이블에 없으면 **그 이름 그대로 신규 INSERT**. 단 (a) 사장님 명시 Y 후만 (b) 커미션은 입력값 그대로 (랜드사·상품별 다름) (c) 코드(2-letter) 자동 생성 (d) 이름 중복(W투어/더블유투어 등)은 **향후 사장님이 일괄 정리** — 랜드사는 하나로 매칭되어야 함. 사장님 결정 / 케이스: W투어 — 자동 INSERT 금지 룰 (Step 1.5-C) 은 유지하되, "사장님이 명시 입력했으면 그대로 추가" 가 디폴트 동작.

- **2026-04-27 — 호텔 등급 표기 정형화 (4 단일 표기)**: "특급"·"+5성"·"5성급"·"정5성" 같은 변형은 모두 오해 소지. 표준 표기 4종으로 단일화: **`"4성"` / `"준4성"` / `"5성"` / `"준5성"`** (3성/준3성도 표준에 포함, 총 6종). 원문 "(5성특급)" → `"5성"`, "4.5성" → `"준5성"` 로 정형화.

- **2026-04-27 — 호텔 등급 vs 룸타입 vs 호텔종류 컬럼 분리 (ERR-hotel-grade-roomtype-mixed)**: `hotel.grade` 에 **등급만** 저장. 룸타입(디럭스룸·슈페리어룸)·호텔종류(리조트·게르·크루즈)·숙박정보(2인1실·3박)·호텔명(Vansana LPQ)이 grade 에 섞여 있으면 안 됨. 분리 필드: ① `hotel.grade` (3성·준3성·4성·준4성·5성·준5성·null) ② `hotel.room_type` (디럭스룸 등 — 신규 필드, 임시 note) ③ `hotel.facility_type` (resort·ger·cruise·cabin — 신규 필드). 비표준 숙박(게르·크루즈)은 `grade=null` + `facility_type`. 사장님 지적 / DB 분포 조사 결과: 710건 중 81건(11%)이 룸타입·호텔종류·호텔명이 grade 에 잘못 저장됨 — 신규 등록부터 분리 적용, 기존 81건은 백필 백로그 (`db/backfill_hotel_grade_split.js`).

- **2026-04-27 — 매너팁/가이드/기사/여행자보험 불포함은 원문 verbatim**: 자유일정·에어텔 상품에서 다음 항목들은 원문 표기를 그대로 보존 (모순 아님): ① **매너 팁 불포함** = 고객 혼동 방지용 표기 (가이드 없어도 명시) ② **가이드 불포함** + **차량/기사 불포함** = 자유일정에서 따라다니는 인력이 없다는 의미 (리조트 셔틀 픽업과 별개) ③ **여행자보험 불포함** = 에어텔 상품 특성상 빠짐. Agent 가 "가이드 없는데 매너팁이 왜?" 같은 모순 의심하지 말 것 — 원문 그대로. 사장님 결정 / 케이스: W투어 나트랑 셀렉텀 노아 에어텔.

- **2026-04-27 — 새벽 출국 항공편은 정상 패턴**: 제5일 표기에 03:10 같은 새벽 출발 시간이 등장하면 **호텔 오전 체크아웃(전일) → 새벽 비행기 출국** 패턴. 일반적인 동남아 야간발 항공편 운항 — Agent 가 "제4일 자정 직후 아닌가?" 모순 의심하지 말 것. 일정표 표기는 **제5일 03:10 출발** 그대로 유지. 사장님 결정.
