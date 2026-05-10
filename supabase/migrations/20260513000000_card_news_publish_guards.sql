-- ============================================================================
-- PR-1: card_news_publish_guards — 자동 발행 안전 그물
-- ============================================================================
-- 목적: 외부 트렌드 학습 + 전 자동 발행 도입 시 4중 안전 가드.
--   1. 일일 발행 한도 (max_per_day_per_brand)
--   2. critic 게이트 임계값 (min_predicted_er, PR-5에서 활성화)
--   3. engagement-bait 블랙리스트 (별도 테이블 X — 코드 상수 + DB 보강 패턴)
--   4. 자동 발행 전체 토글 (auto_publish_enabled, PR-6에서 켬)
--   5. 이상치 자동 정지 플래그 (anomaly_paused_until)
--
-- 단일 row 정책 (id=1) — brand_id 별 확장 시 row 추가.
-- ============================================================================

CREATE TABLE IF NOT EXISTS card_news_publish_guards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID,                          -- NULL = 전역 기본값. brand_kits.id FK 권고하나 soft.
  scope_label TEXT NOT NULL DEFAULT 'global',

  -- 일일 한도
  max_per_day_per_brand INTEGER NOT NULL DEFAULT 5,
  max_per_day_threads   INTEGER NOT NULL DEFAULT 10,

  -- Critic 게이트 (PR-5)
  min_predicted_er NUMERIC(5, 4),         -- NULL = 게이트 비활성. 예: 0.0150 = 1.5%
  critic_max_iterations INTEGER NOT NULL DEFAULT 3,

  -- 자동 발행 플래그 (PR-6)
  auto_publish_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_publish_dry_run BOOLEAN NOT NULL DEFAULT TRUE,   -- TRUE = 변형 선택만, 실제 발행 X

  -- 이상치 자동 정지
  anomaly_paused_until TIMESTAMPTZ,
  anomaly_reason TEXT,

  -- 추가 블랙리스트 (코드 상수 외 DB로 동적 추가 가능)
  extra_blacklist_patterns TEXT[] DEFAULT ARRAY[]::TEXT[],

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_guards_brand
  ON card_news_publish_guards (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid));

COMMENT ON TABLE card_news_publish_guards IS
  '카드뉴스/Threads 자동 발행 안전 가드. brand_id NULL = 전역 기본값 (id 1건 유지).';

-- 기본 row (전역) — 비활성 상태로 출고
INSERT INTO card_news_publish_guards (brand_id, scope_label, auto_publish_enabled, auto_publish_dry_run, notes)
VALUES (NULL, 'global', FALSE, TRUE, 'PR-1 출고 시 비활성. PR-5 critic + PR-6 bandit 머지 후 사장님 토글로 활성화.')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- card_news_publish_decisions — 발행 직전 critic/bandit 결정 로그 (PR-5/6 활용)
-- ============================================================================
CREATE TABLE IF NOT EXISTS card_news_publish_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_news_id UUID REFERENCES card_news(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,                 -- 'instagram' | 'threads'
  decision TEXT NOT NULL,                 -- 'approved' | 'rejected_critic' | 'rejected_bait' | 'rejected_quota' | 'auto_paused'
  predicted_er NUMERIC(6, 4),
  features JSONB,                         -- {hook_type, slide_count, color_archetype, posting_hour, ...}
  bait_match TEXT,
  bandit_arm TEXT,
  iteration INTEGER NOT NULL DEFAULT 0,
  rejected_reason TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pub_decisions_card
  ON card_news_publish_decisions (card_news_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_pub_decisions_platform_time
  ON card_news_publish_decisions (platform, decided_at DESC);

COMMENT ON TABLE card_news_publish_decisions IS
  '자동 발행 critic/bandit 결정 로그. 일일 한도·이상치 감지·롤백 분석에 사용.';
