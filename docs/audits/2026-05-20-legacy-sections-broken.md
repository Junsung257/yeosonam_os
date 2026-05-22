# 2026-05-20 — 후쿠오카 도스 다색골프 사고 + 진짜 ROOT CAUSE (코드베이스 증거)

> **발견 계기**: 사장님이 "후쿠오카 도스 다색골프" (`32477b61-dbd9-459b-86dc-0fdf5331684c`)
> 어드민 검토 큐에서 C6/C11 워닝 + 신뢰도 65% + 모바일 404 확인.
>
> **사장님 핵심 질문**: PR #99~#133 (2026-05-13~05-19) 에서 section LLM hierarchy / audit
> auto-refresh / revalidate-helper / admin_alerts 가시화를 모두 박았는데 왜 또 같은 사고?
>
> **코드베이스 증거 기반 진단**: 박힌 인프라는 작동했다 (admin_alerts #14 에 정확히 적재됨).
> 문제는 **4개의 진짜 root cause** 가 박은 인프라를 우회한 것. 추측 아닌 코드 라인 증거 첨부.

## 1. 단일 패키지 정정 결과 (이 세션 완료)

| 필드 | 변경 전 | 변경 후 |
|------|---------|---------|
| display_title | "후쿠오카 도스 다색골프" | "후쿠오카 도스 다색골프 54H 2박3일" |
| hero_tagline | NULL | "후쿠오카 54H 골프 2박3일" |
| product_summary | "3일 후쿠오카 여행" (빈약) | "후쿠오카 도스 지역 6개 골프장 중 1곳에서 54홀 라운딩..." |
| inclusions | "골프비용(그린피", "전동카트피)" (괄호 깨짐) | "골프비용(그린피, 전동카트피)" (보존) |
| excludes | **176건 (원문 절반 콤마 split + "랜드부산 9%" 커미션 누출)** | **6건, 커미션 제거** |
| notices_parsed | 3건 | 24건 (취소규정/일본공휴일/체크인 시간 포함) |
| price_dates | 0건 | 118건 (5/1~8/31 매트릭스 expand, 항공제외 5일 제외, 스팟특가 6/16·7/14 포함) |
| departure_days | NULL | "매일" |
| audit_status | warnings | **clean** |
| audit checks | C6 warn, C11 stale | C4/C5/C6/C11 모두 pass |

**해결 경로**:
1. 신규 admin endpoint `POST /api/admin/packages/[id]/backfill-sections` 작성.
2. `backfillSectionsByPackageId(id, { force: true })` 호출 → hero + notices 재추출 성공.
3. price_dates 는 LLM 실패 (원문이 "기간×요일 매트릭스" — 표준 4-라인 regex/few-shot 미지원 패턴).
4. deterministic SQL UPDATE 로 매트릭스 expand (5/1~8/31 일자별 + 항공제외 + 스팟특가 반영).
5. `refreshOnly: true` 옵션으로 audit refresh + dev/prod revalidate 동시 호출.

## 2. 시스템 차원 진단 (368 패키지 전수)

| 결함 패턴 | 건수 | raw_text 보유 | backfill 자동 가능 |
|----------|-----|--------------|------------------|
| price_dates 0건 | 31 | 31 (전부) | force=false 로 자동 (LLM 실패 시 manual) |
| display_title NULL | 210 | — | force=false 자동 |
| hero_tagline NULL | 223 | — | force=false 자동 |
| excludes 50건+ broken | 2 | 2 | **force=true** 필요 (manual review) |
| audit_status='warnings' | 64 | — | refresh 후 일부 해소 |

**가장 위험한 패턴**: excludes 100건+ broken — 원문 통째 콤마 split + 커미션/내부 메모 누출 위험.
`db/FIELD_POLICY.md` 위반 → 즉시 진단 필요.

## 2.5 ★ 진짜 ROOT CAUSE 4종 (코드베이스 증거)

### RC1 — 옛 deterministic fallback 코드가 살아있음 (가장 큰 범인)

**파일**: [src/lib/parser.ts:941-949](src/lib/parser.ts#L941-L949)

```js
const inclusionsSection = text.match(/포함.*?(?=불포함|$)/is);
if (inclusionsSection) {
  data.inclusions = inclusionsSection[0].split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 2 && !s.includes('포함'));
}
const excludesSection = text.match(/불포함.*?(?=선택관광|$)/is);
if (excludesSection) {
  data.excludes = excludesSection[0].split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 2 && !s.includes('불포함'));
}
```

**증상**:
- `/불포함.*?(?=선택관광|$)/is` — "선택관광" 헤더 없는 패키지(골프/단순 패키지) 에서 **EOF까지 통째 매치**.
- `.split(/[,\n]/)` — 괄호/숫자 콤마 보호 안 함 → "골프비용(그린피, 전동카트피)" 가 2개로 깨짐, 가격 표 "1,209,000" 도 콤마 split 위험.
- 필터 `length > 2` 만 → 원문 절반 (제1일 일정, 취소규정, "랜드부산 9%" 커미션) 모두 흡수.
- **결과: 후쿠오카 도스 다색골프 inclusions/excludes 178건 + 커미션 누출.**

**왜 안 잡혔는가**:
새 `extractBullets` ([src/lib/parser/deterministic/bullets.ts](src/lib/parser/deterministic/bullets.ts)) 가 PR #80 (2026-05-14) 박혔는데 — **옛 코드를 안 지웠다**. 두 경로가 공존하며 LLM 산출이 어떻든 옛 코드가 ed.inclusions/ed.excludes 를 한 번 채우면, [src/app/api/upload/route.ts:914-921](src/app/api/upload/route.ts#L914-L921) 의 `extractBullets fallback` 은 `if length === 0` 가드 때문에 건너뜀.

### RC2 — backfill 게이트가 품질 검증 없이 길이만 봄

**파일**: [src/lib/parser/llm/section-extractors.ts:439-440](src/lib/parser/llm/section-extractors.ts#L439-L440)

```ts
const noticesNeeded = force || !Array.isArray(p.inclusions) || (p.inclusions as unknown[]).length === 0 ||
  !Array.isArray(p.notices_parsed) || (p.notices_parsed as unknown[]).length === 0;
```

**증상**:
- RC1 이 만든 깨진 176건도 `length === 0` 이 아니므로 "이미 채워짐" 판정.
- backfill 호출되어도 `notices: { applied: false, reason: 'already-filled' }` 반환 (admin_alerts #14 meta 와 정확히 일치).
- 자동 복구 경로 없음 → force=true 어드민 트리거 어제까지 부재 (이번 세션에 backfill-sections endpoint 신규 추가).

### RC3 — extractPriceTableWithLLM 매트릭스 패턴 미지원

**증상**:
- admin_alerts #14 `meta.price.reason = 'no-rows-extracted'` — LLM 이 0행 반환.
- 후쿠오카 도스 다색골프 원문은 "기간 헤더 → 요일 라벨 → 가격" 매트릭스 (표준 4-라인 "일자/가격/일자/가격" 아님).
- 현 LLM prompt/few-shot 이 매트릭스 패턴 미학습 → C6 warn.
- deterministic L1 extractor 도 매트릭스 미지원 (현 `extractPriceTable` 은 4-라인 표준만).

### RC4 — admin_alerts 가시화는 박혔지만 검토 큐와 분리됨

**파일**: [src/app/admin/alerts/page.tsx](src/app/admin/alerts/page.tsx) (PR #133, 2026-04-30)

**증상**:
- admin_alerts #14 `register-backfill / warning / "sections backfill 부분 실패"` 정확히 박혔다.
- 하지만 **사장님 동선은 검토 큐(`/admin/packages/...`)이고 알림은 별도 페이지(`/admin/alerts`)**.
- 검토 큐 row 는 `audit_status` 만 표시 → "warnings" 라고만 보임 → 사장님은 C6/C11 warn 만 보고 alert #14 의 silent 결함(notices already-filled, price no-rows) 못 봄.
- 결과: 박힌 가시화 인프라가 사장님 화면에 도달 못 함.

---

## 3. 근본해결 플랜 (사장님 결정 대기) — V2 (RC1~RC4 매핑)

### A. 즉시 가능 (이 세션 도구로 자동 실행)

| # | 작업 | RC | 비용 | 위험 | 사장님 결정 |
|---|------|----|------|------|------------|
| A1 | 31 패키지 (price_dates=0) `force=false` bulk backfill | RC3 | ~$0.005×31 = **$0.15** | 낮음 — NULL/0건만 채움 | ☐ Y/N |
| A2 | 2 패키지 (excludes 100+ broken) `force=true` 개별 backfill | RC1+RC2 | ~$0.005×2 = **$0.01** | 중간 — 깨진 inclusions/excludes 덮어씀 | ☐ Y/N |
| A3 | 어드민 검토 큐 64건 audit refresh-only 일괄 (stale snapshot 정정) | RC4 | $0 | 낮음 | ☐ Y/N |

### B. 별도 PR 필요 (RC1~RC4 영구 차단)

| # | 작업 | RC | 위치 | 영향 |
|---|------|----|------|------|
| **B0** ★ | **parser.ts:941-949 옛 deterministic fallback 코드 DELETE** + extractBullets 가 SSOT임을 주석/테스트로 박제. parser.ts 의 `data.inclusions = ...split([,\n])` 와 `data.excludes = ...` 두 블록을 잘라내고 extractBullets 만 남김 | **RC1** | `src/lib/parser.ts:941-949` | 모든 신규 등록에서 콤마 split 폭주 + 커미션 누출 영구 차단. **이 한 줄이 가장 큰 효과.** |
| B0-test | 회귀 fixture: 후쿠오카 도스 다색골프 원문 + 같은 패턴 (선택관광 섹션 없음 + 콤마 나열) 3건. inclusions/excludes 가 정상 6건 이하인지 assertion | RC1 | `tests/fixtures/no-optional-tours/`, `tests/parser/bullets.spec.ts` | 같은 사고 재발 0% |
| **B2** ★ | backfill `noticesNeeded` 게이트에 **품질 검증** 추가 — `inclusions.length > 20 && every(item => item.length < 30)` 같은 콤마-split 시그니처 감지 시 force=true 자동 동작 | **RC2** | `src/lib/parser/llm/section-extractors.ts:439-440` | RC1 잔존 옛 등록물이 새 backfill 자동 통과. 길이만 보는 게이트 영구 강화 |
| B1 | 어드민 검토 큐 row 에 **"Section 재추출" 버튼** + admin_alerts (register-backfill) **인라인 노출** | **RC4** | `src/app/admin/packages` 검토 큐 컴포넌트 + `/api/admin/packages/[id]/backfill-sections` (이번 세션 박힘) | 사장님이 1-click 으로 같은 사고 즉시 수정 가능. /admin/alerts 별도 페이지 가지 않아도 됨 |
| B3 | **매트릭스 deterministic L1 extractor** — `extractPriceMatrix(rawText)` 신규 함수. 기간 헤더 + 요일 라벨 + 가격 grid 인식 → 일자별 expand | **RC3** | `src/lib/parser/deterministic/price-matrix.ts` (신규) | LLM 호출 없이 매트릭스 100% 정확. 토큰 0. 골프/매트릭스 가격 패키지 자동 처리 |
| B4 | `extractPriceTableWithLLM` few-shot 에 **매트릭스 패턴** 추가 (B3 의 LLM fallback) | RC3 | `src/lib/parser/llm/price-table.ts` | B3 가 못 잡는 변형 매트릭스도 LLM 보완 |
| B5 | bulk backfill cron — 매일 1회 `price_dates IS NULL OR length=0` 30개씩 자동 backfill | RC3 | `src/app/api/cron/legacy-sections-backfill/route.ts` (신규) | 옛 등록물 자동 정리, $0.005/패키지 |

### C. 정책 박제 (CLAUDE.md/error-registry)

- **ERR-legacy-fallback-shadowed-new-extractor (2026-05-20)** — `db/error-registry.md` 신규 항목.
  교훈: 새 deterministic extractor (`extractBullets`) 박을 때 옛 fallback 코드 (`parser.ts:941-949`)
  를 DELETE 안 하면 옛 코드가 새 코드 산출을 덮어쓰거나 우선 적용됨. **새 모듈 박을 때 옛 경로 검색→삭제 의무**.
- **CLAUDE.md §12-3 보강**: "정보 추출 hierarchy 박을 때 옛 fallback 경로 grep + DELETE 의무.
  공존 = 옛 코드가 silently 이김." 추가.
- **C11 stale 판정 기준 강화**: hero_tagline 또는 product_summary 빈약(20자 미만) 시 warn.
  현재는 display_title 만 체크해서 빈약 summary 가 pass 처리되어 사장님 화면에서 모호.
- **회귀 fixture 박제 의무** (B0-test): `tests/fixtures/no-optional-tours/` + `tests/parser/bullets.spec.ts`.
- **콤마 split 시그니처 감지**: `every(item.length < 30) && count > 20` 패턴이면 backfill 자동 force.

## 4. 404 원인 (운영 정상)

`/packages/32477b61-...` 404는 사고 아님:
- `status = 'pending_review'` 이므로 고객 페이지 라우트가 의도적으로 `notFound()` 호출.
- 사장님이 어드민 검토 큐에서 **승인(approve)** 후 status → `published` 가 되면 200.
- 이번 세션의 정정 결과는 어드민 큐에서 audit_status: clean 으로 보일 것.

## 5. 다음 액션 — 사장님 한 줄 명령으로 자율 진행

### 우선순위 (RC 영향도 큰 순)

1. **"B0 박아"** → parser.ts:941-949 DELETE + 회귀 fixture (가장 큰 효과, 영구 차단). **이 한 줄이 RC1 종결.**
2. **"B2 박아"** → backfill 게이트 품질 검증 (콤마 split 시그니처 자동 force). RC2 종결.
3. **"B1 박아"** → 어드민 검토 큐 inline "Section 재추출" 버튼 + alert 노출. RC4 종결.
4. **"B3 박아"** → deterministic 매트릭스 extractor. RC3 토큰 0 종결.
5. **"A1 A2 진행"** → 옛 등록물 33건 일괄 정리 (~$0.16, ~3분).
6. **"B4 B5 박아"** → LLM few-shot + cron (보조).

### 통합 명령

- **"전체 RC 박아"** → B0+B2+B1+B3 한 PR 로 박고 A1+A2 실행 후 결과 보고. 예상 작업 1.5시간, LLM 비용 $0.16, RC1~RC4 영구 종결.

본 endpoint (`/api/admin/packages/[id]/backfill-sections`)는 위 모든 시나리오의 호출 단위 SSOT.

## 6. 이 사고가 박힌 인프라를 우회한 경로 (5/13~5/19 PR 매트릭스)

| PR | 박은 것 | 후쿠오카 사고 막았어야? | 실제 결과 | 우회 원인 |
|----|---------|---------------------|---------|---------|
| #109/#110/#111/#113 | 7 도메인 LLM hierarchy + L1→L4 | inclusions/excludes 매트릭스/콤마 시그니처 캐치 | ❌ | **RC1**: parser.ts 옛 fallback 이 LLM 이전에 채움 |
| #114/#115 | audit auto-refresh + revalidate-helper | C11 stale 표시 제거 | ✅ (단, force=true 후만) | force=false 디폴트 + already-filled 게이트가 RC2 |
| #119 (Next.js after API) | backfill silent fail → admin_alerts | 사고 가시화 | ✅ admin_alerts #14 정확 적재 | **RC4**: 검토 큐와 분리. 사장님 미열람 |
| #126 (upload→랜딩 5건) | admin_alerts 임계치 알림 | 같은 사고 누적 시 알림 | 적재되었지만 사장님 미인지 | RC4 동일 |
| #133 (/admin/alerts 페이지 + SF-1/SF-2) | alert 통합 페이지 | 사장님이 페이지 방문 시 인지 | 사장님 동선 외 페이지 | RC4 동일 |

**핵심 학습**: 가시화 인프라는 박혔는데 **사장님 동선(검토 큐) 안으로 들어오지 않으면 작동 0%**. B1 (검토 큐 inline 노출) 이 RC4 의 진짜 해결책.
