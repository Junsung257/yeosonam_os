# AI 정책 운영 가이드 (`system_ai_policies`)

운영 중 모델 전환을 **재배포 없이** 하려면 이 테이블을 사용합니다.

## 우선순위

1. `system_ai_policies` (DB)
2. `AI_TASK_PROVIDER_OVERRIDES`, `AI_TASK_MODEL_OVERRIDES` (env)
3. 코드 기본값

즉, DB 값이 있으면 env보다 먼저 적용됩니다.

## 주요 컬럼

- `task`: 태스크명 (`card-news`, `blog-generate`, `qa-chat`, `*`)
- `provider`: `deepseek` | `claude` | `gemini`
- `model`: 모델 문자열 (예: `deepseek-v4-pro`)
- `fallback_provider`, `fallback_model`: 지연/실패 시 우회 모델
- `timeout_ms`: 실행 타임아웃 (밀리초)
- `enabled`: 활성 여부

`task='*'` 는 전역 기본값이고, 개별 태스크가 우선합니다.

## API 사용 예시

어드민 권한(쿠키 기반 관리자 또는 서비스키)으로 호출:

```bash
# 1) 현재 정책 조회
curl -X GET "https://yeosonam.com/api/admin/ai-policies"
```

```bash
# 2) 카드뉴스를 Claude Sonnet으로 전환
curl -X POST "https://yeosonam.com/api/admin/ai-policies" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "card-news",
    "provider": "claude",
    "model": "claude-sonnet-4-6",
    "fallback_provider": "gemini",
    "fallback_model": "gemini-2.5-flash",
    "timeout_ms": 15000,
    "enabled": true,
    "note": "카드뉴스 고품질 모드"
  }'
```

```bash
# 3) 카드뉴스 정책 제거(전역 * 정책 사용으로 복귀)
curl -X DELETE "https://yeosonam.com/api/admin/ai-policies?task=card-news"
```

## 운영 권장값

- `card-news`: `provider=deepseek`, `model=deepseek-v4-pro`, `fallback=gemini-2.5-flash`, `timeout_ms=15000`
- `blog-generate`: `provider=deepseek` 또는 `claude` (품질/비용 상황별)
- `qa-chat`: `provider=deepseek`, `fallback=gemini-2.5-flash`, `timeout_ms=12000`

## 장애 대응 체크

- 특정 provider 장애 시: `provider`를 다른 값으로 바꾸고 `fallback` 유지
- 응답 지연 시: `timeout_ms` 낮추고 빠른 fallback 모델 지정
- 비용 급증 시: `model`을 `flash` 계열로 낮춰 즉시 완화

