# Step 7 상세 — 등록 후 자동 감사 (구현 디테일)

> **언제 읽는가**: SKILL.md 의 Step 7 메타 규칙·자동 실행 체크리스트만으로 부족할 때 (audit 결과 해석, AI opt-in 정책, visual baseline, 7-A·7-B SQL 디테일).
>
> **메타 규칙·자동 실행 체크리스트·7-A·7-C 표준 출력 포맷은 SKILL.md 본문에 잔존**. 이 파일은 그 외 디테일.

## 7-1. ISR 캐시 무효화

상품 UPDATE/INSERT 후 ISR 캐시를 즉시 무효화하여 모바일 랜딩 페이지가 1시간 대기 없이 바로 갱신되도록 함.
- API route (`/api/packages` POST/PATCH)에서 `revalidatePath` 자동 호출 — 이미 구현됨
- DB 직접 수정 스크립트라면: `curl POST /api/revalidate { paths: ["/packages/[id]"], secret: $REVALIDATE_SECRET }`

## 7-2. 원문 ↔ 렌더 엔터티 대조 감사

```bash
node db/audit_render_vs_source.js <방금 등록한 package_id>
```

이 감사가 자동으로 체크:
- 원문의 모든 **가격**(1,249,000 등)이 렌더에 표시되는가?
- 원문의 모든 **호텔명**이 렌더에 표시되는가?
- 원문의 모든 **관광지(▶ 항목)**가 렌더에 표시되는가?
- 원문의 모든 **항공편 번호**가 렌더에 표시되는가?
- 일차 수가 일치하는가?

## 7-3. AI 감사 (E5/E6) — **opt-in 전용** (W-final 2026-04-21 최종)

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

## 7-D. 시각·텍스트 회귀 Baseline 자동 생성 (ERR-HET-visual-regression-infra@2026-04-22)

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

## 7-4. 감사 게이트 (자동 blocking)

`post_register_audit.js` 결과에 따라 `audit_status` 자동 결정:
- **clean** (🟢): 즉시 승인 가능
- **warnings** (🟡): 어드민이 `force=true` 로 승인해야 고객 노출
- **blocked** (🔴): 수정 후 재감사 필수. 승인 API 자체가 409 반환

게이트 우회 불가:
- `/api/packages/[id]/approve` PATCH가 audit_status 체크
- 고객 노출 쿼리(`getApprovedPackages`, `/packages`, `/packages/[id]`)가 `audit_status.neq.blocked` 이중 가드

## 7-A 추가 디테일 (자동 승인 메커니즘)

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

## 7-B. 최종 결과값 도출 SQL (MANDATORY)

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

## 7-5. Visual Regression 베이스라인 (대표 상품만, 선택)

상품이 대표 상품 라인업에 포함되면 Playwright 스냅샷 추가:
1. `tests/visual/fixtures.json` 에 `{ id, title, product }` 항목 추가
2. `npm run test:visual:update` 한 번 실행하여 베이스라인 생성
3. 이후 코드/데이터 변경 시 `npm run test:visual` 자동 회귀 탐지
