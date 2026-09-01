# Step 6.5 — Agent Self-Audit (MANDATORY, 제로-코스트)

> **목적**: Gemini 유료 호출 없이 Claude Code 세션(Agent 본인)이 파싱 직후
> self-audit 을 수행한다. **확증 편향을 막기 위해 반드시 Reflection + CoT 강제**.
>
> **시점**: 파싱 완료 → validatePackage 통과 → **Agent self-audit** → INSERT
>
> **비용**: 0 (이 세션의 Claude 사고 능력 사용)
>
> **왜 이게 효과적**: 원문을 가장 잘 아는 건 지금 세션에서 파싱한 Agent 본인.
> 외부 API로 재감사하는 것보다 같은 컨텍스트에서 self-check 하는 것이 정확하고 빠름.

## 🔒 확증 편향 방지 — 반드시 지킬 것

AI 가 "내가 쓴 답이 맞냐?" 라고 자문하면 99% 합리화합니다. 이를 막기 위해:

1. **raw_text 직접 인용 강제**: "원문에 있다"고 답하기 전 **원문에서 해당 문구를 verbatim 복사**할 것
2. **Chain-of-Thought 강제**: 각 claim 마다 `<thinking>` 블록으로 단계별 검증 과정 기록
3. **근거 없으면 `supported: false`**: "아마 있을 것 같다" 금지. 원문에 **없으면 없다고** 답할 것

## Self-Audit 프로토콜 (Agent 가 따라야 하는 절차)

파싱된 pkg JSON 에서 아래 필드별로 **검증 대상 claim** 을 뽑고, 각 claim 마다:

1. **원문 인용** — raw_text 에서 claim 의 근거 문구를 verbatim 찾아 복사
2. **생각 사슬** — `<thinking>` 으로 "이 문구가 해당 claim 을 뒷받침하는가?" 검토
3. **판정** — `supported: true | false | null` (null 은 원문 모호할 때만)

검증 필수 필드:

| 필드 | 타겟 에러 | severity |
|---|---|---|
| `min_participants` | ERR-20260418-01 (템플릿 4 조작) | HIGH |
| `ticketing_deadline` | ERR-date-confusion (발권 vs 배포일 혼동) | HIGH |
| `inclusions` 중 **금액/등급/N박 토큰** | ERR-FUK-insurance-injection ("2억 여행자보험") | CRITICAL |
| `surcharges` 기간+금액 | ERR-20260418-03/14 | HIGH |
| `notices_parsed` 중 **PAYMENT 타입** | ERR-FUK-clause-duplication | CRITICAL |
| `itinerary_data.days[i].regions` | ERR-KUL-02/03, ERR-FUK-regions-copy (DAY 교차) | HIGH |
| `optional_tours[]` region 정합 | ERR-KUL-04 | MEDIUM |

## 출력 형식 (INSERT payload 의 `agent_audit_report` 필드에 저장)

```json
{
  "parser_version": "register-v2026.04.21-sonnet-4.6",
  "ran_at": "2026-04-21T12:00:00Z",
  "claims": [
    {
      "id": "min_participants",
      "field": "min_participants",
      "severity": "HIGH",
      "text": "최소 출발인원 10명",
      "evidence": "원문 3줄: '성인 10명 이상 출발 가능'",
      "supported": true,
      "note": null
    },
    {
      "id": "inclusions:2",
      "field": "inclusions",
      "severity": "CRITICAL",
      "text": "포함: 2억 여행자보험",
      "evidence": null,
      "supported": false,
      "note": "원문에는 '여행자보험' 만 있음. '2억' 표기 없음 — 금액 환각 의심"
    }
  ],
  "overall_verdict": "warnings",
  "unsupported_critical": 1,
  "unsupported_high": 0
}
```

## 판정 결과 → 액션

- **모든 claim supported: true** → `overall_verdict: "clean"`, 바로 INSERT 진행
- **CRITICAL 하나라도 `supported: false`** → `overall_verdict: "blocked"`, **INSERT 중단 + 재파싱**
- **HIGH `supported: false` 만 있음** → `overall_verdict: "warnings"`, INSERT 진행 하되 post-audit 가 warnings 로 승격
- **unclear(null) 만 있음** → `overall_verdict: "warnings"`, 사용자에게 원문 확인 요청

## 구현 메커니즘

- `db/templates/insert-template.js` 의 INSERT payload 에 `agent_audit_report` 필드가 추가되어 있음
- Agent 가 이 JSON 을 생성해서 pkg 객체에 얹어 `createInserter().run()` 호출
- DB 에 영속 → `post_register_audit.js` 가 이 보고를 읽어 warnings 로 승격 (Gemini 호출 없이)

## 🚫 금지 사항

- 외부 API 호출 (Gemini/OpenAI) — 이 단계는 순수 Claude 세션 내에서만
- "보통 이 정도 상품은 이럴 것이다" 라고 상식 추론 — 반드시 raw_text 만 근거
- claim 을 건너뛰기 — 위 표의 모든 타겟 필드를 반드시 처리
