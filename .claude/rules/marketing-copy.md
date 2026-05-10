---
description: 고객에게 보이는 마케팅 카피 규칙 (원가 비노출·여소남 브랜드·셀링포인트) + AI 콘텐츠 생성 정책.
paths:
  - "src/lib/content-pipeline/**/*.ts"
  - "src/lib/card-news/**/*.ts"
  - "src/app/api/card-news/**/*.ts"
  - "src/app/api/blog/**/*.ts"
  - "src/app/blog/**/*.tsx"
  - "src/app/packages/**/*.tsx"
  - "src/components/blog/**/*.tsx"
  - "src/components/packages/**/*.tsx"
---

# 도메인 레시피: 마케팅 카피

## 고객에게 보이는 텍스트 규칙
- 원가·비용 수치는 노출하지 않습니다
- 랜드사명 대신 **"여소남"** 브랜드를 사용합니다
- 호텔명·관광지·항공사 등 구체적 셀링포인트를 1개 이상 포함합니다
- "강제쇼핑" 워딩 금지. 중립표기("쇼핑 N회"). 회피가치는 헤도닉 회귀로 자동 산정 (feedback `feedback_shopping_terminology`)

## AI 콘텐츠 생성
- RFQ 무인 인터뷰: 4단계 (Interview → ProposalReview → FactBombing → Communication), Gemini 2.5 Flash 사용
- **외부 원문 데이터는 그대로 보존** — AI가 요약/재구성하지 않습니다
- `attractions.long_desc`는 원문만 저장, 없으면 null
- 카드뉴스/마케팅 카피: 원문에 명시되지 않은 사실(연령제한·할인조건·여권조건 등) 절대 추가 금지 (feedback `feedback_card_news_faithfulness`)
