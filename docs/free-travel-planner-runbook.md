# 자유여행 AI 플래너 — 운영 런북

> 고객 `/free-travel`, API `POST /api/free-travel/plan`(SSE), 세션 `free_travel_sessions`, 일정 LLM `free-travel-itinerary`(DeepSeek Flash).

## 흐름 요약

1. 고객이 자연어 + 플래너 칩(동반·호텔예산·속도) 제출.
2. 서버가 `plannerPreferences`를 **추출값보다 우선**해 일정·저장에 반영.
3. 일정: DeepSeek JSON → 검증 실패 시 `buildDayPlans` 템플릿, `plan_json.itinerarySource`·`itineraryLlmError` 기록.
4. 세션 `plan_expires_at`은 **약 7일**(공유 링크 복원용).
5. 복원: `/free-travel?session={uuid}` → `GET /api/free-travel/session?id=`.

## plan_json 주요 필드

| 필드 | 설명 |
|------|------|
| `plannerPreferences` | `companionType`, `hotelBudgetBand`, `travelPace` (화면 선택 우선) |
| `itinerarySource` | `llm` \| `template` |
| `itineraryLlmError` | 폴백 시 코드 (`ZOD_INVALID`, `DAY_COUNT_MISMATCH` 등) |
| `dayPlans` | 일자별 `stops`·호텔·액티비티 (모바일 가이드북 토큰에 `sessionId` 있으면 동일 구조로 표시) |

## 크론

| 경로 | 용도 |
|------|------|
| `/api/cron/free-travel-retarget` | 리드 알림톡 — 링크에 `?session=` 포함 |
| `/api/cron/free-travel-plan-housekeeping` | `plan_expires_at` 기준 만료/유효 행 **건수만** 집계 (삭제 없음) |

## 어드민

- `/admin/free-travel`: 리드 카드에 일정 AI/템플릿 배지, 폴백 툴팁, 플래너 딥링크, **일정 AI 통계** 카드(최근 **7·30·90일** 전환, 표본 상한 3,000건/쿼리).

## 자비스

- `plan_free_travel` 도구 결과에 `plannerUrl`, `sessionId` 포함 — 고객에게 링크 안내 가능.

## 환경 변수

- DeepSeek: `DEEPSEEK_API_KEY` (게이트웨이 라우팅은 `src/lib/llm-gateway.ts`).
- 리타겟 알림톡: `KAKAO_TEMPLATE_FREE_TRAVEL_RETARGET`.

## 관련 코드

- `src/app/api/free-travel/plan/route.ts`
- `src/lib/free-travel/itinerary-llm.ts`
- `src/app/free-travel/FreeTravelClient.tsx`
