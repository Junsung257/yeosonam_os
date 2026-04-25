-- @ts-nocheck
-- 20260427110000_card_news_variant_group.sql
--
-- Variant Generator + Auto-winner Loop 지원.
--
-- 한 상품 → N장 카드뉴스 변형 동시 생성 → engagement 측정 → winner 자동 식별.
-- AdCreative.ai / Smartly.io 의 Performance Score + Auto-rotation 패턴.

ALTER TABLE card_news
  ADD COLUMN IF NOT EXISTS variant_group_id UUID,
  ADD COLUMN IF NOT EXISTS variant_angle TEXT,
  ADD COLUMN IF NOT EXISTS variant_score NUMERIC,           -- Cover Critic 6장 평균 (0-100)
  ADD COLUMN IF NOT EXISTS variant_score_detail JSONB,      -- 카드별 점수 + 이슈
  ADD COLUMN IF NOT EXISTS engagement_score NUMERIC,        -- 발행 후 IG engagement 기반 (0-100)
  ADD COLUMN IF NOT EXISTS engagement_measured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_winner BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS winner_decided_at TIMESTAMPTZ;

COMMENT ON COLUMN card_news.variant_group_id IS '같은 상품에서 생성된 N개 변형이 공유하는 그룹 UUID';
COMMENT ON COLUMN card_news.variant_angle IS '이 변형의 각도 (luxury/value/urgency/emotional/filial/activity/food)';
COMMENT ON COLUMN card_news.variant_score IS 'Cover Critic 6장 평균 점수 (0-100), 사전 품질 예측';
COMMENT ON COLUMN card_news.variant_score_detail IS '{ cards: [{ index, score, issues }], avg_score, dimensions, verdict }';
COMMENT ON COLUMN card_news.engagement_score IS '발행 후 IG engagement 정규화 점수 (좋아요·댓글·도달 가중)';
COMMENT ON COLUMN card_news.engagement_measured_at IS 'engagement_score 마지막 측정 시각';
COMMENT ON COLUMN card_news.is_winner IS 'Auto-winner Loop 에서 그룹 내 우승자로 결정됨';
COMMENT ON COLUMN card_news.winner_decided_at IS 'winner 결정 시각';

CREATE INDEX IF NOT EXISTS idx_card_news_variant_group
  ON card_news(variant_group_id) WHERE variant_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_card_news_variant_score
  ON card_news(variant_score DESC) WHERE variant_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_card_news_engagement
  ON card_news(engagement_score DESC) WHERE engagement_score IS NOT NULL;
