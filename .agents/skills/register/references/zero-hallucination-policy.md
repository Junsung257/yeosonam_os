# 🚨 Zero-Hallucination Policy (AI 파싱 절대 준수 규칙)

> **언제 읽는가**: `/register` 호출 후 원문 파싱·정규화 단계에서 SKILL.md 가 안내하면 진입.
> 이 절은 register skill 의 가장 큰 단일 절(497줄)로, SKILL.md 본문에서 분리된 reference 파일이다.

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
