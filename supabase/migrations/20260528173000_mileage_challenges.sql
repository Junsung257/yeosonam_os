-- 마일리지 챌린지 테이블 (Phase 3-4)
CREATE TABLE IF NOT EXISTS mileage_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  condition_type TEXT NOT NULL,    -- booking_count, new_destination, review_photo, referral
  condition_value INTEGER NOT NULL DEFAULT 1,
  reward_mileage INTEGER NOT NULL DEFAULT 1000,
  reward_badge_type TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mileage_challenges_active ON mileage_challenges(starts_at, ends_at);

-- 기본 시즌 챌린지 데이터
INSERT INTO mileage_challenges (title, description, condition_type, condition_value, reward_mileage, reward_badge_type, starts_at, ends_at) VALUES
  ('여름 휴가 챌린지', '6~8월 여행 상품 예약 시 추가 3000P 적립', 'booking_count', 1, 3000, 'summer_champion', '2026-06-01T00:00:00+09:00', '2026-08-31T23:59:59+09:00'),
  ('신규 여행지 도전', '처음 가는 국가/도시 예약 시 보너스 2000P', 'new_destination', 1, 2000, 'explorer', '2026-01-01T00:00:00+09:00', '2026-12-31T23:59:59+09:00'),
  ('리뷰 챌린지', '사진 리뷰 작성 시 추가 1000P', 'review_photo', 1, 1000, 'review_writer', '2026-01-01T00:00:00+09:00', '2026-12-31T23:59:59+09:00'),
  ('친구 초대 챌린지', '친구 초대 가입 시 5000P', 'referral', 1, 5000, 'ambassador', '2026-01-01T00:00:00+09:00', '2026-12-31T23:59:59+09:00')
ON CONFLICT DO NOTHING;

-- 참여 로그
CREATE TABLE IF NOT EXISTS challenge_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID REFERENCES mileage_challenges(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  progress INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  reward_claimed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(challenge_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_challenge_participants_customer ON challenge_participants(customer_id);

ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "challenge_participants_select_own"
  ON challenge_participants FOR SELECT
  USING (customer_id = auth.uid());

CREATE POLICY "challenge_participants_select_admin"
  ON challenge_participants FOR SELECT
  USING (EXISTS (SELECT 1 FROM admins WHERE id = auth.uid()));

-- 활성 챌린지 조회 (customer_id 기준 참여 정보 포함)
CREATE OR REPLACE VIEW active_customer_challenges AS
SELECT
  mc.id,
  mc.title,
  mc.description,
  mc.condition_type,
  mc.condition_value,
  mc.reward_mileage,
  mc.reward_badge_type,
  mc.starts_at,
  mc.ends_at,
  cp.progress,
  cp.completed_at,
  cp.reward_claimed
FROM mileage_challenges mc
LEFT JOIN challenge_participants cp ON cp.challenge_id = mc.id
WHERE mc.starts_at <= NOW()
  AND mc.ends_at >= NOW();
