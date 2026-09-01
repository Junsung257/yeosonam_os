# Step 1-b · Step 1.5 · Step 2.7 — 파싱·카탈로그 일관성·Pre-INSERT Self-Check

> **언제 읽는가**: SKILL.md 의 Step 1 / Step 1.5 / Step 2.7 안내에서 자세한 규칙·표준 표기·예시가 필요할 때.

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
