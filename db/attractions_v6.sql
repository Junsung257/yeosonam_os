-- ============================================================
-- attractions v6: badge_type 확장 (onsen/activity 추가) + price_info 컬럼
-- 목적: 모두투어 상품에서 추출한 온천/체험 데이터 분류 + 참고용 가격 저장
-- ============================================================

-- 1. badge_type CHECK 제약 조건 확장 (onsen, activity 추가)
ALTER TABLE attractions DROP CONSTRAINT IF EXISTS attractions_badge_type_check;
ALTER TABLE attractions ADD CONSTRAINT attractions_badge_type_check
  CHECK (badge_type IN (
    'tour',        -- 관광지
    'special',     -- 특전 (야경투어, 해적선탑승 등)
    'shopping',    -- 쇼핑 (아울렛, 면세점 등)
    'meal',        -- 특식 (굴라쉬, 슈니첼, 스키야키 등)
    'golf',        -- 골프
    'optional',    -- 선택관광 (에펠탑전망대, 곤돌라 등)
    'hotel',       -- 호텔 (세키아리조트, 힐튼슈리 등)
    'restaurant',  -- 식당 (크리스탈월드 다니엘스 등)
    'onsen',       -- 온천 (도고온천, 로이커바트, 시기라 황금온천 등)
    'activity'     -- 체험/액티비티 (해적선, 유람선, 알펜루트, 글라스보트, 뱃놀이 등)
  ));

-- 2. price_info: 참고용 대표 가격 (상품별 실제 가격은 travel_packages.optional_tours에서 관리)
-- 구조: { "currency": "EUR", "price": 60, "note": "10명 이상 진행" }
ALTER TABLE attractions ADD COLUMN IF NOT EXISTS price_info JSONB DEFAULT NULL;

-- 3. long_desc 컬럼 확인 (v4에서 추가됨, 없으면 추가)
ALTER TABLE attractions ADD COLUMN IF NOT EXISTS long_desc TEXT DEFAULT NULL;
