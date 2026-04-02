-- ============================================================
-- 여소남 OS: 대화/인텐트/행동추적/인플루언서 테이블 추가
-- 마이그레이션: 20260331000000
-- ============================================================

BEGIN;

-- ============================================================
-- 1. conversations 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  channel TEXT DEFAULT 'web',
  source TEXT,
  messages JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);

-- ============================================================
-- 2. intents 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id),
  destination TEXT,
  travel_dates DATERANGE,
  party_size INTEGER,
  budget_range INT4RANGE,
  priorities TEXT[],
  booking_stage TEXT,
  extracted_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intents_conversation ON intents(conversation_id);
CREATE INDEX IF NOT EXISTS idx_intents_destination ON intents(destination);

-- ============================================================
-- 3. user_actions 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS user_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID,
  customer_id UUID REFERENCES customers(id),
  action_type TEXT NOT NULL,
  target_id TEXT,
  context JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_actions_session ON user_actions(session_id);
CREATE INDEX IF NOT EXISTS idx_actions_customer ON user_actions(customer_id);
CREATE INDEX IF NOT EXISTS idx_actions_type ON user_actions(action_type);

-- ============================================================
-- 4. influencers 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS influencers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  commission_rate DECIMAL DEFAULT 0.09,
  contact_info JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_influencers_code ON influencers(code);

-- ============================================================
-- 5. customers 테이블 수정
-- ============================================================
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS source TEXT,
ADD COLUMN IF NOT EXISTS referrer_id UUID REFERENCES influencers(id),
ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMP DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_customers_source ON customers(source);
CREATE INDEX IF NOT EXISTS idx_customers_referrer ON customers(referrer_id);

-- ============================================================
-- 6. products 테이블 수정
-- ============================================================
ALTER TABLE products
ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS inquiry_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
ADD COLUMN IF NOT EXISTS expired_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
-- destination 컬럼은 이미 idx_products_destination_code 인덱스 존재 (products_v1.sql)
-- destination 컬럼이 DB에 없을 수 있으므로 별도 인덱스 생략

-- ============================================================
-- 7. bookings 테이블 수정
-- ============================================================
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id),
ADD COLUMN IF NOT EXISTS lead_time INTEGER;

CREATE INDEX IF NOT EXISTS idx_bookings_conversation ON bookings(conversation_id);

COMMIT;
