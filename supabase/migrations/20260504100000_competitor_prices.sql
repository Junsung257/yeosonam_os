CREATE TABLE IF NOT EXISTS competitor_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination TEXT NOT NULL,
  duration TEXT NOT NULL,         -- '4박5일'
  competitor TEXT NOT NULL,       -- '하나투어'
  price INTEGER NOT NULL,         -- 원화
  departure_date DATE DEFAULT NULL,
  source_url TEXT DEFAULT NULL,   -- 참고 URL
  recorded_by TEXT DEFAULT NULL,  -- 입력한 어드민
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_competitor_prices_dest ON competitor_prices(destination);
COMMENT ON TABLE competitor_prices IS '경쟁사 가격 수동 입력 기록 — 여소남 가격과 자동 비교용';
