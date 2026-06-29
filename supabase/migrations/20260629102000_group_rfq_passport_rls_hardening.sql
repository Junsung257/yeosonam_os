-- Group RFQ passport RLS hardening
-- 2026-06-29

DROP POLICY IF EXISTS "Anyone can insert travel history" ON user_travel_histories;
DROP POLICY IF EXISTS "Service role can insert travel history" ON user_travel_histories;
DROP POLICY IF EXISTS "Users can view own travel history" ON user_travel_histories;

CREATE POLICY "Users can view own travel history" ON user_travel_histories
  FOR SELECT
  TO authenticated
  USING (
    customer_id IN (
      SELECT c.id
      FROM customers c
      WHERE c.phone = (
        SELECT au.phone
        FROM auth.users au
        WHERE au.id = auth.uid()
      )
    )
  );

CREATE POLICY "Service role can insert travel history" ON user_travel_histories
  FOR INSERT
  TO service_role
  WITH CHECK (true);
