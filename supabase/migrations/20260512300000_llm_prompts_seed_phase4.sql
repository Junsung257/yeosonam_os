-- ═══════════════════════════════════════════════════════════════════════════
-- LLM Prompt Registry — Phase 4 시드 (P3 추가 이관)
-- 추가 일자: 2026-05-10
-- ON CONFLICT DO NOTHING 으로 재실행 멱등성 보장
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. passport-ocr-v1
--    소스: src/app/api/passport/ocr/route.ts PASSPORT_OCR_FALLBACK
INSERT INTO llm_prompts (key, body, version, is_active, task_type, metadata, created_by, change_note)
VALUES (
  'passport-ocr-v1',
  $BODY$이 여권 이미지에서 다음 정보를 추출하여 JSON으로만 응답하세요. 설명 없이 JSON만 반환하세요.

{
  "surname": "성 (한글 또는 영문)",
  "given_name": "이름 (한글 또는 영문)",
  "passport_no": "여권 번호 (예: M12345678)",
  "nationality": "국적 코드 (예: KOR, CHN, USA)",
  "birth_date": "생년월일 YYYY-MM-DD 형식",
  "expiry_date": "만료일 YYYY-MM-DD 형식",
  "gender": "성별 M 또는 F",
  "mrz_line1": "MRZ 첫째 줄 (기계 판독 영역 전체)",
  "mrz_line2": "MRZ 둘째 줄"
}

읽을 수 없는 필드는 null로 표시. 날짜는 반드시 YYYY-MM-DD 형식. MRZ의 날짜는 YYMMDD → YYYY-MM-DD 변환.$BODY$,
  1, true, 'ocr',
  '{"source": "src/app/api/passport/ocr/route.ts", "model": "gemini-2.0-flash"}'::jsonb,
  'system', 'Phase 4 seed — passport-ocr-v1 DB 등록 (P3)'
)
ON CONFLICT (key, version) DO NOTHING;

-- 2. review-sentiment-v1
--    동적 변수: {{rating}}, {{content}} → 코드에서 .replace() 로 주입
INSERT INTO llm_prompts (key, body, version, is_active, task_type, metadata, created_by, change_note)
VALUES (
  'review-sentiment-v1',
  $BODY$다음 여행 패키지 리뷰를 분석하여 JSON으로 응답하세요.

별점: {{rating}}/5
리뷰 내용: {{content}}

다음 형식의 JSON만 반환하세요 (설명 없이):
{
  "sentiment_score": 0-100 사이의 정수 (0=매우 부정, 100=매우 긍정),
  "tags": {
    "숙소": 0-100,
    "가이드": 0-100,
    "일정": 0-100,
    "식사": 0-100
  }
}

리뷰 내용에서 해당 카테고리 언급이 없으면 별점 기반으로 기본값 추정.$BODY$,
  1, true, 'classify',
  '{"dynamic_vars": ["rating", "content"], "source": "src/app/api/cron/review-sentiment/route.ts", "model": "gemini-2.0-flash"}'::jsonb,
  'system', 'Phase 4 seed — review-sentiment-v1 DB 등록 (P3)'
)
ON CONFLICT (key, version) DO NOTHING;
