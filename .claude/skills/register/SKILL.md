---
name: register
description: 통합 상품 등록 — 원문 + 랜드사·마진 입력으로 INSERT부터 자동 감사·자동 승인·결과 리포트까지 7단계 풀 파이프라인. 정확도를 위해 Sonnet 강제, 사용자 명시 호출만 (자동 invocation 차단).
argument-hint: [원문 텍스트] [랜드사코드 마진율%]
model: claude-sonnet-4-6
disable-model-invocation: true
---

# 통합 상품 등록 (orchestration)

> **[자동 설정]** 이 커맨드는 파싱 정확도와 데이터 무결성을 위해 **Sonnet 4.6**으로 자동 처리됩니다.
> 사용자는 모델을 선택할 필요가 없습니다. `/register` 호출 → 자동 Sonnet 사용.

사용자가 입력한 원문과 랜드사/마진 정보입니다:

$ARGUMENTS

---

## 📋 최근 정책·결정 이력 → [`docs/register-changelog.md`](../../../docs/register-changelog.md)

> **읽는 방식**: 본 등록 작업이 아래 카테고리 중 하나에 해당하면 해당 changelog 항목을 점프-리드.
>
> - `special_notes` / `customer_notes` / `internal_notes` 분기 → P0~P1 #1
> - audit_status 4단계 (`blocked`/`warnings`/`info`/`clean`) → P0~P1 #2
> - 추가요금 통화 (KRW/USD/JPY/CNY) → P0~P1 #3
> - 정액 마진 (`commission_fixed_amount`) → P0~P1 #4
> - `product_highlights` 정렬 → P0~P1 #5
> - 점수 시스템 v3 (`package_scores` 자동 박힘) → P0~P1 #6
> - 호텔 등급/룸타입/시설 분리, 헤더 RMK vs 본문 모순, 새벽 출국 패턴 등 케이스별 사장님 결정 → "결정 이력" 섹션

---

## 📚 보조 자료 (references/) — 필요할 때만 Read

이 SKILL.md 는 호출당 매번 진입한다. 아래 references 는 **필요한 단계에서만 Read** 해서 토큰을 아낀다.

| reference | 언제 Read | 줄 수 |
|---|---|---|
| [`references/zero-hallucination-policy.md`](references/zero-hallucination-policy.md) | 원문 파싱·정규화 단계, 환각 의심 발견 시 | ~497 |
| [`references/parsing-rules.md`](references/parsing-rules.md) | Step 1-b inclusions verbatim, Step 1.5 카탈로그 일관성, Step 2.7 Pre-INSERT self-check 디테일 | ~256 |
| [`references/region-and-ir-pipe.md`](references/region-and-ir-pipe.md) | IR 파이프 엔진 결정 (direct/gemini/claude), 신규 지역 부트스트랩 | ~74 |
| [`references/routing-and-assembly.md`](references/routing-and-assembly.md) | 어셈블러 존재 여부·N=3 임계값·경로 A/B-1/B-2 상세 흐름 | ~106 |
| [`references/agent-self-audit.md`](references/agent-self-audit.md) | Step 6.5 self-audit 프로토콜·출력 JSON 형식·판정 액션 | ~91 |
| [`references/post-register-audit.md`](references/post-register-audit.md) | Step 7-2~7-5 디테일 (audit cmd, AI opt-in, visual baseline, SQL) | ~165 |

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

1. `db/error-registry.md` — 누적된 오류 이력 (상단 ACTIVE CHECKLIST 최근 10건)
2. `.claude/commands/manage-attractions.md` — **관광지 처리 가이드 (MUST READ)**
3. `.claude/CLAUDE.md` 섹션 0 — Zero-Hallucination Policy

## 🚫 관광지 자동 시드 금지 (ERR-20260418-33)

**이미 완전한 관광지 관리 파이프라인이 존재합니다.** 새로 만들지 마세요.

- ❌ `db/seed_XXX_attractions.js` 같은 임시 시드 스크립트 생성 금지
- ❌ Agent가 AI로 short_desc/long_desc 생성해서 DB INSERT 금지
- ❌ 상품 등록 중 관광지 자동 생성 금지
- ✅ 매칭 실패한 관광지는 **자동으로 `unmatched_activities`에 플래그만 찍고 종료**
- ✅ 사용자가 `/admin/attractions/unmatched` 페이지에서 수동 처리 (CSV 다운로드 → 외부 편집 → CSV 업로드)

---

## 🚨 Zero-Hallucination Policy

상세 규칙은 [`references/zero-hallucination-policy.md`](references/zero-hallucination-policy.md) (497줄). 핵심만 본문 잔존:

- **숫자 1:1 매핑**: "10명 이상" → `min_participants: 10` (템플릿 기본값 4 금지). 명시 없으면 `null`.
- **예시 목록 축약 금지**: 괄호 안 항목 모두 보존. "등"으로 대체 금지.
- **Quote > Summary**: 의심스러우면 원문 verbatim.
- **금액·등급 주입 금지**: 원문 "여행자보험" → DB "여행자보험" (절대 "2억" 추가 금지).
- **regions Day별 1:1 매핑**: 다른 Day의 regions 복사 금지.
- **excluded_dates ∩ surcharges 교집합 금지**: 출발 불가 + 추가요금은 모순.
- **schedule.activity = 원문 verbatim**: 랜드사 표기 보존, attractions.aliases 가 매칭 흡수.
- **DAY 교차 오염 방지**: 한 원문에 여러 상품(3박5일+4박6일) 공존 시 각 상품 블록 독립 파싱.

세부 규칙(3-1~3-12, 4, 4-1, 5, 6, validatePackage 경고 매핑 등)은 references 진입.

---

## Step 1: 입력 파싱

사용자 입력에서 추출:
- **랜드사명** + **마진율%** (예: "투어폰 9%")
- **발권기한** (있으면 YYYY-MM-DD)
- **원문 본문** (나머지 전체)

inclusions verbatim 강제 규칙·insert-template helpers 패턴은 [`references/parsing-rules.md`](references/parsing-rules.md) "Step 1-b" 절.

---

## Step 1.5: 카탈로그 일관성 사전 검증

**핵심 5가지 self-check** (1개라도 실패 시 등록 중단 → 사장님 확인):
- A. 항공편 정체성: 원문 내 항공사 코드 종류 ≤ 1
- B. 가격표 출처: 가격표 인접 8줄 내 항공/호텔 라벨 일관
- C. 랜드사 등록: `land-operators.json` 존재 (없으면 사장님 명시 입력 시 그대로 추가)
- D. 발권/적용기간: 발권기한이 적용기간 안에 포함
- E. 호텔 등급: 표준 7종 (`3성`/`준3성`/`4성`/`준4성`/`5성`/`준5성`/`null`) 정형화

상세 (1.5-A~1.5-Z, room_type/facility_type 분리, false positive 제외)는 [`references/parsing-rules.md`](references/parsing-rules.md) "Step 1.5" 절.

---

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

IR 파이프 (direct/gemini/claude 엔진 선택)는 [`references/region-and-ir-pipe.md`](references/region-and-ir-pipe.md).

---

## Step 2.7: Pre-INSERT Self-Check (W26~W29 재실행 방지)

`inserter.run(packages)` **직전** 5개 self-check (인라인 코드 블록은 [`references/parsing-rules.md`](references/parsing-rules.md) "Step 2.7" 절):

1. W26 — inclusions 콤마 포함 단일 문자열 금지
2. W27 — 하루 flight 여러개면 반드시 `→` 토큰
3. W28 — "호텔 투숙/휴식" 앞절 붙이기 금지
4. W29 — notices_parsed PAYMENT 에 "출발N일전" 경계 재확인
5. raw_text >= 50자 + raw_text_hash 동반

---

## Step 3: 라우팅 (3분기 자동 판단)

> **🟢 사장님 안내**: `/register` 만 부르면 Agent가 자동 분기. 어셈블러 호출법을 외울 필요 없음.

빠른 결정 표:

| 조건 | 경로 |
|---|---|
| `db/assembler_<region>.js` 존재 (XIY/TAO/DAD/BHO) | **경로 A** (어셈블러 즉시 실행, ~90% 토큰 절감) |
| 어셈블러 없음 + 해당 지역 상품 ≤ 2개 | **경로 B-1** (insert-template 만) |
| 어셈블러 없음 + 해당 지역 상품 ≥ 3개 (이번이 3번째 포함) | **경로 B (B-1 + B-2 어셈블러 자동 부트스트랩)** |
| 동일 랜드사+destination+product_type+duration+가격+마감 일치 | **자동 SKIP** (토큰 0) |

상세 흐름 (3-0 어셈블러 명령·BHO 사용 패턴·B-2 부트스트랩 보고 포맷)은 [`references/routing-and-assembly.md`](references/routing-and-assembly.md).

---

## 중복 방어 (모든 경로 자동)

- **어셈블러 경로**: `insertToDB()`에 내장된 중복감지 (destination + product_type + duration)
- **insert-template.js 경로**: `findDuplicate()` + `isSamePrice()` + Zod 검증
- 완전 동일 → **SKIP** (토큰 소모 없이 즉시 종료)
- 가격/기한 변경 → 기존 **archived** + 신규 등록

## 검증 (모든 경로)

INSERT 전에 `insert-template.js` 의 `validatePackage()` 자동 실행:
- price_dates: YYYY-MM-DD 형식 + 양수 가격 + 최소 1개
- itinerary_data.days: 최소 1일 + day >= 1
- schedule[].activity: 빈 문자열 금지
- schedule[].type: 'transport' 금지 (TransportBar 크래시)
- highlights.remarks: string[] 강제 (객체 배열 금지)
- **[W-final F3]** raw_text 50자 이상 + raw_text_hash 일치 강제 (ERROR — INSERT 차단)

---

## 🧠 Step 6.5: Agent Self-Audit (MANDATORY, 제로-코스트)

> 외부 API (Gemini) 호출 없이 Agent 본인이 self-audit. 확증 편향 방지를 위해 **raw_text verbatim 인용 + CoT 강제**.

**필수 검증 필드** (각각 raw_text 인용 → CoT → supported 판정):
- `min_participants` (HIGH) / `ticketing_deadline` (HIGH) / `inclusions` 금액·등급 토큰 (CRITICAL)
- `surcharges` 기간+금액 (HIGH) / `notices_parsed` PAYMENT (CRITICAL)
- `itinerary_data.days[i].regions` (HIGH) / `optional_tours[]` region 정합 (MEDIUM)

**판정 → 액션**:
- 모두 supported → `clean` → 바로 INSERT
- CRITICAL `false` 1+ → `blocked` → INSERT 중단·재파싱
- HIGH `false` → `warnings` → INSERT 진행 + post-audit 가 warnings 승격

출력 JSON 형식·구현 메커니즘·금지 사항은 [`references/agent-self-audit.md`](references/agent-self-audit.md).

---

## 🚨🚨🚨 Step 7: 등록 후 자동 감사 (**MANDATORY — 절대 생략 금지**)

### 메타 규칙 (ERR-process-violation + ERR-process-violation-auto-approve@2026-04-21)

> **사용자가 명시적으로 지시하지 않아도, INSERT 성공 즉시 반드시 `post_register_audit.js` 를 실행하고,
> `audit_status=clean` 이면 자동으로 approve API 까지 호출해 `status='active'` 활성화 + 최종 결과값 도출까지 완수**한다.
>
> **"어드민에서 직접 승인하세요" / "나중에 하세요" / "수동 단계" 안내 금지. 모든 단계를 Agent 가 완수한다.**
>
> **사장님은 원문만 붙여넣는다. 등록-감사-승인-결과값 전부 Agent 책임.**
>
> **이 규칙 위반 시 ERR-process-violation* 계열로 error-registry.md 에 기록.**

### 자동 실행 체크리스트 (Agent self-check — 전부 수행 필수)

- [ ] INSERT 성공 직후 `node db/post_register_audit.js <inserted-id-1> <inserted-id-2> ...` 호출했는가? (insert-template.js `run()` 이 자동 spawn)
- [ ] W1~W19 경고 결과를 사용자에게 보고했는가?
- [ ] 렌더 audit 결과 (최저가/호텔/항공편 표시 여부) 를 사용자에게 보고했는가?
- [ ] 경고가 있으면 자동 수정 가능한 것은 즉시 DB UPDATE 했는가? (meta 누락 / 과거 출발일 등)
- [ ] **[필수] audit_status=clean 상품은 Agent 가 `PATCH /api/packages/[id]/approve {action:'approve'}` 호출해 `status='active'` 활성화했는가?** (7-A)
- [ ] **[필수] 활성화 후 DB에서 최종 결과값(status/price/판매 URL/A4 URL/출발일 수/호텔/항공편) 조회해 한 화면 리포트로 출력했는가?** (7-B)
- [ ] **[필수] 방금 등록한 상품의 시각·텍스트 회귀 baseline 이 생성됐는가?** (7-D — dev 서버 켜져 있을 때만 자동 실행)
- [ ] audit_status=warnings 상품만 사장님께 "감사 리포트 확인 후 `force=true` 로 승인하시겠습니까?" 1회 질문. audit_status=blocked 는 수정 후 재감사 필수.

### 구현 메커니즘

1. `db/templates/insert-template.js` 의 `run()` 함수는 INSERT 후 자동으로 `post_register_audit.js` 를 spawn 실행 (이미 통합됨).
2. 신규 작성하는 모든 `db/insert_*.js` 스크립트는 main() 끝에 `spawnSync('node', ['db/post_register_audit.js', ...ids])` 를 포함해야 함.
3. 환경변수 `SKIP_POST_AUDIT=true` 로만 스킵 가능 (CI/테스트 목적).

### 7-A. 자동 승인 (CLEAN 전용, MANDATORY)

`audit_status === 'clean'` 인 모든 상품에 대해 Agent 가 즉시 수행. `insert-template.js run()` 이 post-audit 성공 시 자동으로 `db/approve_package.js` spawn — **Agent 별도 호출 불필요**. blocked 는 수정 후 재감사. warnings 는 사장님에게 force 여부 1회 질문.

상세 (Supabase 직접 UPDATE, dump_package_result 자동 spawn, --force 사용법)는 [`references/post-register-audit.md`](references/post-register-audit.md) "7-A" 절.

### 7-C. 최종 리포트 사용자에게 출력 (한 화면 — 표준 포맷)

위 7-A, 7-B 를 마친 후 **반드시** 다음 형식으로 출력:

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
- 같은 지역 추가 등록 시 그냥 `/register` 만 다시 부르면 됨 (Agent 자동 라우팅)
- 같은 원문 두 번 → 자동 SKIP (토큰 0)
- 의심 상품에만 AI 감사 켜기: `--ai` 또는 `POST_AUDIT_AI=1`

### Step 7 디테일 (필요시 진입)

- 7-1 ISR 캐시 무효화 / 7-2 audit_render_vs_source / 7-3 AI 감사 (E5/E6) opt-in / 7-D Visual Baseline / 7-4 게이트 / 7-5 Visual Regression 베이스라인 → [`references/post-register-audit.md`](references/post-register-audit.md)

---

## 결정 이력 → [`docs/register-changelog.md`](../../../docs/register-changelog.md)

신규 사장님 결정 발생 시 register-changelog.md에 append. 본문에 직접 적지 말 것.
