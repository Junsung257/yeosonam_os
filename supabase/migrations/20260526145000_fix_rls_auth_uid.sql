-- P0 fix: RLS 정책을 auth.uid() 기반으로 수정
-- 2026-05-26

-- 1. user_travel_histories SELECT: auth.uid() → customers.phone 매칭
DROP POLICY IF EXISTS "Users can view own travel history" ON user_travel_histories;

CREATE POLICY "Users can view own travel history" ON user_travel_histories
  FOR SELECT USING (
    customer_id IN (
      SELECT c.id FROM customers c
      WHERE c.phone = (
        SELECT au.phone FROM auth.users au WHERE au.id = auth.uid()
      )
    )
  );

-- 2. user_travel_histories INSERT: service_role + authenticated anon 모두 허용
DROP POLICY IF EXISTS "Service role can insert travel history" ON user_travel_histories;

CREATE POLICY "Anyone can insert travel history" ON user_travel_histories
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
    OR auth.role() = 'authenticated'
    -- anon(익명)이지만 customer_id가 customers 테이블에 존재하는 경우도 허용
    OR (
      auth.role() = 'anon'
      AND customer_id IN (SELECT id FROM customers)
    )
  );

-- 3. rfq_share_reactions INSERT: anon도 허용 (공유 페이지에서 비로그인 반응 가능)
DROP POLICY IF EXISTS "Anyone can insert reactions" ON rfq_share_reactions;

CREATE POLICY "Anyone can insert reactions" ON rfq_share_reactions
  FOR INSERT WITH CHECK (true);

-- 4. total_price INTEGER → BIGINT (overflow 방지)
ALTER TABLE user_travel_histories
  ALTER COLUMN total_price TYPE BIGINT USING total_price::bigint;

-- 5. 중복 INSERT 방지: (customer_id, rfq_id) 유니크 제약
DELETE FROM user_travel_histories
WHERE ctid NOT IN (
  SELECT MIN(ctid) FROM user_travel_histories GROUP BY customer_id, rfq_id
);
ALTER TABLE user_travel_histories
  ADD CONSTRAINT uq_travel_histories_rfq UNIQUE (customer_id, rfq_id);
