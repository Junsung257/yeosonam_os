-- 여행상품 테이블 v2 확장 마이그레이션
-- Supabase SQL Editor에서 실행하세요.

-- 1. 카테고리: package | golf | honeymoon | cruise | theme
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'package';

-- 2. 상품 타입 (패키지: 실속/품격/노팁노옵션, 골프: 골프전용 등)
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS product_type TEXT;

-- 3. 박/일 스타일 (3박5일, 4박6일 등)
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS trip_style TEXT;

-- 4. 정기 출발요일 (매주 화요일, 매주 금요일, 토요일 등)
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS departure_days TEXT;

-- 5. 출발 공항
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS departure_airport TEXT DEFAULT '부산(김해)';

-- 6. 항공편명
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS airline TEXT;

-- 7. 최소 출발 인원
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS min_participants INT DEFAULT 4;

-- 8. 발권 마감일
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS ticketing_deadline DATE;

-- 9. 기사/가이드 경비 (원문 그대로 저장: "$50/인")
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS guide_tip TEXT;

-- 10. 싱글 차지 (원문: "$60/인/박")
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS single_supplement TEXT;

-- 11. 소규모 할증 (원문: "4~7명 $20/인 인상")
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS small_group_surcharge TEXT;

-- 12. 날짜별/기간별 가격 배열 (핵심!)
-- 형식 예시:
-- [
--   {"period_label":"4월 8, 22일", "departure_dates":["2026-04-08","2026-04-22"], "adult_price":679000, "child_price":679000, "status":"available"},
--   {"period_label":"4/28~5/15 화", "date_range":{"start":"2026-04-28","end":"2026-05-15"}, "departure_day_of_week":"화", "adult_price":649000, "child_price":649000, "status":"available", "note":""}
-- ]
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS price_tiers JSONB DEFAULT '[]';

-- 13. 써차지 (나담, 추석 등 특정 기간 추가 요금)
-- [{"period":"7/9~7/15", "amount_usd":30, "note":"나담 축제기간"}]
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS surcharges JSONB DEFAULT '[]';

-- 14. 항공 미운항 날짜 (excluded dates)
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS excluded_dates TEXT[] DEFAULT '{}';

-- 15. 선택 관광 목록
-- [{"name":"발마사지", "price_usd":30}, {"name":"화산 북봉케이블카", "price_usd":120}]
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS optional_tours JSONB DEFAULT '[]';

-- 16. 취소 환불 규정
-- [{"period":"출발일 14일~7일전", "rate":30, "note":"30% 공제 후 환불"}]
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS cancellation_policy JSONB;

-- 17. 카테고리별 고유 속성 (골프/크루즈/허니문 등)
-- 골프: {"golf_courses":["나인브릿지","핀크스GC"], "rounds":3, "caddy_fee":"$30/라운드", "green_fee_included":true}
-- 크루즈: {"ship_name":"코스타 세레나", "cabin_types":[{"type":"내실","adult_price":890000},{"type":"발코니","adult_price":1390000}], "ports":["부산","후쿠오카"]}
-- 허니문: {"hotel_grade":"5성", "honeymoon_benefits":["스파 1회","룸업그레이드"], "wedding_cert_required":true}
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS category_attrs JSONB DEFAULT '{}';

-- 18. 랜드사명 (현지 여행사)
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS land_operator TEXT;

-- 19. 상품 특성 태그 (AI 파싱 시 자동 생성)
-- ['에어텔', '가족전용', '소규모', '노팁', '노옵션', '럭셔리', '프리미엄', '실속']
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS product_tags TEXT[] DEFAULT '{}';

-- 20. 핵심 특전 (Jarvis 추천 설명용)
-- ['어린이 무료 혜택', '5성급 호텔', '가이드팁 포함']
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS product_highlights TEXT[] DEFAULT '{}';

-- 21. AI 자동 생성 요약 (Jarvis 추론용 - raw_text 전체 읽지 않아도 됨, 토큰 절약)
-- 예: "소규모 노팁노옵션 몽골 3박5일. 매주 화요일 부산출발. 4~7명 소규모 할증 $20~40/인. 발권마감 3/30."
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS product_summary TEXT;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_packages_category ON travel_packages(category);
CREATE INDEX IF NOT EXISTS idx_packages_product_type ON travel_packages(product_type);
CREATE INDEX IF NOT EXISTS idx_packages_departure_days ON travel_packages(departure_days);
CREATE INDEX IF NOT EXISTS idx_packages_land_operator ON travel_packages(land_operator);
CREATE INDEX IF NOT EXISTS idx_packages_tags ON travel_packages USING gin(product_tags);

-- 22. 커미션율 (랜드사로부터 받는 수수료 %)
-- 예: 10.0 = 10%, 8.5 = 8.5% — 예약 정산 자동화 연동용 핵심 컬럼
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2);
-- 사용 예: SELECT total_price * commission_rate / 100 as commission_amount FROM bookings JOIN travel_packages ...
CREATE INDEX IF NOT EXISTS idx_packages_commission ON travel_packages(commission_rate);

-- bookings 테이블: 레퍼럴 추적
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS referral_code TEXT;
  -- 용도: 인플루언서 수수료(BLOGGER_KIM), 직원 KPI(STAFF_LEE), 채널 ROI(NAVER_AD)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS channel_source TEXT DEFAULT 'direct';
  -- 'kakao' | 'blog' | 'phone' | 'direct' | 'instagram'
CREATE INDEX IF NOT EXISTS idx_bookings_referral ON bookings(referral_code);
