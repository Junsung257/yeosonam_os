-- PR #92 (ERR-XIY-2026-05-16) — 사장님 입력 우선 잠금.
-- 자동 채움 (Wikipedia/Wikimedia/DeepSeek) vs 사장님 paste/인라인 편집 충돌 시 사장님 입력 절대 우선.

ALTER TABLE attractions
  ADD COLUMN IF NOT EXISTS is_manual_override boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS last_owner_edited_at timestamptz;

COMMENT ON COLUMN attractions.is_manual_override IS
  '사장님 인라인 편집 또는 paste-and-parse 입력 시 true. true 면 자동 채움(fill_from_wikipedia/llm 등) skip.';

COMMENT ON COLUMN attractions.last_owner_edited_at IS
  '사장님 마지막 직접 편집 시각. 자동 채움 시 source/seeded_at 와 비교하여 우선순위 판단.';

CREATE INDEX IF NOT EXISTS idx_attractions_manual_override
  ON attractions(is_manual_override)
  WHERE is_manual_override = false;
