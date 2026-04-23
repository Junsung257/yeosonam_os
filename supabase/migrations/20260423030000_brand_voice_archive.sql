-- ============================================================
-- Brand Voice Archive
-- 마이그레이션: 20260423030000
-- 목적:
--   과거 성과 좋았던 자사 포스트를 "Brand Voice Sample" 로 저장.
--   AI 에이전트가 이 샘플을 few-shot learning 으로 활용 → 톤/문장구조 일관성.
--   Visme 2025.10 연구: 보이스 아카이브 기반 개인화 콘텐츠 → 전환율 향상.
-- ============================================================

BEGIN;

-- brand_kits 테이블에 voice_samples 필드 추가
ALTER TABLE brand_kits
  ADD COLUMN IF NOT EXISTS voice_samples JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS voice_guide TEXT;   -- 브랜드 톤 설명 (LLM 프롬프트에 주입)

COMMENT ON COLUMN brand_kits.voice_samples IS '[]개 과거 성과 좋았던 포스트. LLM few-shot용. 각 항목: {platform, content, performance_score, captured_at}';
COMMENT ON COLUMN brand_kits.voice_guide IS '브랜드 보이스 가이드 (자유 텍스트). 에이전트 프롬프트에 system prompt 접두어로 주입';

-- yeosonam 기본 voice_guide 업데이트
UPDATE brand_kits
SET voice_guide = '여소남 보이스:
- 친근하되 전문성 유지. 반말 금지, "이에요/예요" 톤.
- 숫자·가격은 구체적. "좋아요" 대신 "★ 4.9", "예약 50건".
- 이모지 최소 (✓ ★ · 선호, 🔥🎉 금지).
- 고객 호명: "사장님" 금지, "여행자 분" 또는 "~이신 분".
- 부정어(NO·금지) 최소. "추가비용 0원" 같이 긍정형.
- 여행사 잡언 금지 ("이 좋은 기회 놓치지 마세요" X).
- 1인칭 "저" 가능 (Threads).'
WHERE code = 'yeosonam' AND (voice_guide IS NULL OR voice_guide = '');

-- 샘플 voice_samples 씨드 (실제 성과 좋았던 콘텐츠로 대체 예정)
UPDATE brand_kits
SET voice_samples = '[
  {
    "platform": "instagram_caption",
    "content": "연차 없이 주말만, 41만원대 보홀 4박\n\n💡 이 가격에 이게 다 들어감\n- 왕복항공 · 호텔 4박 · 전식사\n- 팁 · 옵션 · 쇼핑 0원\n\n댓글에 보홀 남겨주세요\n특가 링크 DM 1초 발송\n\n✓ 여소남 검증 상품",
    "performance_score": 0.87,
    "captured_at": "2026-03-15"
  },
  {
    "platform": "threads_post",
    "content": "저 지난달에 보홀 다녀왔거든요.\n솔직히 이 가격에 이게 다 되는 게 신기해서 공유해요.\n\n4박6일, 왕복 항공 포함, 팁·옵션·쇼핑 전부 NO.\n41만원대 끝이었어요.\n\nDM으로 보홀 두 글자만 보내주시면 자료 쏴드림.",
    "performance_score": 0.72,
    "captured_at": "2026-04-01"
  }
]'::jsonb
WHERE code = 'yeosonam' AND (voice_samples IS NULL OR voice_samples = '[]'::jsonb);

COMMIT;

NOTIFY pgrst, 'reload schema';
