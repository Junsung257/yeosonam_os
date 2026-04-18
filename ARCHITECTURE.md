# 여소남 OS — Defensive Architecture (2026-04)

> **목적**: AI 환각 / 스키마 drift / 렌더러 불일치 3대 오류 패턴을 **구조적으로 차단**하는 방어선 구축.
> 2026-04-18 Plan A 완료 상태 기준.

## 핵심 원칙

1. **Single Source of Truth (SSOT)**: `src/lib/package-schema.ts`의 Zod 스키마가 DB/파서/렌더러 모두의 계약.
2. **Anti-Corruption Layer**: 레거시 DB 레코드는 `package-acl.ts`가 런타임 정규화 후 공급.
3. **탐지 우선**: 오류를 "막기" 전에 "빠르게 찾기" — validator + audit CLI + visual regression.
4. **Defensive renderer**: A4/모바일은 pkg 필드를 직접 해석하지 않고 헬퍼 출력만 소비.

## 아키텍처 4-Layer 방어선

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: 입력 방어 (Parser + LLM Structured Output)            │
│  - parser.ts + llm-structured-output.ts                        │
│  - llm-retry.ts: 실패 시 3회 재시도                              │
│  - Zod schema를 LLM 응답 제약조건으로 주입                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: 저장 방어 (INSERT/UPDATE 전 Zod 검증)                  │
│  - insert-template.js validatePackage (W1~W19)                 │
│  - POST /api/packages Zod strict 검증 (STRICT_VALIDATION=true)  │
│  - 실패 시 status='draft' + validation_errors 저장              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: 렌더 방어 (Anti-Corruption Layer)                     │
│  - package-acl.ts: normalizePackage / normalizePhotos           │
│  - itinerary-render.ts: 공통 헬퍼 (A4/모바일 공유)              │
│  - 레거시 DB 레코드 자동 변환                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 4: 회귀 방어 (Visual + Text Regression)                  │
│  - tests/visual/packages.spec.ts                                │
│  - toHaveScreenshot + mask (dynamic data)                       │
│  - innerText SHA-256 hash (hydration 무관)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 5: 운영 방어 (Observability + ISR)                       │
│  - Sentry (설치 완료, DSN 대기)                                 │
│  - POST /api/revalidate: ISR 캐시 즉시 무효화                   │
│  - db/audit_schema_drift.js: 주기적 drift 감사                  │
└─────────────────────────────────────────────────────────────────┘
```

## 데이터 흐름

```
원문 텍스트 (PDF/복붙)
   │
   ├─→ Gemini Structured Output (Zod schema 주입) ──┐
   │                                                │
   │                                                ▼
   │                            (Auto-Retry × 3, backoff)
   │                                                │
   │                                                ▼
   │                             [Zod validation failed?]
   │                                   │               │
   │                                  OK              NG
   │                                   │               │
   │                                   ▼               ▼
   │                             INSERT (published)  status='draft'
   │                                   │               + validation_errors
   │                                   │               → 어드민 수동 검수
   │                                   │
   │                                   ▼
   │                        travel_packages (DB)
   │                                   │
   └──────── revalidatePath('/packages/[id]') 즉시 호출
                                       │
                                       ▼
                        ISR 캐시 무효화 → 모바일 랜딩 즉시 갱신
                                       │
                                       ▼
                            DetailClient (모바일) + A4 렌더
                                       │
                                       ▼
                  package-acl.ts (legacy → 정규 변환)
                                       │
                                       ▼
                  itinerary-render.ts (공통 헬퍼)
                                       │
                                       ▼
                            최종 렌더 결과
                                       │
                                       ▼
                  Playwright 회귀 테스트 (CI)
                                       │
                  ┌────────────────────┴─────────────────────┐
                  │                                          │
                  ▼                                          ▼
          Visual Screenshot diff                    innerText SHA-256
          (mask: 날짜/환율)                         (hydration 무관)
```

## 주요 파일

### `src/lib/`

| 파일 | 역할 | Lines |
|------|------|-------|
| `package-schema.ts` | **SSOT** Zod 스키마 정의 | ~200 |
| `package-acl.ts` | 레거시 DB → 정규 변환 | ~150 |
| `llm-structured-output.ts` | Zod → LLM schema 변환 | ~90 |
| `llm-retry.ts` | Exponential backoff 재시도 | ~90 |
| `itinerary-render.ts` | A4/모바일 공통 렌더 헬퍼 | ~150 |
| `attraction-matcher.ts` | 관광지 매칭 (WeakMap 인덱스 캐시) | ~230 |
| `admin-utils.ts` | `formatDepartureDays` 등 | ~60 |

### `db/`

| 파일 | 목적 |
|------|------|
| `audit_schema_drift.js` | 전체 DB drift 감사 CLI |
| `migrate_photos_schema.js` | photos {url,thumb} → {src_medium,src_large} |
| `normalize_departure_days.js` | JSON 배열 문자열 → 평문 |
| `fix_optional_tours_region.js` | region 필드 일괄 주입 |
| `normalize_itinerary_format.js` | {days:[]} → [] (dry-run만, meta 손실 위험) |
| `fix_kul_contamination.js` | 쿠알라 DAY 교차 오염 수정 |
| `templates/insert-template.js` | INSERT 공통 (W1~W19 검증) |

### `tests/visual/`

| 파일 | 역할 |
|------|------|
| `packages.spec.ts` | 상품 상세 페이지 회귀 |
| `helpers.ts` | mask / textHash / waitForStable |
| `fixtures.json` | 테스트 대상 상품 ID |

## 환경변수

| 변수 | 필수? | 기본값 | 설명 |
|------|------|-------|------|
| `STRICT_VALIDATION` | 선택 | `false` | `true` 시 Zod 실패를 error로 승격 |
| `ALLOW_DRAFT` | 선택 | `false` | STRICT 모드에서 draft로 저장 허용 |
| `REVALIDATE_SECRET` | 필수 (프로덕션) | — | `/api/revalidate` 시크릿 |
| `NEXT_PUBLIC_SENTRY_DSN` | 선택 | — | Sentry 활성화 시 필수 |

## 다음 단계 로드맵

### 즉시 (사장님 결정 필요)
- [ ] Sentry 계정 생성 + DSN 발급 → `sentry.README.md` 참조
- [ ] `REVALIDATE_SECRET` 환경변수 설정 (프로덕션)
- [ ] Visual regression 베이스라인 수립 (`npm run test:visual:update` 1회)

### 단기 (1-2주)
- [ ] `STRICT_VALIDATION=true` 프로덕션 전환 (현재 warning만)
- [ ] `@hookform/resolvers/zod` 도입 — 어드민 폼에 Zod 공유 검증
- [ ] `audit:drift` 결과 CI에서 자동 감시 (drift 증가 시 경고)

### 중기 (1-2개월)
- [ ] 다국어 (`next-intl`) — 일본/대만 시장 진입
- [ ] Multi-tenancy (`tenant_id` 컬럼 + RLS 확장)
- [ ] 결제 게이트웨이 통합 (Stripe or PG)

### 장기 (Q3/Q4)
- [ ] Payload CMS 재평가 (Plan A로 drift 재발 여부 확인 후)
- [ ] Event Sourcing 검토 (원문 → 파싱 결과 재생 가능성)

## 회귀 방지 체크리스트 (코드 리뷰 시 필수)

- [ ] 새 Package 필드 추가 → `PackageCoreSchema`에 먼저 정의했는가?
- [ ] 새 렌더링 로직 → `itinerary-render.ts`에 추가 (렌더러 내부 금지)?
- [ ] 새 DB 컬럼 → `PACKAGE_LIST_FIELDS` 동기화?
- [ ] 새 마이그레이션 스크립트 → `--dry-run` 기본 + scratch/ 덤프?
- [ ] 새 ENV 변수 → `ARCHITECTURE.md` 환경변수 표에 추가?
