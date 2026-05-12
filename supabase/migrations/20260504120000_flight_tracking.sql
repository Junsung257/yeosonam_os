-- Phase 3-F: 항공기 지연 트래킹 테이블
CREATE TABLE IF NOT EXISTS flight_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id),
  flight_number TEXT NOT NULL,  -- 예: 'VN215'
  route TEXT NOT NULL,           -- '인천 → 다낭'
  scheduled_departure TIMESTAMPTZ NOT NULL,
  actual_departure TIMESTAMPTZ DEFAULT NULL,
  delay_minutes INTEGER DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',  -- 'scheduled'|'delayed'|'cancelled'|'departed'
  notified_customer BOOLEAN NOT NULL DEFAULT false,
  notified_operator BOOLEAN NOT NULL DEFAULT false,
  note TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flight_alerts_booking_id ON flight_alerts(booking_id);
CREATE INDEX IF NOT EXISTS idx_flight_alerts_scheduled ON flight_alerts(scheduled_departure);
CREATE INDEX IF NOT EXISTS idx_flight_alerts_status ON flight_alerts(status, scheduled_departure);
