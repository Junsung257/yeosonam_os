# Changelog

## [Unreleased] — Threads 2026 Algorithm V3 (2026-05-26)

Threads 자동화 전면 개선 — 2026 알고리즘 대응 + 멀티 에이전트 파이프라인.

### Added

- **P0: 해시태그 → 토픽 태그 마이그레이션** — Threads 2026 알고리즘 대응, `topic_tags` 필드 도입 (`threads-post.ts`)
- **P1: 이미지 우선 발행 정책** — 텍스트 포스트에 Pexels 이미지 자동 첨부 (도달률 3x), `media_url` 스키마 추가
- **P1: 자체 댓글 90초 내 추가** — `replyToThread()` 함수 구현, engagement velocity 향상 (`threads-publisher.ts`)
- **P1: 최적 발행 시간 적용** — Buffer 2.5M 포스트 분석 기반 KST 최적 시간대 스케줄링
- **P1: Critic 에이전트 루프** — LangGraph 패턴의 사전 발행 품질 게이트 (ER 예측 + 정책 위반 검사)
- **P1: 발행 빈도 최적화** — 하루 3-5회, KST 기준 자연스러운 간격 유지
- **P2: 주간 리포트 자동 전송** — 매주 월요일 09:00 KST, Slack으로 7일간 발행 실적 리포트
- **TrendStyle 엔진** — 동적 스타일 핑거프린트 + 트렌드 키워드 기반 콘텐츠 최적화 (`trend-style-engine.ts`)
- **Trend Learner** — 트렌드 키워드 학습 및 순위 추적 (`threads-trend-learner.ts`)
- **Threads Content Planner 크론** — 매일 07:00 KST, Priority Score 기반 콘텐츠 계획 수립
- **Threads Content Generator 크론** — Planner 계획 → AI 생성
- **Threads Auto Publisher 크론** — Critic Gate 통과 후 자동 발행 (15~30분 간격)
- **Threads Trend Miner 개선** — Threads 검색 API 연동 강화
- **Threads Search 확장** — 검색 결과 파싱 및 토픽 추출 고도화
- **Threads 자동화 마이그레이션** (`20260526150000`) — `content_plans` 테이블 + `content_distributions` `ready` 상태 추가

## [Unreleased] — Jarvis V2 (2026-04-22)

자비스 전면 개편. 설계 문서 `db/JARVIS_V2_DESIGN.md` 참조.

### Added (2026-05 maintenance)

- 제휴/코브랜딩 유입 추적 고도화: `/with/[code]`, 추천코드 대문자 정규화, 랜딩/가이드북 이벤트 적재 경로 확장
- `conversations` 고객 여정(`journey`)·제휴 스코프(`affiliate_id`) 확장과 플랫폼 학습 이벤트(`platform_learning_events`) 운영 조회 경로 추가
- MRT/숙소 동기화 파이프라인 및 검색 인덱스 보강 마이그레이션 추가 (`20260503*`)

**Phase A — 보안·안전성 패치 (2026-05-03)**
- RFQ XSS 방어: `sanitizeText` + DOMPurify 적용 (3파일)
- bookings 상태머신 가드: 잘못된 전이 시 400 반환
- attractions 소프트 삭제: `DELETE` → `is_active=false` 전환
- `api/tracking` 논블로킹: 추적 실패가 API 응답을 막지 않도록
- 어드민 쓰기 라우트 인증 강화 (5개 라우트)
- `getAirlineName()` SSOT: `render-contract.ts` 단일 출처로 통합
- 블로그 스케줄러 배치 INSERT로 교체 (N+1 제거)
- `callWithZodValidation` LLM 에이전트 9개 전체 적용
- `register-via-ir` / `audit-pkg-to-ir` Bearer 인증 추가
- `lib/status-colors.ts` 생성 + 어드민 3파일 마이그레이션

**Phase B — 코드 품질 리팩 (2026-05-03)**
- `lib/admin-utils.ts` 확장: `fmtNum`, `fmtDateISO`, `fmtDateTime` 추가
- 어드민 7개 파일(`payments`, `rfqs`, `tax`, `tenants`, `scoring`, `land-settlements`, `AdminPageClient`) 인라인 포맷 함수 → `admin-utils` import로 통합
- `render-contract.ts` CanonicalView에 `optionalToursByRegion` 단축 필드 추가 (CRC v1 완전 적용)

### Added

**Phase 0·1 — 설계 + 저위험 패치** (6e2c1a9)
- `db/JARVIS_V2_DESIGN.md` 마스터 설계 (Part A 전략 + Part B 구현 상세 + Part C 완료 스냅샷)
- `JarvisContext` 에 tenantId/userRole/surface optional 필드
- Router few-shot 6개 추가로 라우팅 정확도 개선
- response-critic 휴리스틱 스킵 확장 (인사·순수 KPI·약속없는 안내)
- `gemini-agent-loop.ts` MAX_ROUNDS/HISTORY_TURNS env 화 + 라운드 초과 에스컬레이션

**Phase 2 — 스트리밍 엔진** (2be4c2a)
- `gemini-agent-loop-v2.ts` — AsyncGenerator 기반 `streamGenerateContent` + parallel function calling
- `gemini-cache-manager.ts` — `cachedContents` REST 래퍼, 1024 토큰 미만 자동 폴백
- `stream-encoder.ts` — SSE 이벤트 인코더 + keepalive
- `v2-dispatch.ts` — Router → agent config 조립
- `/api/jarvis/stream` SSE 엔드포인트

**Phase 3 — 멀티테넌트 격리** (352b2e6)
- `scoped-tables.ts` — STRICT(16) / NULLABLE(9) / GLOBAL(7) 카탈로그
- `scoped-client.ts` — Proxy 기반 tenant_id 자동 필터, platform_admin 면제
- `supabase/migrations/20260423*.sql` — `set_jarvis_request_context` RPC + P0 테이블 10개 `tenant_id` 컬럼 + RLS 정책 + `jarvis_enable_rls()` 활성화 훅

**Phase 4 — Contextual Retrieval RAG** (2970825)
- `supabase/migrations/20260424000000_jarvis_knowledge_chunks.sql` — pgvector HNSW + BM25 tsvector + Hybrid Search RPC (RRF, k=60)
- `src/lib/jarvis/rag/retriever.ts` — 임베딩 + hybrid + Flash rerank
- `db/rag_contextualize.js` — Anthropic Contextual Retrieval 전처리 (청크 앞 Flash 문맥 prepend)
- `db/rag_reindex_all.js` — 전수 재인덱싱 오케스트레이터 (packages/blogs/attractions, `--tenant`/`--dry-run`/`--limit`)
- `agents/concierge.ts` — RAG 기반 고객 상담 agent (신규)

**Phase 5 — 테넌트 봇 + 비용** (8d3d6a5)
- `supabase/migrations/20260425*.sql` — `tenant_bot_profiles` + `jarvis_cost_ledger` + `jarvis_monthly_usage` 뷰 + `jarvis_current_month_usage` RPC
- `persona.ts` — `buildTenantSystemPrompt`, `isAgentAllowed`, 60초 메모리 캐시
- `cost-tracker.ts` — PRICING 표 (Gemini 2.5 Pro/Flash/Lite) + `computeCostUsd` (cache 할인 적용) + `assertQuota` + `getMonthlyUsage`
- V2 loop 에 `assertQuota` → `isAgentAllowed` → `buildTenantSystemPrompt` → `trackCost` 전체 통합

**Phase 6 — 전 agent V2 + SSE 훅 + 봇 UI** (b3044e0)
- 6개 agent 전부 V2 dispatch 연결 (`products` 는 surface 로 concierge/products 분기)
- `useJarvisStream` React 훅 + V1 409-fallback 자동 처리
- `context.ts` 공용 `resolveJarvisContext` (body + 헤더 + Supabase JWT claim)
- `/admin/tenants/[tenantId]/bot` 관리자 UI — 봇 설정 + 사용량 대시보드 + 월별 히스토리
- `/api/admin/jarvis/bot-profile`, `/api/admin/jarvis/usage` REST API

**Phase 7 — 감사 공백 채우기** (91d0699)
- `marketing.propose_blog_draft` — agent_actions 기록 → 관리자가 `/admin/blog` 에서 승인·발행
- `products.propose_product_registration` — agent_actions 기록 → `/register` 파이프라인으로 승격
- `hitl.ts` 3개 tool 등록 (risk low/medium)

**Phase 8 — 스모크 테스트 + 문서화**
- `db/smoke_jarvis_v2.js` — node:test 기반 16 케이스 (단가·분류·SSE·guardrail). `node --test` 로 실행
- `CHANGELOG.md` (본 파일)
- 설계 문서에 Part C (구현 완료 스냅샷) 추가

### Changed

- `agents/{operations,products,finance,marketing,sales,system}.ts` — `TOOLS`, `executeXxxTool` 공유 export 추가 (V1·V2 공용)
- `/api/jarvis/route.ts`, `/api/jarvis/stream/route.ts` — 인라인 `resolveCtx` 제거, 공용 `context.ts` 사용

### Migration notes

DB 마이그레이션은 **파일만 작성** 완료, 실제 실행은 다음 순서:

1. 스테이징에서 `20260423000000_jarvis_v2_request_context.sql` 실행
2. `20260423010000_jarvis_v2_tenant_columns.sql` — P0 테이블 10개에 `tenant_id` 컬럼 추가
3. `20260423020000_jarvis_v2_rls_policies.sql` — 정책 정의 (RLS 자동 활성화 안 함)
4. 애플리케이션 배포 + 데이터 백필
5. QA 검증 후 `SELECT jarvis_enable_rls();`
6. 문제 시 `SELECT jarvis_disable_rls();` 로 즉시 롤백
7. 별도로 `20260424000000_jarvis_knowledge_chunks.sql` + `node db/rag_reindex_all.js`
8. `20260425000000_jarvis_v2_tenant_bot_profiles.sql` + 테넌트별 기본 프로파일 seed

### Kill switches

- `JARVIS_STREAM_ENABLED=false` — V2 엔드포인트 503
- `JARVIS_RLS_ENABLED=false` (기본) — RLS 세션 컨텍스트 주입 비활성
- `DISABLE_RESPONSE_CRITIC=true` — 응답 검증 스킵
- `jarvis_disable_rls()` RPC — DB 레벨 RLS 일괄 해제
