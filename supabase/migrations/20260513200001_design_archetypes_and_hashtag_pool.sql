-- ============================================================================
-- PR-3: card_news_design_archetypes + ig_hashtag_pool
-- ============================================================================
-- card_news_design_archetypes: Gemini Vision 분석 결과 클러스터 (palette × layout × emotion × density)
-- ig_hashtag_pool: 7일 30개 한도 회전용 해시태그 풀
-- ============================================================================

CREATE TABLE IF NOT EXISTS card_news_design_archetypes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key TEXT NOT NULL UNIQUE,        -- "nature::photo_dominant::awe::medium"
  palette_category TEXT NOT NULL,
  layout_type TEXT NOT NULL,
  dominant_emotion TEXT NOT NULL,
  text_density TEXT NOT NULL,

  sample_count INTEGER NOT NULL DEFAULT 0,
  avg_engagement_rate NUMERIC(7, 4),
  avg_likes NUMERIC(10, 2),
  avg_comments NUMERIC(10, 2),

  top_hook_patterns TEXT[],               -- 빈도 상위 hook 패턴 (Gemini 분류)
  top_keywords TEXT[],                    -- 자주 등장한 destination/주제
  sample_external_ids TEXT[],             -- 대표 샘플 (외부 ID, 최대 10개)
  sample_image_urls TEXT[],               -- 대표 cover (최대 5개)

  rationale TEXT,                         -- 이 archetype 추천 사유 (palette getPaletteForCategory 결과 + 데이터)
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_archetypes_palette
  ON card_news_design_archetypes (palette_category, avg_engagement_rate DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_archetypes_active
  ON card_news_design_archetypes (is_active, sample_count DESC);

COMMENT ON TABLE card_news_design_archetypes IS
  'IG 카드뉴스 cover 디자인 archetype 클러스터. Gemini Vision 분석 결과 집계. 카드뉴스 생성 시 palette·layout 추천.';

-- ============================================================================
-- ig_hashtag_pool — 해시태그 회전 관리 (7일 30개 한도)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ig_hashtag_pool (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hashtag TEXT NOT NULL UNIQUE,           -- '#' 없이 저장
  related_destination TEXT,
  category TEXT,                          -- 'destination' | 'theme' | 'seasonal' | 'competitor'
  priority INTEGER NOT NULL DEFAULT 50,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hashtag_pool_active_priority
  ON ig_hashtag_pool (is_active, priority DESC, last_used_at ASC NULLS FIRST);

COMMENT ON TABLE ig_hashtag_pool IS
  'IG hashtag search 회전 풀. last_used_at 오래된 것부터 회전 (Meta 7일 30개 한도).';

-- 시드: 한국 여행 핵심 해시태그
INSERT INTO ig_hashtag_pool (hashtag, related_destination, category, priority)
VALUES
  ('해외여행',     NULL,         'theme',       80),
  ('여행스타그램', NULL,         'theme',       80),
  ('여행추천',     NULL,         'theme',       70),
  ('패키지여행',   NULL,         'theme',       70),
  ('발리여행',     '발리',       'destination', 85),
  ('다낭여행',     '다낭',       'destination', 85),
  ('제주도여행',   '제주',       'destination', 80),
  ('도쿄여행',     '도쿄',       'destination', 75),
  ('오사카여행',   '오사카',     'destination', 75),
  ('방콕여행',     '방콕',       'destination', 75),
  ('보홀여행',     '보홀',       'destination', 70),
  ('세부여행',     '세부',       'destination', 70),
  ('나트랑여행',   '나트랑',     'destination', 70),
  ('하노이여행',   '하노이',     'destination', 65),
  ('푸꾸옥여행',   '푸꾸옥',     'destination', 65),
  ('타이베이여행', '타이베이',   'destination', 65),
  ('하와이여행',   '하와이',     'destination', 70),
  ('괌여행',       '괌',         'destination', 65),
  ('사이판여행',   '사이판',     'destination', 60),
  ('블라디보스톡', '블라디보스톡','destination', 55)
ON CONFLICT (hashtag) DO NOTHING;

-- ============================================================================
-- ig_competitor_handles — Business Discovery 대상 경쟁사 IG 계정
-- ============================================================================
CREATE TABLE IF NOT EXISTS ig_competitor_handles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,          -- '@' 없이 저장
  brand_label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 50,
  last_fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO ig_competitor_handles (username, brand_label, priority)
VALUES
  ('myrealtrip',          '마이리얼트립',     90),
  ('hanatour_official',   '하나투어',         80),
  ('modetour_official',   '모두투어',         80),
  ('interpark_tour',      '인터파크투어',     70),
  ('norangtour',          '노랑풍선',         70),
  ('ynk_yeohaeng',        '연합뉴스 여행',    60)
ON CONFLICT (username) DO NOTHING;

COMMENT ON TABLE ig_competitor_handles IS
  'Business Discovery 대상 경쟁사 IG public 계정 화이트리스트. priority 높은 순으로 일별 호출.';
