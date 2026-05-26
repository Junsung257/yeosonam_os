-- Private Tour: 견적 공유 + 여행 Passport
-- 2026-05-26

-- 1. group_rfqs에 share_token 컬럼 추가
ALTER TABLE group_rfqs
  ADD COLUMN IF NOT EXISTS share_token UUID UNIQUE DEFAULT gen_random_uuid();

-- 2. rfq_share_reactions: 일행 반응 (좋아요/궁금해요/투표)
CREATE TABLE IF NOT EXISTS rfq_share_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES group_rfqs(id) ON DELETE CASCADE,
  visitor_token TEXT NOT NULL,  -- 익명 방문자 식별 (쿠키 기반)
  reaction_type TEXT NOT NULL CHECK (reaction_type IN ('like', 'curious', 'vote_a', 'vote_b', 'vote_c')),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rfq_id, visitor_token, reaction_type)
);

CREATE INDEX IF NOT EXISTS idx_rfq_share_reactions_rfq ON rfq_share_reactions(rfq_id);

-- 3. user_travel_histories: 여행 Passport 스탬프
CREATE TABLE IF NOT EXISTS user_travel_histories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  rfq_id UUID REFERENCES group_rfqs(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  destination TEXT NOT NULL,
  destination_country TEXT,
  departure_date DATE,
  duration_nights INTEGER,
  trip_type TEXT,  -- '가족여행','친구·모임','회사 단체','혼자 여행' 등
  tenant_name TEXT,  -- 선정된 랜드사명
  proposal_title TEXT, -- 선정된 제안 제목
  total_price INTEGER, -- 최종 결제 금액
  total_pax INTEGER,   -- 총 인원
  stamp_image_url TEXT, -- Passport 스탬프 이미지
  review_submitted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_travel_histories_customer ON user_travel_histories(customer_id, created_at DESC);

-- 4. RLS: rfq_share_reactions는 누구나 읽기 가능, 인증된 사용자만 INSERT
ALTER TABLE rfq_share_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_travel_histories ENABLE ROW LEVEL SECURITY;

-- rfq_share_reactions: 누구나 조회 가능 (공유 페이지이므로)
CREATE POLICY "Anyone can read reactions" ON rfq_share_reactions
  FOR SELECT USING (true);

-- 인증된 사용자만 반응 추가 (보안상)
CREATE POLICY "Authenticated users can insert reactions" ON rfq_share_reactions
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- user_travel_histories: 본인만 조회
CREATE POLICY "Users can view own travel history" ON user_travel_histories
  FOR SELECT USING (
    customer_id IN (
      SELECT id FROM customers WHERE phone IN (
        SELECT phone FROM customers WHERE id = customer_id
      )
    )
  );

CREATE POLICY "Service role can insert travel history" ON user_travel_histories
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
