-- ═══════════════════════════════════════════════════════════════════
-- registration_auto_policy: Conformal Abstention 컬럼 추가
-- 박제일: 2026-05-22
-- 출처: Mitigating LLM Hallucinations via Conformal Abstention (arXiv 2405.01563)
--       Learning Conformal Abstention Policies (arXiv 2502.06884)
-- 사유: confidence 95% 휴리스틱이 거짓 신호 — "0.85 통과했는데 실제 오류 4건"
--       calibration set (BAD ground truth) 의 confidence 분포에서 (1-alpha) quantile
--       을 임계값으로 사용 → false-accept rate ≤ alpha 수학적 보장.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE registration_auto_policy
  ADD COLUMN IF NOT EXISTS conformal_threshold        numeric(4,3),                  -- NULL: 미보정, fallback to auto_publish_above
  ADD COLUMN IF NOT EXISTS conformal_target_alpha     numeric(4,3) DEFAULT 0.05,     -- 허용 false-accept rate
  ADD COLUMN IF NOT EXISTS conformal_min_sample       int          DEFAULT 20,      -- cold-start 가드
  ADD COLUMN IF NOT EXISTS conformal_sample_size      int,                            -- 마지막 보정 시 calibration set 크기
  ADD COLUMN IF NOT EXISTS conformal_last_calibrated_at timestamptz,                  -- 마지막 재계산 시각 (24h stale 트리거)
  ADD COLUMN IF NOT EXISTS conformal_enabled          boolean       DEFAULT true;     -- 보수적 toggle (긴급 시 false)

COMMENT ON COLUMN registration_auto_policy.conformal_threshold IS
  'Conformal Abstention 임계값 (BAD set confidence 의 (1-alpha) quantile). NULL/sample<min_sample 시 auto_publish_above 사용.';
COMMENT ON COLUMN registration_auto_policy.conformal_target_alpha IS
  '허용 false-accept rate. 0.05 = BAD 의 5% 만 auto_publish 통과 허용 (95% 차단).';
