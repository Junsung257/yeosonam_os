CREATE TABLE IF NOT EXISTS travel_reels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id),
  customer_id UUID REFERENCES customers(id),
  photos JSONB NOT NULL DEFAULT '[]',  -- [{url, caption}]
  destination TEXT,
  template_id TEXT NOT NULL DEFAULT 'default',
  share_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE travel_reels IS '귀국 후 여행 사진 기반 릴스 템플릿 생성 기록';
CREATE INDEX IF NOT EXISTS idx_travel_reels_booking ON travel_reels(booking_id);
CREATE INDEX IF NOT EXISTS idx_travel_reels_customer ON travel_reels(customer_id);
CREATE INDEX IF NOT EXISTS idx_travel_reels_token ON travel_reels(share_token);
