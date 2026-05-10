-- ═══════════════════════════════════════════════════════════════════════════
-- LLM Prompt Registry — Phase 5 시드 (P4+P5 추가 이관)
-- 추가 일자: 2026-05-10
-- ON CONFLICT DO NOTHING 으로 재실행 멱등성 보장
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. invoice-parse-v1
--    소스: src/app/api/admin/invoice/parse/route.ts INVOICE_PARSE_FALLBACK
INSERT INTO llm_prompts (key, body, version, is_active, task_type, metadata, created_by, change_note)
VALUES (
  'invoice-parse-v1',
  $BODY$이 청구서(인보이스) 이미지를 분석해서 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.

{
  "vendor": "공급업체명 또는 랜드사명",
  "invoice_date": "YYYY-MM-DD 형식 또는 null",
  "currency": "KRW 또는 USD 또는 기타 통화코드",
  "amount_krw": 원화 금액(숫자) 또는 null,
  "amount_usd": 달러 금액(숫자) 또는 null,
  "items": [
    { "description": "항목 설명", "amount": 금액(숫자) }
  ],
  "total": 합계금액(숫자) 또는 null
}

규칙:
- 금액은 쉼표 없는 순수 숫자로
- 날짜가 없으면 invoice_date는 null
- 항목이 없으면 items는 빈 배열 []
- 반드시 valid JSON만 반환$BODY$,
  1, true, 'ocr',
  '{"source": "src/app/api/admin/invoice/parse/route.ts", "model": "gemini-2.0-flash"}'::jsonb,
  'system', 'Phase 5 seed — invoice-parse-v1 DB 등록 (P4)'
)
ON CONFLICT (key, version) DO NOTHING;

-- 2. product-scan-system
--    소스: src/app/api/products/scan/route.ts PRODUCT_SCAN_FALLBACK (DeepSeek system)
INSERT INTO llm_prompts (key, body, version, is_active, task_type, metadata, created_by, change_note)
VALUES (
  'product-scan-system',
  $BODY$당신은 여행사 내부 ERP용 상품 파일 분석 전문가입니다.
문서에서 상품 정보를 추출하여 순수 JSON으로만 응답하세요 (마크다운 코드블록 없이).

규칙:
- destination_code: IATA 도시코드 3자리 대문자 (마카오→MAC, 방콕→BKK 등)
- departure_region_code: 출발 공항코드 (부산/김해→PUS, 인천/서울→ICN, 김포→GMP, 제주→CJU, 대구→TAE, 광주→KWJ)
- duration_days: 여행 총 일수 숫자만 (3박5일→5, 4박6일→6)
- net_price: 원가(도매가) 원화 정수. 달러($)면 ×1350 환산. 없으면 null
- departure_date: 가장 빠른 출발일 YYYY-MM-DD. 없으면 null
- ai_tags: 상품 특징 태그 배열 (예: ["노팁노옵션", "소규모", "실속", "골프포함"])$BODY$,
  1, true, 'parse_travel_doc',
  '{"source": "src/app/api/products/scan/route.ts", "model": "deepseek"}'::jsonb,
  'system', 'Phase 5 seed — product-scan-system DB 등록 (P4)'
)
ON CONFLICT (key, version) DO NOTHING;

-- 3. product-faq-generation
--    동적 변수: {{display_name}}, {{destination}}, {{snippet}}
INSERT INTO llm_prompts (key, body, version, is_active, task_type, metadata, created_by, change_note)
VALUES (
  'product-faq-generation',
  $BODY$다음 여행상품 원문을 분석하여, 고객이 자주 물어볼 질문 10개와 정확한 답변을 생성하세요.
답변은 반드시 원문에 근거하여 작성하고, 원문에 없는 내용은 "별도 문의 부탁드립니다"로 처리하세요.
원가/랜드사 등 내부 정보는 절대 포함하지 마세요.

출력 형식 (JSON 배열만, 마크다운 없이):
[{"q":"질문","a":"답변"},...]

상품명: {{display_name}}
목적지: {{destination}}

원문:
{{snippet}}$BODY$,
  1, true, 'classify',
  '{"dynamic_vars": ["display_name", "destination", "snippet"], "source": "src/app/api/products/review/route.ts handleFaq"}'::jsonb,
  'system', 'Phase 5 seed — product-faq-generation DB 등록 (P5)'
)
ON CONFLICT (key, version) DO NOTHING;
