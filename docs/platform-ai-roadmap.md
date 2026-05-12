# 플랫폼 AI 목표 vs 현실 — 로드맵 (외부 자료 정렬)

## 1. 목표 문장 재검증

**“만능 AI 챗봇이 스스로 모든 것을 하고, 학습해 고도화되며, 나중에 여행사에 팔 수 있다”**

- **팔 수 있는 제품**으로 가는 경로는 성립한다. 다만 업계에서 말하는 **“만능”**은 보통  
  **오케스트레이션(에이전트+툴) + RAG + 평가 루프 + (선택) 미세조정**의 합이지,  
  **단일 모델이 무한 도메인을 100% 자율 처리**하는 의미가 아니다.
- **자기 학습**은 (1) 로그·신호 축적 (2) 오프라인 평가·골든셋 (3) 사람/정책 피드백으로 라벨링 (4) 프롬프트·RAG·DPO/RLHF 순으로 단계화하는 것이 일반적이다.

## 2. 외부 자료에서 공통으로 나오는 것

| 주제 | 요지 | 참고 |
|------|------|------|
| RAG 챗봇 개선 | 반복 평가·회귀 테스트·한 변수씩 변경 | ProductOps — Evaluating RAG chatbot |
| RAG 품질 | 검색 vs 생성 분리 측정, CI 게이트 | Google Cloud — RAG evaluation best practices |
| 운영 개선 | 직접 피드백 + 행동 로그(간접), 프로덕션 ≠ 벤치 | Microsoft Tech Community — How do I make my LLM chatbot better |
| 미세조정 | 사람 수정 diff → 피드백 학습 파이프 | Argilla — RAG + human feedback fine-tuning 튜토리얼 |

## 3. 우리 코드베이스에 반영한 것 (이번)

- **`platform_learning_events`** (Supabase 마이그레이션): 기본 **`message_sha256` + 구조 `payload`**. 확장 컬럼: `tenant_id`, `message_redacted`, `consent_flags`.
- **`src/lib/platform-learning.ts`**: `qa_chat`, `jarvis_v1`, `jarvis_v2_stream`에서 이벤트 기록. `PLATFORM_LEARNING_STORE_REDACTED_MESSAGE=true` 시 `src/lib/message-redact.ts`로 마스킹 전문 저장.
- **`/api/admin/platform-learning`** + **`/admin/platform-learning`** — 조회 UI.
- 기존 **`ai_training_logs`**: 상품 PDF 파싱 **사람 수정 diff** 전용 — 역할 분리 유지.

→ “점점 고도화”의 **1단계 데이터 파이프**는 이제 켜진 상태. 다음은 배치로 **집계·골든셋·대시보드**를 붙이면 된다.

## 4. 제품화(여행사에 판다) 쪽 설계 힌트

- **멀티테넌트**: `tenant_id` / `affiliate_id` 스코프 + RLS (이미 방향 정리됨).
- **패키징**: “만능 한 덩어리”보다 **화이트라벨 UI + 동일 오케스트레이션 + 테넌트 설정(툴 권한)** 이 판매하기 쉽다.
- **법/결제**: 완전 무인 대신 **게이트(HITL/고객 확인)** 를 옵션으로 파는 것이 B2B에서 덜 깨진다.

## 5. 다음 개발 후보 (우선순위)

1. `platform_learning_events` → 주간 집계 뷰 / 어드민 읽기 전용 API  
2. `/admin/qa` + 자비스에 **👍/👎** → `payload.user_rating` (선호 데이터)  
3. Ragas/Deepeval 스타일 **오프라인 eval 스크립트** (repo `scripts/`)

이 문서는 목표와 외부 베스트프랙티스를 맞추기 위한 **한 장 짜리 계약**으로 유지한다.
