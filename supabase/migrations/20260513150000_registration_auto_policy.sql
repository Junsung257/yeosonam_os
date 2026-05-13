-- ═══════════════════════════════════════════════════════════════════
-- registration_auto_policy: 등록 자동화 게이트 임계치 정책
-- 박제일: 2026-05-13 (F-4)
-- 사유: 컨펌 큐 → 풀자동 전환을 코드 변경 없이 어드민에서 조정 가능하게.
--       자동화 전환 트리거 조건도 추적 (project_registration_accuracy_roadmap).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS registration_auto_policy (
  id                          int PRIMARY KEY DEFAULT 1,
  auto_publish_above          numeric(4,3) NOT NULL DEFAULT 0.95,
  confirm_queue_above         numeric(4,3) NOT NULL DEFAULT 0.70,
  pending_review_above        numeric(4,3) NOT NULL DEFAULT 0.50,
  reject_leak_score_above     numeric(4,3) NOT NULL DEFAULT 0.40,
  full_auto_enabled           boolean NOT NULL DEFAULT false,
  trigger_max_reject_rate_30d numeric(4,3) DEFAULT 0.02,
  trigger_max_leak_per_week   int          DEFAULT 0,
  trigger_min_cove_pass_rate  numeric(4,3) DEFAULT 0.98,
  trigger_min_reflexion_count int          DEFAULT 100,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text,
  notes                       text,
  CONSTRAINT singleton CHECK (id = 1)
);

INSERT INTO registration_auto_policy (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE registration_auto_policy IS
  '등록 자동화 게이트 임계치 정책. 단일 행 (singleton). 컨펌 큐→풀자동 전환을 어드민에서 조정.';
COMMENT ON COLUMN registration_auto_policy.full_auto_enabled IS
  'false: confidence>=95% 도 confirm_queue 로 강제 (사장님 1-click). true: auto_publish 허용.';
