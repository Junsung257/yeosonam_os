---
description: 외부 API 연동 (Pexels·Meta·Solapi·Gemini·Claude·OpenAI) — Rate Limit·실패 격리·AI 비용 관리.
paths:
  - "src/lib/llm-gateway.ts"
  - "src/lib/llm-*.ts"
  - "src/lib/notification-adapter.ts"
  - "src/lib/content-pipeline/**/*.ts"
  - "src/lib/normalize-with-llm.ts"
  - "src/lib/gemini-*.ts"
  - "src/app/api/blog/**/*.ts"
  - "src/app/api/card-news/**/*.ts"
---

# 레시피: 외부 API 연동

## 1. 순차 호출 패턴
Pexels·Meta·Solapi·Gemini 등 외부 API는 Rate Limit이 있습니다.
```typescript
// 여러 건 호출 시: 순차 + 딜레이
for (const item of items) {
  const result = await callExternalApi(item);
  results.push(result);
  await new Promise(r => setTimeout(r, 300)); // Rate Limit 방어
}
```

## 2. 실패 격리
외부 API 하나가 실패해도 전체가 멈추면 안 됩니다:
```typescript
// Pexels 이미지 실패 → 해당 슬라이드만 기본 이미지로 대체
try {
  const photo = await fetchPexels(query);
  slide.bgImage = photo.src.large;
} catch {
  slide.bgImage = '/default-travel.jpg'; // fallback
}
```

## 3. AI API 비용 관리
- Claude Max 구독 범위 내에서 작업.
- Gemini·OpenAI 등 유료 API 호출 전에 예상 비용을 보고하고 승인을 받음.
- AI 키 미설정 시 dummy 콘텐츠 반환 (전체 파이프라인이 멈추면 안 됨).
- 신규 Claude 호출 시 **`cache_control: { type: 'ephemeral' }`** system + tools에 항상 적용 (90% 읽기 할인).
