-- ═══════════════════════════════════════════════════════════════════
-- Phase 11 — P11-3 거절 사유 패턴 + P11-5 한국 공휴일 마스터
-- 박제일: 2026-05-13
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS kr_holidays (
  holiday_date  date PRIMARY KEY,
  name          text NOT NULL,
  is_substitute boolean DEFAULT false,
  category      text DEFAULT 'national' CHECK (category IN ('national','folk','memorial')),
  notes         text,
  created_at    timestamptz DEFAULT now()
);

INSERT INTO kr_holidays (holiday_date, name, category) VALUES
  ('2026-01-01', '신정',          'national'),
  ('2026-02-16', '설날 연휴',     'folk'),
  ('2026-02-17', '설날',          'folk'),
  ('2026-02-18', '설날 연휴',     'folk'),
  ('2026-03-01', '삼일절',        'national'),
  ('2026-05-05', '어린이날',      'national'),
  ('2026-05-25', '석가탄신일',    'folk'),
  ('2026-06-06', '현충일',        'memorial'),
  ('2026-08-15', '광복절',        'national'),
  ('2026-09-24', '추석 연휴',     'folk'),
  ('2026-09-25', '추석',          'folk'),
  ('2026-09-26', '추석 연휴',     'folk'),
  ('2026-10-03', '개천절',        'national'),
  ('2026-10-09', '한글날',        'national'),
  ('2026-12-25', '크리스마스',    'national'),
  ('2027-01-01', '신정',          'national'),
  ('2027-02-06', '설날 연휴',     'folk'),
  ('2027-02-07', '설날',          'folk'),
  ('2027-02-08', '설날 연휴',     'folk')
ON CONFLICT (holiday_date) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_kr_holidays_date ON kr_holidays(holiday_date);

CREATE TABLE IF NOT EXISTS rejection_pattern_master (
  id            bigserial PRIMARY KEY,
  pattern_id    text UNIQUE NOT NULL,
  regex         text NOT NULL,
  category      text NOT NULL,
  severity      text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  description   text,
  created_at    timestamptz DEFAULT now()
);

INSERT INTO rejection_pattern_master (pattern_id, regex, category, severity, description) VALUES
  ('duplicate_accommodation',    '숙박\s*중복|호텔\s*중복',                'MISSING_HOTEL',     'high',     '같은 호텔 중복 등록'),
  ('price_error',                '가격\s*(오기재|오류|틀림)|amount.*wrong',   'PRICE_MISMATCH',    'high',     '가격 오류'),
  ('missing_itinerary',          '일정\s*누락|itinerary.*missing|일정\s*비어', 'PARSE_FAILURE',     'high',     '일정 누락'),
  ('wrong_year',                 '연도\s*(오류|잘못|틀림)|year.*wrong',       'DATE_ERROR',        'critical', '연도 오추론'),
  ('airline_mismatch',           '항공\s*(불일치|틀림|잘못)',                  'AIRLINE_MISMATCH',  'critical', '항공 코드 불일치'),
  ('leak_commission',            '커미션|투어비.*\d+%|마진',                    'LEAK_PATTERN',      'critical', '커미션 노출'),
  ('region_mismatch',            '지역.*(불일치|틀림|잘못)',                    'REGION_MISALIGNMENT','medium',  '지역 라벨 불일치'),
  ('hotel_grade_wrong',          '(호텔\s*)?등급.*(틀림|오류|잘못)',            'MISSING_HOTEL',     'medium',   '호텔 등급 오류')
ON CONFLICT (pattern_id) DO NOTHING;
