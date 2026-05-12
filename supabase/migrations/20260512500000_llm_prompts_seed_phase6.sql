-- ═══════════════════════════════════════════════════════════════════════════
-- LLM Prompt Registry — Phase 6 시드 (R2 추가 이관)
-- 추가 일자: 2026-05-10
-- ON CONFLICT DO NOTHING 으로 재실행 멱등성 보장
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. attraction-extract-v1
--    동적 변수: {{names_list}} → 코드에서 .replace() 로 주입
--    소스: src/app/api/upload/route.ts attraction extraction (Phase 4)
INSERT INTO llm_prompts (key, body, version, is_active, task_type, metadata, created_by, change_note)
VALUES (
  'attraction-extract-v1',
  $BODY$아래 여행 일정 텍스트에서 핵심 관광지/활동명을 추출하고, 1줄 설명과 이모지를 반환하세요.

★ name 규칙 (가장 중요):
- name은 반드시 2~6자의 짧은 핵심 키워드만. 수식어/설명 절대 포함 금지.
- 입력: "절벽에 새겨진 황금불상 황금절벽사원 및 코끼리트래킹" → name: "황금절벽사원" (수식어 제거)
- 입력: "방콕의 현대식 야시장 아시아티크" → name: "아시아티크" (수식어 제거)
- 입력: "태국에서 가장 오래된 왓포사원" → name: "왓포사원" (수식어 제거)
- 입력: "호텔 투숙 및 휴식" → skip: true (관광지 아님)
- 입력: "파타야로 이동" → skip: true (이동)

카테고리: sightseeing|temple|market|museum|nature|palace|shopping|entertainment|park|beach|cultural
관광 활동이 아닌 항목(이동, 수속, 호텔체크인, 자유시간, 휴식, 조식, 체크아웃, 공항이동 등)은 skip:true.

목록:
{{names_list}}

반환 형식 (JSON 배열만, 마크다운 없이):
[{"name":"짧은키워드","desc":"매력적 1줄 설명(15~25자)","category":"sightseeing","emoji":"🏛️","skip":false}]$BODY$,
  1, true, 'parse_travel_doc',
  '{"dynamic_vars": ["names_list"], "source": "src/app/api/upload/route.ts", "model": "gemini-2.5-flash"}'::jsonb,
  'system', 'Phase 6 seed — attraction-extract-v1 DB 등록 (R2)'
)
ON CONFLICT (key, version) DO NOTHING;
