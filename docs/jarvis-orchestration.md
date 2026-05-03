# 자비스 오케스트레이션 — 단일 진입·다층 팀

## 1. 전문가 관점 요약

- **한 통로**(HTTP `/api/jarvis`, `/api/jarvis/stream`)로 들어오게 유지한다.
- **1단**: 기존 `routeMessage` — 도메인 6개(operations, products, …)만 빠르게 가른다.
- **2단**: `resolveSpecialist` — 도메인 **안**에서 논리적 서브 팀을 가른다 (키워드 → 추후 LLM 서브라우터로 교체 가능).
- **실행**: 지금은 **동일 DeepSeek 루프·동일 툴 세트**를 쓰되, 세션 `context.orchestration`에 **누가 담당인지**를 남겨 로그·분석·향후 프롬프트 분기의 훅으로 쓴다.

이렇게 하면 “팀만 쪼개고 실행 엔진은 하나”로 시작해, 나중에 **팀별 시스템 프롬프트/툴 서브셋**을 나누기 쉽다.

## 2. 파일 맵

| 경로 | 역할 |
|------|------|
| `src/lib/jarvis/orchestration/specialist-registry.ts` | 도메인별 서브 id·정규식 — **여기만 수정해 팀 추가** |
| `src/lib/jarvis/orchestration/resolve-specialist.ts` | 매칭 로직 — LLM 라우터로 바꿀 때 이 파일만 교체 |
| `src/lib/jarvis/orchestration/types.ts` | 타입 |
| `src/lib/jarvis/orchestration/index.ts` | export + `mergeOrchestrationContext` |
| `src/lib/jarvis/v2-dispatch.ts` | `prepareDispatch`에 `specialistPick` 부착 |
| `src/app/api/jarvis/stream/route.ts` | SSE `agent_picked` / `done` / 세션 context 병합 |
| `src/app/api/jarvis/route.ts` | V1 JSON 응답에 `specialist` 필드 + context 병합 |

## 3. 세션 context 스키마

```json
{
  "orchestration": {
    "last": { "specialistId", "labelKo", "parentAgent", "method", "at" },
    "last_specialist_id": "operations.booking_lookup",
    "last_parent_agent": "operations"
  }
}
```

## 4. 다음 확장(코드 변경 최소)

1. **LLM 서브라우터**: `resolve-specialist.ts`에서 `process.env.JARVIS_SPECIALIST_ROUTER === 'llm'`일 때 소형 모델 호출.
2. **팀별 프롬프트**: `buildConfig` 분기에 `dispatch.specialistPick.specialistId` 스위치 추가.
3. **팀별 툴 서브셋**: 레지스트리에 `toolAllowlist: string[]` 추가 후 `buildConfig`에서 필터.

## 5. 고객 공개 채팅(`/api/qa/chat`)

별도 제품 파이프라인 유지. 여정(`customer-journey`)은 **예약·준비물 자동화** 축. 자비스 오케스트레이션은 **내부·테넌트 자비스** 축. 필요 시 나중에 “통합 게이트웨이”에서 두 축을 같은 이벤트 버스로만 묶으면 된다.

## 6. 플라이휠·판매 목표와의 연결

`docs/platform-ai-roadmap.md` — 외부 자료(RAG 평가, LLMOps, RLHF)와 **만능 챗봇** 표현을 정렬하고, `platform_learning_events` 적재 전략을 설명한다.
