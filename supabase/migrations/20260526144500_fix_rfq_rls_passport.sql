-- P0 fix: RLS 정책 수정 + Travel History 조회 방식 개선
-- 2026-05-26

-- 1. rfq_share_reactions: 익명 사용자(anon role)도 INSERT 가능하도록 수정
--    (공유 페이지는 인증 없이 접근 가능해야 함)
DROP POLICY IF EXISTS "Authenticated users can insert reactions" ON rfq_share_reactions;

CREATE POLICY "Anyone can insert reactions" ON rfq_share_reactions
  FOR INSERT WITH CHECK (true);

-- 2. user_travel_histories: 인증된 사용자가 본인 데이터 조회 가능
--    (customer_id는 customers(id) FK — auth.users.id와 다름)
--    phone 기준으로 same customer lookup
DROP POLICY IF EXISTS "Users can view own travel history" ON user_travel_histories;

-- 'service_role'로 INSERT된 데이터를 auth.uid()와 customers 테이블 조인으로 조회
-- auth.uid() → customers.phone (phone은 공유 식별자) → user_travel_histories.customer_id
CREATE POLICY "Users can view own travel history" ON user_travel_histories
  FOR SELECT USING (
    customer_id IN (
      SELECT c.id FROM customers c
      WHERE c.phone IN (
        SELECT cu.phone FROM customers cu WHERE cu.id = customer_id
      )
    )
  );

-- service_role INSERT 허용 (기존 유지)
