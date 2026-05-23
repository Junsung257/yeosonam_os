-- Customer segments (RFM-based)
-- 생성: 2026-05-24
-- RFM(Recency·Frequency·Monetary) 기준 고객 세그먼트 테이블 + 일별 갱신 스코어

-- ── 1. 세그먼트 정의 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_segments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  segment_name TEXT NOT NULL, -- 'champions' | 'loyal' | 'potential_loyalists' | 'new_customers' | 'at_risk' | 'hibernating' | 'lost'
  rfm_score TEXT NOT NULL, -- e.g., '4-5-4' (R-F-M)
  r_min INTEGER NOT NULL, -- Recency range min (days)
  r_max INTEGER NOT NULL, -- Recency range max (days)
  f_min INTEGER NOT NULL, -- Frequency range min
  f_max INTEGER NOT NULL, -- Frequency range max
  m_min NUMERIC(12,2) NOT NULL, -- Monetary range min
  m_max NUMERIC(12,2) NOT NULL, -- Monetary range max
  description TEXT,
  recommended_action TEXT, -- e.g., '리워드 제공', '재활성화 이메일', '재방문 쿠폰'
  color TEXT, -- for UI display
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── 2. 고객별 RFM 점수 (일별 갱신) ──────────────────────────
CREATE TABLE IF NOT EXISTS customer_rfm (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id TEXT NOT NULL, -- can be visitor_id, email, or user_id
  customer_email TEXT,
  recency_days INTEGER, -- days since last booking
  frequency INTEGER, -- total bookings
  monetary_total NUMERIC(12,2), -- total spent
  r_score INTEGER CHECK (r_score BETWEEN 1 AND 5),
  f_score INTEGER CHECK (f_score BETWEEN 1 AND 5),
  m_score INTEGER CHECK (m_score BETWEEN 1 AND 5),
  rfm_combined TEXT, -- e.g., '4-5-3'
  segment_id UUID REFERENCES customer_segments(id),
  last_booking_at TIMESTAMPTZ,
  first_booking_at TIMESTAMPTZ,
  preferred_destination TEXT,
  preferred_product_type TEXT,
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(customer_id)
);

-- ── 3. 시드 데이터 — 7개 표준 세그먼트 ──────────────────────
INSERT INTO customer_segments (segment_name, rfm_score, r_min, r_max, f_min, f_max, m_min, m_max, description, recommended_action, color) VALUES
('champions', '4-5-5', 0, 30, 4, 999, 1000000, 999999999, '최고 가치 고객 — 최근 구매+고빈도+고액', 'VIP 혜택, 얼리버드, 리워드', '#gold'),
('loyal', '4-5-4', 0, 60, 3, 999, 500000, 999999999, '충성 고객 — 자주 구매', '멤버십 혜택, 추천 인센티브', '#green'),
('potential_loyalists', '3-2-3', 31, 90, 2, 3, 200000, 1000000, '최근 구매했으나 아직 자주 오지 않음', '재구매 쿠폰, 개인화 추천', '#blue'),
('new_customers', '5-1-1', 0, 30, 1, 1, 0, 999999999, '신규 고객', '웰컴 시리즈, 두 번째 구독 유도', '#purple'),
('at_risk', '1-3-3', 91, 180, 2, 4, 300000, 999999999, '이탈 위험 — 한때 좋았으나 최근 없음', '재활성화 이메일, 할인 쿠폰', '#orange'),
('hibernating', '1-2-2', 181, 365, 1, 2, 100000, 500000, '휴면 고객', '놓친 상품 알림, 빅세일 초대', '#red'),
('lost', '1-1-1', 366, 9999, 0, 1, 0, 999999999, '이탈 고객', '재유입 캠페인 (대규모 할인)', '#gray');

-- ── 4. 인덱스 ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_customer_rfm_segment ON customer_rfm(segment_id);
CREATE INDEX IF NOT EXISTS idx_customer_rfm_customer ON customer_rfm(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_rfm_computed ON customer_rfm(computed_at);
CREATE INDEX IF NOT EXISTS idx_customer_rfm_combined ON customer_rfm(rfm_combined);
CREATE INDEX IF NOT EXISTS idx_customer_segments_name ON customer_segments(segment_name);
