# 사고 로그 (Incident Log)

> **목적**: 사장님이 production 에서 발견한 사고를 영구 박제. 다음 세션이 자동으로 회피 (CLAUDE.md 에서 import 권장).
> **GEPA 패턴 (Latitude 2026)**: production failure → 자동 test case 박제.
>
> **사장님 사고 발견 시 박제 의무 3종:**
> 1. 이 파일에 사고 entry append (입력/증상/진단/박제 commit)
> 2. vitest 회귀 케이스 (input/expected output)
> 3. (해당 시) E2E fixture (패키지 ID + 매칭률 baseline)
>
> **읽는 시점**: 신규 등록 코드 작성 / 매칭 로직 변경 / fail-soft 패턴 박제 직전 의무 Read.

---

## 사고 #2026-05-15-KWL — 계림/양삭 등록 (PR #75 박제)

**증상:**
- 자동 시드 14/15건 실패 (Wikidata 한/영 + LLM short generate 모두 fail)
- "맛집" 단독 attraction 시드 + photos 자동 attach (사장님 모바일에 "맛집" 카드)
- 17 schedule item 미매칭 (상비산·정강왕성·이강유람선·은자암·여의봉·월량산·우용하뗏목·발마사지 등)
- "산수간쇼" 가 "인상·유삼제 산수 실경 공연" 으로 잘못 fuzzy 매칭

**원본 입력 (회귀 fixture):**
- 등록 텍스트: 인천/계림/양삭 3박5일/4박6일 패키지 (LJ883/LJ884)
- 일정 라인 예: "▶맛집/카페/옷가게가 즐비한 계림의 명동 동서항(옛거리)"
- 일정 라인 예: "▶아름다운 산수와 소수민족의 문화를 배경으로한 서커스 산수간쇼"
- 일정 라인 예: "▶여행의 피로를 풀어주는 발마사지 체험(60분/팁포함)"

**근본 진단:**
1. **extractAttractionCandidates STOP_WORDS 미적용** — split 결과 "맛집" 단독이 후보로 통과
2. **시드 fallback 부재** — LLM short generate 실패 시 시드 0건 (silent fail)
3. **fuzzy 매칭 length-guard 없음** — 4자 키워드 vs 13자 candidate 부적합 매칭 통과

**박제 (PR #75 2cb1472):**
- F1: `STANDALONE_STOP_WORDS` 40+ 일반어 차단
- F2: `generateGenericShortDesc` 최후 템플릿 fallback (`{dest}의 관광 명소 {name}.`)
- F3: fuzzy matcher length ratio > 2.0 차단
- F4: Supabase MCP — 누락 17 attraction 수동 시드
- F5: "맛집" attraction `is_active=false`

**회귀 fixture:**
- `src/lib/itinerary-attraction-candidates.test.ts` — "맛집/카페/옷가게..." → ['동서항'] only
- 패키지 ID 회귀 monitor: `3a136d76-79c0-44f2-aa1a-8e8d4cbdb12a` (3박5일), `f54cc782-9f13-46dd-ba0b-97c05f2086be` (4박6일)

---

## 사고 #2026-05-14-NHT — 도멘 드 마리 성당·다딴라 폭포 미매칭 (PR #69 박제)

**증상:** [LJ] 나트랑/달랏 모바일에서 도멘 드 마리 성당·다딴라 폭포·린푸억사원·롱손사·나트랑대성당 카드 미표시

**근본 진단:**
1. `page.tsx` OR clause 가 한글 country 만 검색 — ISO 정규화 후 country='VN' attraction 못 fetch
2. attractions region/country null — fetch 자체 누락
3. 일부 attractions 중복 row (도멘 드 마리 성당 vs 도멘드마리)

**박제 (PR #69 e4762f6):**
- DB trigger `fn_attractions_normalize` — country 한글→ISO 자동 (27개국)
- `destination-iso.ts` SSOT 67도시
- `extractAttractionCandidates` 30→60자 + 괄호 별칭
- Same-Session Seed-Reflect — 시드 후 enrichItinerary 재실행 + UPDATE + revalidatePath
- Supabase MCP — region/country null 보정

**회귀 fixture:** `src/lib/destination-iso.test.ts` — '도멘 드 마리 성당' 케이스 명시

---

## 사고 #2026-05-13-BUS — 부관훼리 신뢰도 100% 거짓 신호 (PR #68 박제)

**증상:** 신뢰도 100% 보고했는데 5월 7~14일 출발일 누락, schedule DAY 한 덩어리, ferry 가 항공 카드로 렌더링

**근본 진단:**
1. 가격표 정규식이 같은 요일 그룹 연속 (date, price) 쌍 미처리
2. schedule activity 가 한 줄 합쳐짐 — ▶ split 부재
3. ferry 키워드 미감지 — airline 으로 추출

**박제 (PR #68 ca021a6):** Hybrid Extraction v2 + FACE (price-table pendingDow 박제 + schedule cleanSchedule + ferry-classifier)

---

## 사고 #2026-05-12-PUQ — 푸꾸옥 customer_notes leak (PR #65 박제)

**증상:** `special_notes` 에 커미션/투어비 leak 남아 고객 노출

**박제 (PR #65 e138c73):** Customer-Leak Sanitizer + W22-tone/hero 검증 + seasonal KEYWORD_MAP SSOT

---

## 사고 추가 시 템플릿

```markdown
## 사고 #YYYY-MM-DD-CODE — 한 줄 제목 (PR #N 박제)

**증상:** (사장님 발견 + 모바일/어드민 화면 묘사)

**원본 입력 (회귀 fixture):** (재현 가능한 텍스트/패키지 ID/일정 라인)

**근본 진단:** (1~3개 root cause)

**박제 (PR #N commit):** (박은 처방 bullet)

**회귀 fixture:** (vitest 파일 + expected output / E2E 패키지 ID)
```

---

## 회귀 monitor 대상 패키지 ID (G6 cron 박제 후 자동 fetch)

매주 모바일 페이지 fetch → 매칭률 측정 → 임계치 미달 시 admin_alerts:

- `3a136d76-79c0-44f2-aa1a-8e8d4cbdb12a` — 인천/계림/양삭 3박5일 (KWL 사고 baseline)
- `f54cc782-9f13-46dd-ba0b-97c05f2086be` — 인천/계림/양삭 4박6일 (KWL 사고 baseline)
- (나트랑/달랏 / 푸꾸옥 / 부관훼리 패키지 ID 추가 필요)

---

> **갱신 규칙:** 사장님 사고 발견 시 즉시 entry append. patch commit hash 기재. CLAUDE.md 의 강제 진입점에 이 파일 추가 권장.
