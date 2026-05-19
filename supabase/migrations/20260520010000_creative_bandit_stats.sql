-- ──────────────────────────────────────────────────────────────────
-- Thompson Sampling Multi-Armed Bandit stats for ad creatives
-- ──────────────────────────────────────────────────────────────────
-- 근거 (학술/오픈소스):
--   - Chapelle & Li 2011 "An Empirical Evaluation of Thompson Sampling" (NeurIPS)
--   - Google Analytics Optimize 의 표준 알고리즘
--   - https://github.com/sharmaroshan/Ads-Optimization (오픈소스 reference)
--   - arXiv 2108.06812 "Batched Thompson Sampling for Multi-Armed Bandits"
--
-- 패턴:
--   각 ad_creatives 변형마다 Beta(success+1, failure+1) 사전분포 유지.
--   매 노출 결정 시 모든 변형의 Beta 분포에서 1회 샘플링 → 최댓값 변형 선택 (exploration vs exploitation 자동).
--   결과(click=success, no-click=failure)로 카운트 업데이트.
--
-- 회귀 위험 0: IF NOT EXISTS + DEFAULT 0. 기존 row 영향 없음.

ALTER TABLE ad_creatives
  ADD COLUMN IF NOT EXISTS bandit_success_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bandit_trial_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bandit_last_selected_at TIMESTAMPTZ;

-- Thompson sampling 결과 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_ad_creatives_bandit
  ON ad_creatives (package_id, platform, bandit_trial_count DESC);

COMMENT ON COLUMN ad_creatives.bandit_success_count IS
  'Thompson sampling 누적 success (click/conversion 등 outcome=true 카운트).';
COMMENT ON COLUMN ad_creatives.bandit_trial_count IS
  'Thompson sampling 누적 trial (노출 시도 카운트). failure_count = trial - success.';
COMMENT ON COLUMN ad_creatives.bandit_last_selected_at IS
  '마지막 selectCreativeByThompson 호출 시각. 콜드 스타트 분석용.';
