-- ──────────────────────────────────────────────────────────────────
-- Self-Healing keyword reactivation tracking columns
-- ──────────────────────────────────────────────────────────────────
-- 근거: Google Ads "Low activity system bulk changes" (2026.02) + Optmyzr 표준 패턴.
-- 자동 PAUSE 된 키워드를 일정 기간(기본 7일) 후 trial reactivation 시도. 다시 미달이면
-- pause_count++, 일정 한도(기본 3회) 초과 시 영구 PAUSE.
--
-- 모두 IF NOT EXISTS / DEFAULT 박혀있어 회귀 위험 0. 기존 row 는 NULL/0 유지.

ALTER TABLE keyword_performances
  ADD COLUMN IF NOT EXISTS pause_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reactivation_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS permanently_paused BOOLEAN NOT NULL DEFAULT FALSE;

-- self-healing cron 이 자주 조회할 인덱스 (status + last_paused_at)
CREATE INDEX IF NOT EXISTS idx_keyword_perf_self_healing
  ON keyword_performances (status, last_paused_at)
  WHERE status = 'PAUSED' AND permanently_paused = FALSE;

COMMENT ON COLUMN keyword_performances.pause_count IS
  '누적 자동 PAUSE 횟수. 3회 이상 시 permanently_paused=TRUE 로 마킹 (반복 trial 차단).';
COMMENT ON COLUMN keyword_performances.last_paused_at IS
  '마지막 PAUSE 시각. self-healing cron 이 24-168h 후 trial reactivation 후보 선별에 사용.';
COMMENT ON COLUMN keyword_performances.last_reactivation_at IS
  '마지막 trial reactivation 시각. 동일 키워드 24h 내 재 reactivation 차단.';
COMMENT ON COLUMN keyword_performances.permanently_paused IS
  '영구 PAUSE 마킹. 3회 자동 PAUSE 누적 시 self-healing 대상에서 제외.';
