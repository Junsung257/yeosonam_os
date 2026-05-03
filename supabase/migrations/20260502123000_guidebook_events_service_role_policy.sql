-- 이미 guidebook_events 만 적용된 DB용 보강 (RLS만 켜져 있던 경우)
BEGIN;

DROP POLICY IF EXISTS "guidebook_events service role" ON guidebook_events;
CREATE POLICY "guidebook_events service role"
  ON guidebook_events FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

COMMIT;
