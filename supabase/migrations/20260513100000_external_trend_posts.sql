-- ============================================================================
-- PR-2: external_trend_posts — Threads/IG 외부 트렌드 raw signal 저장
-- ============================================================================
-- 목적: Threads keyword search + IG hashtag top_media 결과를 매일 적재.
--   - PII 미저장 (username/profile_pic/follower_count 저장 X)
--   - 본문 텍스트는 트렌드 분석용으로만 30일 후 자동 expire
--   - 카드뉴스/Threads 자동 발행 시 hook 패턴 retrieval에 사용
--
-- PIPA 가드:
--   - personal_data_present 컬럼으로 식별 가능 정보 포함 여부 표시
--   - expires_at < now() 인 row는 별도 cron으로 삭제
-- ============================================================================

CREATE TABLE IF NOT EXISTS external_trend_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,                 -- 'threads' | 'instagram'
  external_id TEXT,                        -- Threads media_id / IG media_id (해시 권장)
  keyword TEXT NOT NULL,                   -- 검색 키워드
  search_type TEXT,                        -- 'TOP' | 'RECENT' | 'HASHTAG_TOP_MEDIA'
  related_destination TEXT,                -- 매칭된 destination

  -- 본문/피처 (PII 제거)
  post_text TEXT,                          -- 본문 (Threads). IG는 caption.
  hook_words INTEGER,                      -- 첫 문장 단어 수
  hook_first_line TEXT,                    -- 첫 줄만 (분석용)
  hook_type TEXT,                          -- LLM 분류: urgency|question|number|fomo|story|contrarian|gap|listicle_with_twist|data_story
  has_image BOOLEAN DEFAULT FALSE,
  has_carousel BOOLEAN DEFAULT FALSE,
  cover_image_url TEXT,                    -- IG carousel cover (CLIP 임베딩용, 30일 후 hash로 대체)
  hashtag_count INTEGER,
  emoji_count INTEGER,

  -- Engagement (정규화)
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  saves INTEGER,
  views INTEGER,
  reach INTEGER,
  replies INTEGER,                         -- Threads
  reposts INTEGER,                         -- Threads
  quotes INTEGER,                          -- Threads

  -- 파생
  engagement_rate NUMERIC(7, 4),           -- (likes+comments+shares+saves)/views
  reply_velocity_30m NUMERIC(7, 3),        -- Threads 첫 30분 댓글 수
  performance_score NUMERIC(5, 4),         -- 0~1 정규화 점수

  -- PIPA 가드
  personal_data_present BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),

  raw_response JSONB,                      -- forward-compat. 본문 외 PII는 제거 후 저장.
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  post_published_at TIMESTAMPTZ,

  CONSTRAINT chk_etp_platform CHECK (platform IN ('threads', 'instagram'))
);

CREATE INDEX IF NOT EXISTS idx_etp_keyword_time
  ON external_trend_posts (keyword, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_etp_platform_perf
  ON external_trend_posts (platform, performance_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_etp_destination
  ON external_trend_posts (related_destination, captured_at DESC)
  WHERE related_destination IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_etp_hook_type
  ON external_trend_posts (hook_type, captured_at DESC)
  WHERE hook_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_etp_expires
  ON external_trend_posts (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_etp_external
  ON external_trend_posts (platform, external_id)
  WHERE external_id IS NOT NULL;

COMMENT ON TABLE external_trend_posts IS
  'Threads/IG 트렌드 raw signal. PII 미저장, 30일 후 expire. 카드뉴스 hook retrieval용.';

-- ============================================================================
-- trending_hooks_7d — 7일 rolling top hooks (자료 화면)
-- ============================================================================
CREATE OR REPLACE VIEW trending_hooks_7d AS
SELECT
  platform,
  COALESCE(related_destination, 'global')                        AS destination,
  hook_type,
  COUNT(*)                                                        AS sample_count,
  AVG(performance_score) FILTER (WHERE performance_score IS NOT NULL)         AS avg_score,
  AVG(engagement_rate)   FILTER (WHERE engagement_rate IS NOT NULL)           AS avg_er,
  AVG(hook_words)        FILTER (WHERE hook_words IS NOT NULL)                AS avg_hook_words,
  -- 상위 5건의 first_line 만 샘플로 (분석/프롬프트 주입용)
  (ARRAY_AGG(hook_first_line ORDER BY performance_score DESC NULLS LAST))[1:5] AS sample_first_lines,
  MAX(captured_at)                                                AS latest_captured_at
FROM external_trend_posts
WHERE captured_at >= now() - interval '7 days'
  AND hook_type IS NOT NULL
GROUP BY 1, 2, 3
HAVING COUNT(*) >= 3;

COMMENT ON VIEW trending_hooks_7d IS
  '7일 rolling top hooks. 카드뉴스 카피라이터 prompt 주입용. sample_count >= 3 만 노출.';
