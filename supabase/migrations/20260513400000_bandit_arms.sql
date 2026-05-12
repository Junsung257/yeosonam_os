-- ============================================================================
-- PR-6: bandit_arms — Thompson Sampling 4-arm 변형 선택기
-- ============================================================================
-- arm_key = "{hook_type}::{palette_category}::{slide_bucket}::{hour_bucket}"
--   slide_bucket: 7-8 | 9-10 | other
--   hour_bucket:  morning(9-12) | lunch(12-14) | evening(18-21) | night(0-8) | afternoon(14-18) | late(22-23)
--
-- prior Beta(2, 2) — moderate exploration
-- reward = performance_score (0~1) → α += reward, β += 1 - reward
-- 7일 후 sync-engagement가 reward 업데이트
-- ============================================================================

CREATE TABLE IF NOT EXISTS bandit_arms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arm_key TEXT NOT NULL UNIQUE,
  hook_type TEXT,
  palette_category TEXT,
  slide_bucket TEXT,
  hour_bucket TEXT,

  -- Beta 분포 파라미터 (prior 2,2)
  alpha NUMERIC(10, 4) NOT NULL DEFAULT 2.0,
  beta  NUMERIC(10, 4) NOT NULL DEFAULT 2.0,

  -- 통계
  total_pulls INTEGER NOT NULL DEFAULT 0,
  total_rewards NUMERIC(10, 4) NOT NULL DEFAULT 0,
  last_pull_at TIMESTAMPTZ,
  last_reward_at TIMESTAMPTZ,

  -- 활성 여부 (저성과 arm 자동 비활성)
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bandit_active
  ON bandit_arms (is_active, total_pulls DESC);

COMMENT ON TABLE bandit_arms IS
  'Thompson Sampling bandit arms. hook_type × palette × slide_bucket × hour_bucket. Beta(alpha, beta) prior.';

-- card_news에 bandit_arm 컬럼 추가 — 발행 시 어떤 arm으로 결정됐는지 추적
ALTER TABLE card_news
  ADD COLUMN IF NOT EXISTS bandit_arm TEXT,
  ADD COLUMN IF NOT EXISTS bandit_reward_applied BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_card_news_bandit_arm
  ON card_news (bandit_arm, ig_published_at DESC)
  WHERE bandit_arm IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_card_news_bandit_reward_pending
  ON card_news (ig_published_at DESC)
  WHERE bandit_arm IS NOT NULL AND bandit_reward_applied = FALSE AND ig_post_id IS NOT NULL;

COMMENT ON COLUMN card_news.bandit_arm IS
  '발행 시 선택된 arm_key. 7일 후 sync-engagement 가 performance_score → arm reward 업데이트.';
