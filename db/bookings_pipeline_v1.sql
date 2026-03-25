-- ============================================================
-- 예약 파이프라인 자동화 + 데이터 구조화 마이그레이션
-- 모두투어 분석 기반: 텍스트 → 구조화된 필드 분리
-- ============================================================

-- ── 1. 가격 4분류 (성인/소아N/소아E/유아) ──────────────────
-- 기존: adult_cost, adult_price, child_cost, child_price, infant_count, infant_cost
-- 추가: 소아N(좌석있음)/소아E(좌석없음) 분리 + infant_price
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS child_n_count INTEGER DEFAULT 0;    -- 소아N (좌석O, 2~11세)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS child_n_cost INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS child_n_price INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS child_e_count INTEGER DEFAULT 0;    -- 소아E (좌석X, 2~11세)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS child_e_cost INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS child_e_price INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS infant_price INTEGER DEFAULT 0;     -- 유아 판매가

-- ── 2. 현지 필수경비 구조화 ────────────────────────────────
-- 기존: notes 텍스트에 섞여있음 → 별도 JSONB 필드
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS local_expenses JSONB DEFAULT '{}'::jsonb;
-- 구조: { "currency": "JPY", "adult": 4000, "child": 4000, "infant": 0, "description": "가이드/기사 경비" }

-- ── 3. 싱글차지 구조화 ────────────────────────────────────
-- 기존: travel_packages.single_supplement 텍스트 ("1인 3박 20만원")
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS single_charge INTEGER DEFAULT 0;     -- 원화 금액
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS single_charge_count INTEGER DEFAULT 0; -- 싱글룸 사용 인원

-- ── 4. 항공편 정보 구조화 ──────────────────────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS flight_out TEXT;         -- 출발편 (예: "LJ311")
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS flight_out_time TEXT;    -- 출발시간 (예: "13:50")
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS flight_in TEXT;          -- 도착편 (예: "LJ312")
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS flight_in_time TEXT;     -- 도착시간 (예: "19:50")

-- ── 5. 좌석 관리 (보유/OK/잔여) ────────────────────────────
-- 상품(travel_packages)별 좌석 관리
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS seats_held INTEGER DEFAULT 0;     -- 랜드사에 요청한 좌석
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS seats_confirmed INTEGER DEFAULT 0; -- 확정 예약
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS seats_ticketed INTEGER DEFAULT 0;  -- 발권 완료

-- ── 6. 수배 확정 체크리스트 (우리 실정에 맞게 축소) ──────────
-- 모두투어: 6개 (마감/출발확정/가격확정/호텔확정/항공확정/일정확정)
-- 우리: 3개 (입금완료는 자동, 나머지는 랜드사 의존)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_ticketed BOOLEAN DEFAULT false;          -- 발권 확인
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_manifest_sent BOOLEAN DEFAULT false;     -- 랜드사 명단 전달
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_guide_notified BOOLEAN DEFAULT false;    -- D-7/D-1 안내 발송됨

-- ── 7. 승객 상세 (booking_passengers 확장) ──────────────────
ALTER TABLE booking_passengers ADD COLUMN IF NOT EXISTS passenger_type TEXT DEFAULT 'adult'
  CHECK (passenger_type IN ('adult', 'child_n', 'child_e', 'infant'));
ALTER TABLE booking_passengers ADD COLUMN IF NOT EXISTS seat_number TEXT;   -- 좌석번호 (선택)
ALTER TABLE booking_passengers ADD COLUMN IF NOT EXISTS ticket_number TEXT; -- 항공권 번호

-- ── 인덱스 ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bookings_is_ticketed ON bookings(is_ticketed);
CREATE INDEX IF NOT EXISTS idx_bookings_is_manifest ON bookings(is_manifest_sent);
CREATE INDEX IF NOT EXISTS idx_tp_seats ON travel_packages(seats_held, seats_confirmed);
