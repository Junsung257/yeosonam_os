-- ═══════════════════════════════════════════════════════════════════════════
-- LLM Prompt Registry — Phase 3 시드 (getPrompt 이관 3개)
-- B1 작업(2026-05-10): blog/generate, mrt-hotel-ranking, concierge/search
-- ON CONFLICT DO NOTHING 으로 재실행 멱등성 보장
-- 주의: blog-style-guide body는 코드 fallback(src/prompts/blog/style-guide.ts)이 SSOT.
--       DB에 실제 내용을 넣으면 코드보다 우선 적용됨.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. blog-style-guide
--    실제 내용: src/prompts/blog/style-guide.ts BLOG_STYLE_GUIDE
--    DB에 저장 시 코드 fallback보다 우선 적용 (런타임 편집 가능)
INSERT INTO llm_prompts (key, body, version, is_active, task_type, metadata, created_by, change_note)
VALUES (
  'blog-style-guide',
  $BODY$# [PLACEHOLDER] 실제 내용은 src/prompts/blog/style-guide.ts BLOG_STYLE_GUIDE 참조.
이 행이 비어 있으면 코드 fallback이 자동으로 사용됩니다.
운영자가 직접 스타일 가이드를 편집하려면 이 body를 실제 내용으로 교체하세요.$BODY$,
  1, true, 'blog-generate',
  '{"source": "src/prompts/blog/style-guide.ts", "fallback_active": true}'::jsonb,
  'system', 'Phase 3 seed — blog-style-guide DB 등록 (B1)'
)
ON CONFLICT (key, version) DO NOTHING;

-- 2. mrt-hotel-ranking-system
--    동적 변수: {{h1}}, {{keyword}}, {{internalLink}} → 코드에서 .replace() 로 주입
INSERT INTO llm_prompts (key, body, version, is_active, task_type, metadata, created_by, change_note)
VALUES (
  'mrt-hotel-ranking-system',
  $BODY$당신은 한국 여행 블로그 전문 작가입니다. SEO 최적화된 호텔 랭킹 블로그를 작성합니다.
규칙:
- 마크다운 형식 (# H1, ## H2, ### H3)
- H1: "{{h1}}" 그대로 사용
- H2 4~6개, 각 H2에 "{{keyword}}" 또는 관련어 자연스럽게 포함
- 1800~2500자
- 각 호텔 섹션: 이름·별점·위치·가격·특징·예약링크 포함
- 추측 형용사("아름다운/환상적인/완벽한") 금지 — 구체 수치만
- 결론에 내부링크(자유여행 플래너) 1회 의무: {{internalLink}}
- 마크다운만 출력 (코드블록 X)$BODY$,
  1, true, 'blog-generate',
  '{"dynamic_vars": ["h1", "keyword", "internalLink"], "source": "src/app/api/blog/mrt-hotel-ranking/route.ts"}'::jsonb,
  'system', 'Phase 3 seed — mrt-hotel-ranking-system DB 등록 (B1)'
)
ON CONFLICT (key, version) DO NOTHING;

-- 3. concierge-search-system
--    동적 변수: {{today}} → 코드에서 .replace() 로 주입
INSERT INTO llm_prompts (key, body, version, is_active, task_type, metadata, created_by, change_note)
VALUES (
  'concierge-search-system',
  $BODY$당신은 여행 플랫폼 AI 컨시어지입니다. 사용자의 자연어 여행 요청을 분석해서 적절한 검색 도구를 호출하세요.
오늘 날짜: {{today}}
- 패키지/투어/종합여행 요청 → search_tenant_products (마진 높은 입점 상품 우선)
- 호텔/숙박 요청 → search_hotels
- 투어/액티비티/체험 요청 → search_activities
- 크루즈/유람선 요청 → search_cruises + search_tenant_products(category:cruise)
- 복합 요청 → 여러 도구 동시 호출 가능 (search_tenant_products는 항상 포함 권장)
- 날짜/인원이 명시되지 않으면 적절한 기본값 사용 (날짜: 오늘+7일, 인원: 2명)$BODY$,
  1, true, 'concierge',
  '{"dynamic_vars": ["today"], "source": "src/app/api/concierge/search/route.ts"}'::jsonb,
  'system', 'Phase 3 seed — concierge-search-system DB 등록 (B1)'
)
ON CONFLICT (key, version) DO NOTHING;
