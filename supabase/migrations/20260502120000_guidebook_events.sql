-- 모바일 가이드북 세부 행동 로그 (비개인식별 guide_ref)
BEGIN;

CREATE TABLE IF NOT EXISTS guidebook_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  guide_ref   TEXT NOT NULL,
  action      TEXT NOT NULL,
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_guidebook_events_created
  ON guidebook_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guidebook_events_action_created
  ON guidebook_events (action, created_at DESC);

COMMENT ON TABLE guidebook_events IS
  '가이드북 허브 클릭/조회. guide_ref는 토큰 해시 앞부분(비가역).';

ALTER TABLE guidebook_events ENABLE ROW LEVEL SECURITY;

-- platform_learning_events 와 동일: 서버(service_role) 적재·조회. anon/authenticated 기본 차단
DROP POLICY IF EXISTS "guidebook_events service role" ON guidebook_events;
CREATE POLICY "guidebook_events service role"
  ON guidebook_events FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

COMMIT;
