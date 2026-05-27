-- ============================================================
-- 블록 마스터 시스템 v1
-- 지역별 관광 블록 + 상품 조립 + 점수 측정
-- ============================================================

-- 1. 지역 마스터 (destination_masters)
-- 장가계, 나트랑, 보홀 등 여행 지역 단위
CREATE TABLE IF NOT EXISTS destination_masters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 기본 정보
  name TEXT NOT NULL UNIQUE,              -- '장가계', '나트랑/달랏', '나트랑/판랑'
  country TEXT NOT NULL,                  -- '중국', '베트남', '일본'
  region_code VARCHAR(10),                -- 'ZJJ', 'NHA', 'BHO'

  -- 항공 기본값
  default_airline TEXT,                   -- 'BX'
  default_flight_out TEXT,                -- 'BX371'
  default_flight_in TEXT,                 -- 'BX372'
  default_departure_airport TEXT DEFAULT '김해공항',
  flight_out_time TEXT,                   -- '09:00'
  flight_in_time TEXT,                    -- '16:35'
  arrival_time TEXT,                      -- '11:20' (현지도착)
  return_departure_time TEXT,             -- '12:20' (현지출발)

  -- 호텔 풀 (등급별)
  hotel_pool JSONB DEFAULT '[]',
  -- [{"grade":"준5성","names":["블루베이","베스트웨스턴"],"score":2},
  --  {"grade":"정5성","names":["선샤인","피닉스","청하금강"],"score":3},
  --  {"grade":"특5성","names":["풀만","하얏트","힐튼","렌조이"],"score":4}]

  -- 식사 풀 (자주 등장하는 메뉴)
  meal_pool JSONB DEFAULT '[]',
  -- [{"slot":"day1_lunch","default":"누룽지백숙"},
  --  {"slot":"day2_lunch","default":"산채비빔밥"}, ...]

  -- 공통 주의사항 (지역별)
  common_notices JSONB DEFAULT '[]',

  -- 공통 키워드 (텍스트 매칭용)
  keywords TEXT[] DEFAULT '{}',           -- ['장가계','천문산','원가계','백룡']

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 관광 블록 (tour_blocks)
-- 반나절~1일 단위의 관광 묶음
CREATE TABLE IF NOT EXISTS tour_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id UUID NOT NULL REFERENCES destination_masters(id),

  -- 블록 식별
  block_code VARCHAR(20) NOT NULL UNIQUE,  -- 'ZJJ-B001', 'NHA-B201'
  name TEXT NOT NULL,                      -- '천문산 등정'

  -- 블록 유형
  block_type TEXT NOT NULL DEFAULT 'sightseeing'
    CHECK (block_type IN ('sightseeing','golf','transfer','shopping','show','massage','night','hotel_activity')),
  duration TEXT NOT NULL DEFAULT 'half'
    CHECK (duration IN ('half','full','night','morning','transfer')),

  -- 연결된 관광지 (attractions 테이블 FK)
  attraction_ids UUID[] DEFAULT '{}',      -- attractions.id 배열 (1블록에 관광지 여러개 가능)
  -- 이 블록에 포함된 관광지들 → 사진, 설명, 카테고리 자동 연결

  -- 일정 내용 (schedule 배열)
  schedule JSONB NOT NULL DEFAULT '[]',
  -- [{"time":null,"activity":"▶천문산 등정","type":"normal","attraction_id":"uuid-optional"},
  --  {"time":null,"activity":"999개의 계단 천문동","type":"normal"}]

  -- 식사 기본값 (이 블록이 포함될 때 기본 식사)
  default_meals JSONB DEFAULT '{}',
  -- {"lunch":"누룽지백숙","dinner":"호텔식"}

  -- 텍스트 매칭 키워드
  keywords TEXT[] DEFAULT '{}',           -- ['천문산','천문동','귀곡잔도','유리잔도']

  -- 점수 (블록이 포함되면 품질 점수에 반영)
  quality_score NUMERIC(3,1) DEFAULT 1.0, -- 관광지 1개=1점, 프리미엄=2.5점 등 소수점 허용

  -- 메타
  typical_day_position TEXT,              -- 'day1', 'day2', 'any', 'last'
  is_optional BOOLEAN DEFAULT false,      -- 옵션으로 판매될 수 있는 블록
  option_price_usd NUMERIC(8,2),          -- 옵션일 때 가격 ($)

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tour_blocks_dest ON tour_blocks(destination_id, block_type);
CREATE INDEX IF NOT EXISTS idx_tour_blocks_keywords ON tour_blocks USING GIN(keywords);

-- 3. 코스 템플릿 (course_templates)
-- "장가계 관광 3박4일" "나트랑 달랏 코스" 같은 코스 타입별 블록 조합 순서
CREATE TABLE IF NOT EXISTS course_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id UUID NOT NULL REFERENCES destination_masters(id),

  -- 코스 식별
  template_code VARCHAR(30) NOT NULL UNIQUE, -- 'ZJJ-PKG-3N', 'NHA-DALAT-3N', 'ZJJ-GOLF-3N'
  name TEXT NOT NULL,                        -- '장가계 관광 3박4일', '나트랑/달랏 관광 3박5일'
  course_type TEXT NOT NULL DEFAULT 'package'
    CHECK (course_type IN ('package','golf','resort','honeymoon','cruise')),

  nights SMALLINT NOT NULL,                  -- 3, 4
  days SMALLINT NOT NULL,                    -- 4, 5

  -- 블록 배치 (일자별 블록 코드 배열)
  day_blocks JSONB NOT NULL,
  -- [
  --   {"day":1, "blocks":["ZJJ-B001"], "fixed":true},
  --   {"day":2, "blocks":["ZJJ-B002","ZJJ-B004"], "fixed":false},
  --   {"day":3, "blocks":["ZJJ-B003","ZJJ-B005"], "fixed":false},
  --   {"day":4, "blocks":["ZJJ-B009"], "fixed":true}
  -- ]
  -- fixed=true: 이 날의 블록은 변경 불가 (항공편 연결 등)
  -- fixed=false: 블록 교체/추가 가능한 슬롯

  -- 이 코스의 기본 포함/불포함
  default_inclusions TEXT[] DEFAULT '{}',
  default_excludes TEXT[] DEFAULT '{}',

  -- 기본 분류 태그
  default_tags TEXT[] DEFAULT '{}',          -- ['노팁','노옵션']

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. 상품 점수 기준 (scoring_rules)
-- 점수 항목별 가중치
CREATE TABLE IF NOT EXISTS scoring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  category TEXT NOT NULL,                    -- 'hotel', 'attraction', 'meal', 'service', 'penalty'
  item TEXT NOT NULL,                        -- 'grade_5star', 'no_shopping', 'massage_90min'

  -- 점수
  score NUMERIC(4,1) NOT NULL,               -- 3.0, -1.0 등

  -- 매칭 조건 (텍스트에서 이 키워드가 있으면 이 점수 적용)
  match_keywords TEXT[] DEFAULT '{}',        -- ['정5성','정5성급']
  match_field TEXT,                          -- 'accommodations', 'special_notes', 'product_type'

  description TEXT,
  is_active BOOLEAN DEFAULT true,

  UNIQUE(category, item)
);

-- 5. 상품 점수 캐시 (package_scores)
-- travel_packages에 점수를 캐싱
CREATE TABLE IF NOT EXISTS package_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES travel_packages(id) ON DELETE CASCADE,

  -- 점수 상세
  hotel_score NUMERIC(4,1) DEFAULT 0,
  attraction_score NUMERIC(4,1) DEFAULT 0,
  meal_score NUMERIC(4,1) DEFAULT 0,
  service_score NUMERIC(4,1) DEFAULT 0,     -- 마사지, 선물, 특전 등
  penalty_score NUMERIC(4,1) DEFAULT 0,     -- 쇼핑, 옵션, 팁 등 (음수)

  total_score NUMERIC(5,1) GENERATED ALWAYS AS (
    hotel_score + attraction_score + meal_score + service_score + penalty_score
  ) STORED,

  -- 가성비 (점수 ÷ 최저가 만원)
  -- 별도 계산 필요 (가격이 날짜별로 다르므로)

  scored_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(package_id)
);
CREATE INDEX IF NOT EXISTS idx_package_scores_total ON package_scores(total_score DESC);

-- ============================================================
-- 기본 점수 기준 시딩
-- ============================================================
INSERT INTO scoring_rules (category, item, score, match_keywords, match_field, description) VALUES
  -- 호텔
  ('hotel', 'grade_4star', 1.0, ARRAY['4성','시내호텔'], 'accommodations', '4성급 호텔'),
  ('hotel', 'grade_semi5', 2.0, ARRAY['준5성'], 'accommodations', '준5성 호텔'),
  ('hotel', 'grade_5star', 3.0, ARRAY['정5성','5성급'], 'accommodations', '정5성 호텔'),
  ('hotel', 'grade_special5', 4.0, ARRAY['특5성','확정보장'], 'accommodations', '특5성 확정보장'),
  ('hotel', 'golf_tel', 2.5, ARRAY['골프텔','빌라'], 'accommodations', '골프텔/빌라'),

  -- 관광지 (블록 수 기반으로 자동 계산되지만 프리미엄 관광지 보너스)
  ('attraction', 'grand_canyon', 2.0, ARRAY['대협곡','유리다리'], NULL, '장가계 대협곡 유리다리'),
  ('attraction', 'cable_car', 1.0, ARRAY['케이블카'], NULL, '케이블카 포함'),
  ('attraction', 'luge', 1.0, ARRAY['루지'], NULL, '루지 포함'),
  ('attraction', 'rail_bike', 1.0, ARRAY['레일바이크'], NULL, '레일바이크 포함'),
  ('attraction', 'vip_pass', 1.5, ARRAY['VIP통로','VIP패스'], NULL, 'VIP 우선입장'),
  ('attraction', 'night_tour_inside', 1.5, ARRAY['내부관광','내부입장'], NULL, '야경 내부관광'),
  ('attraction', 'night_tour_window', 0.5, ARRAY['차창'], NULL, '차창관광'),
  ('attraction', 'desert_jeep', 1.5, ARRAY['사막투어','지프차'], NULL, '사막투어 지프차'),
  ('attraction', 'hopping_tour', 2.0, ARRAY['호핑투어','해적호핑'], NULL, '호핑투어'),

  -- 식사
  ('meal', 'special_meal', 0.5, ARRAY['특식'], 'special_notes', '특식 1회당'),
  ('meal', 'unlimited', 0.5, ARRAY['무제한'], NULL, '무제한 식사'),
  ('meal', 'haidilao', 1.0, ARRAY['하이디라오','하이다라오'], NULL, '하이디라오 훠궈'),
  ('meal', 'seafood_buffet', 1.0, ARRAY['씨푸드뷔페','해산물뷔페'], NULL, '씨푸드 뷔페'),

  -- 서비스 (가점)
  ('service', 'massage_50', 1.0, ARRAY['마사지50분','발마사지50'], NULL, '발마사지 50분'),
  ('service', 'massage_60', 1.5, ARRAY['마사지60분','마사지 60분'], NULL, '마사지 60분'),
  ('service', 'massage_90', 2.0, ARRAY['마사지90분','전신마사지90','마사지(90분)'], NULL, '전신마사지 90분'),
  ('service', 'massage_120', 3.0, ARRAY['마사지120분','마사지 120분'], NULL, '전신마사지 120분'),
  ('service', 'gift_set', 1.0, ARRAY['선물3종','선물세트'], NULL, '선물 세트'),
  ('service', 'fruit_basket', 0.5, ARRAY['과일바구니','과일도시락'], NULL, '과일 특전'),
  ('service', 'late_checkout', 1.0, ARRAY['레이트체크아웃'], NULL, '레이트 체크아웃'),
  ('service', 'limousine', 0.5, ARRAY['리무진'], NULL, '리무진 차량'),
  ('service', 'night_city_tour', 1.5, ARRAY['야간시티투어','야시장+씨클로'], NULL, '야간시티투어'),

  -- 감점 (패널티)
  ('penalty', 'shopping_per_visit', -1.0, ARRAY['쇼핑'], 'special_notes', '쇼핑 1회당 -1점'),
  ('penalty', 'has_options', -2.0, ARRAY['추천옵션','선택관광','강력추천옵션'], NULL, '옵션 압박 있음'),
  ('penalty', 'no_option', 0.0, ARRAY['노옵션'], 'product_type', '노옵션 (감점 없음)'),
  ('penalty', 'no_tip', 0.0, ARRAY['노팁'], 'product_type', '노팁 (감점 없음)'),
  ('penalty', 'tip_required', -1.0, ARRAY['팁별도','매너팁'], NULL, '팁 별도'),
  ('penalty', 'no_shopping', 2.0, ARRAY['노쇼핑'], 'product_type', '노쇼핑 보너스'),
  ('penalty', 'meals_excluded', -1.0, ARRAY['중식/석식','불포함'], 'excludes', '식사 미포함 (골프)')
ON CONFLICT (category, item) DO NOTHING;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_destination_masters_name ON destination_masters(name);
CREATE INDEX IF NOT EXISTS idx_course_templates_dest ON course_templates(destination_id, course_type);
CREATE INDEX IF NOT EXISTS idx_scoring_rules_category ON scoring_rules(category, is_active);
