-- PIN 브루트포스 방어용 시도 횟수 추적 테이블
CREATE TABLE IF NOT EXISTS pin_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,       -- "{referral_code}_{ip}" 형태
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

-- 조회 성능용 인덱스
CREATE INDEX IF NOT EXISTS idx_pin_attempts_lookup
ON pin_attempts(identifier, attempted_at DESC);

-- 1시간 지난 데이터 자동 정리 (Supabase pg_cron 또는 수동)
-- SELECT cron.schedule('cleanup-pin-attempts', '0 * * * *', $$DELETE FROM pin_attempts WHERE attempted_at < NOW() - INTERVAL '1 hour'$$);
