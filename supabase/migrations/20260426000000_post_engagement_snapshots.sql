-- ============================================================================
-- Phase 2: Engagement 시계열 스냅샷
-- ============================================================================
-- 배경: 기존 sync-engagement 크론은 content_distributions.engagement JSONB 를
-- 매번 덮어씀 → 좋아요 증가 속도, 피크 시간, 시간당 reach 변화 같은 시계열
-- 분석이 불가능.
--
-- 해결: append-only 스냅샷 테이블 추가. 기존 JSONB 는 "current" view 로 유지,
-- snapshots 는 "history" 역할. Umami / Plausible 패턴.
--
-- 조회 예시:
--   최근 7일 좋아요 추이:
--     SELECT captured_at, likes FROM post_engagement_snapshots
--     WHERE external_id = 'XXX' ORDER BY captured_at;
--   발행 후 1h vs 24h 차이 (bounce detection):
--     window 함수로 lag/lead.
-- ============================================================================

CREATE TABLE IF NOT EXISTS post_engagement_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Linkage (둘 중 최소 하나는 non-null)
  distribution_id UUID REFERENCES content_distributions(id) ON DELETE CASCADE,
  card_news_id UUID REFERENCES card_news(id) ON DELETE CASCADE,

  -- 플랫폼 식별
  platform TEXT NOT NULL,              -- 'instagram' | 'threads' | 'meta_ads' | 'kakao_channel'
  external_id TEXT NOT NULL,           -- ig_post_id, ad_id, threads_media_id …
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 정규화된 핵심 지표 (플랫폼 공통. 해당 없으면 NULL)
  views INTEGER,
  reach INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  saves INTEGER,
  clicks INTEGER,
  replies INTEGER,                     -- Threads 전용
  reposts INTEGER,                     -- Threads 전용
  quotes INTEGER,                      -- Threads 전용

  -- Ads 전용
  ctr NUMERIC(6, 4),
  spend NUMERIC(10, 2),
  impressions_legacy INTEGER,          -- 2024-07 이전 포스트용. 신규는 NULL

  -- 파생 스코어 (나중에 재계산 가능)
  performance_score NUMERIC(4, 3),

  -- 원본 응답 보존 (forward-compat)
  raw_response JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_linkage CHECK (distribution_id IS NOT NULL OR card_news_id IS NOT NULL)
);

COMMENT ON TABLE post_engagement_snapshots IS
  'append-only 시계열 engagement. 시간당 snapshot 1건 권장. history: content_distributions.engagement 는 latest view.';

-- 시계열 조회 핵심 인덱스
CREATE INDEX IF NOT EXISTS idx_peng_dist_time
  ON post_engagement_snapshots (distribution_id, captured_at DESC)
  WHERE distribution_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_peng_card_time
  ON post_engagement_snapshots (card_news_id, captured_at DESC)
  WHERE card_news_id IS NOT NULL;

-- 외부 ID (Meta media_id) 기준 조회 — 동일 포스트의 전체 이력
CREATE INDEX IF NOT EXISTS idx_peng_external
  ON post_engagement_snapshots (platform, external_id, captured_at DESC);

-- JSONB 원본 질의 (ad-hoc)
CREATE INDEX IF NOT EXISTS idx_peng_raw_gin
  ON post_engagement_snapshots USING gin (raw_response);

-- ============================================================================
-- "현재 상태" 편의 뷰 — 마지막 snapshot 만
-- 대시보드에서 content_distributions JOIN 대신 쓸 수 있음.
-- ============================================================================
CREATE OR REPLACE VIEW post_engagement_current AS
SELECT DISTINCT ON (platform, external_id)
  platform,
  external_id,
  distribution_id,
  card_news_id,
  captured_at,
  views,
  reach,
  likes,
  comments,
  shares,
  saves,
  clicks,
  replies,
  reposts,
  quotes,
  ctr,
  spend,
  performance_score
FROM post_engagement_snapshots
ORDER BY platform, external_id, captured_at DESC;

COMMENT ON VIEW post_engagement_current IS
  '외부 ID 별 최신 snapshot 1건. 대시보드/리스트 페이지에서 사용.';
