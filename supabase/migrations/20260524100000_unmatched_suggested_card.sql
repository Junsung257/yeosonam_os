-- PR #94 (ERR-XIY-2026-05-16) — 신규 지역 등록 직후 자동 paste-and-parse 결과 적재.
ALTER TABLE unmatched_activities
  ADD COLUMN IF NOT EXISTS suggested_card jsonb,
  ADD COLUMN IF NOT EXISTS suggested_at timestamptz;

COMMENT ON COLUMN unmatched_activities.suggested_card IS
  '백그라운드 paste-and-parse 가 생성한 attraction 카드 추천 (name/short_desc/long_desc/aliases/badge_type/emoji). 사장님 어드민에서 1-click 등록 가능.';

COMMENT ON COLUMN unmatched_activities.suggested_at IS
  'suggested_card 생성 시각. 24시간 stale 처리 trigger 가능.';

CREATE INDEX IF NOT EXISTS idx_unmatched_suggested_pending
  ON unmatched_activities(suggested_at DESC)
  WHERE status = 'pending' AND suggested_card IS NOT NULL;
