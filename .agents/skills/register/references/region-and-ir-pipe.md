# Step 2.5 — IR 파이프 (Canary, 2026-04-21 도입)

> **언제 읽는가**: 신규 지역 등록 또는 IR(Intake Normalizer) 파이프 사용을 결정할 때.

Phase 1.5 로 도입된 **Intake Normalizer (IR) 파이프** 가 기본 권장 경로가 됩니다.
원문 → Zod-IR → pkg 3단 구조로 환각·축약·조작을 구조적으로 차단합니다.

## IR 파이프 사용법 — 3가지 엔진 선택 가능

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

## 엔진 비교 및 추천

| 엔진 | 비용 | 품질 | 배치 | 추천 상황 |
|---|---|---|---|---|
| **direct** (Claude Code 세션) | **0원** | **95%+** | ❌ 대화형 | **월 ~30건까지, 최고 품질**. 사장님 현재 규모에 최적 |
| gemini (Flash) | 0.003$/건 | 85% | ✅ | 자동화·배치·반복 상품 |
| claude (Sonnet API) | 0.03$/건 | 95% | ✅ | 중요 상품·복잡 원문 |

## 경로 최종 결정 플로우

| 상황 | 경로 |
|---|---|
| 어셈블러 존재 (XIY/TAO/DAD) | **경로 A (어셈블러)** — 무과금 패스트트랙 유지 |
| 어셈블러 없음 + Claude Code 대화형 (사장님 `/register` 호출) | **IR direct** (0원, 최고 품질) |
| 어셈블러 없음 + 자동화·배치 필요 | **IR gemini** (저렴) |
| 의심 상품·복잡 원문 | **IR claude** (프리미엄 API) |
| LLM 불가 + 급함 | **레거시 수기 insert 스크립트** (경로 B-1) |

## Direct 모드 Agent 워크플로우 (사장님 `/register` 호출 시)

사장님이 `/register <원문>` 하면:
1. Agent 가 `NormalizedIntakeSchema` 를 읽고 **IR JSON 을 직접 작성**
2. `scratch/ir-<region>-<timestamp>.json` 에 저장
3. `node db/register_via_ir.js <raw.txt> --engine=direct --ir=<scratch/ir.json> --insert` 실행
4. /api/register-via-ir 가 Zod 검증 → pkg 변환 → INSERT → post-audit
5. 결과값 한 화면 리포트

→ **LLM API 호출 0원 · 사장님 대기 시간 2~5분 · 품질 95%+**

## 신규 지역 사전 준비
```bash
# 어셈블러 BLOCKS 가 있으면 attractions 테이블 부트스트랩 (1회)
node db/bootstrap_attractions_from_assemblers.js --region=<지역> --insert
# 그 후 /admin/attractions 에서 long_desc·사진 수기 보완
```

## IR 파이프 산출물
- `normalized_intakes` 테이블에 IR 원본 저장 (status: draft→converted)
- `travel_packages` 에 pkg INSERT
- `unmatched_activities` 에 lookup 실패 세그먼트 자동 큐잉
- 자동 약관 조립 (terms-library resolver) 으로 `notices_parsed.auto` 채움

## 파일 맵 (Phase 1.5 자산)
- `src/lib/intake-normalizer.ts` — Zod 스키마 (7-kind segment)
- `src/lib/normalize-with-llm.ts` — Claude Sonnet 4.6 tool use
- `src/lib/ir-to-package.ts` — 기계 변환
- `src/lib/terms-library.ts` — 자동 약관 resolver
- `src/app/api/register-via-ir/route.ts` — API
- `db/register_via_ir.js` — CLI 래퍼
- `db/bootstrap_attractions_from_assemblers.js` — 신규 지역 부트스트랩
