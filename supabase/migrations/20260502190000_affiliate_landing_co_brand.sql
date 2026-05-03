-- 코브랜딩 랜딩 /with/[referral_code] 용 어필리에이터 커스텀 필드
-- (없으면 랜딩은 이름·로고·기본 추천 상품만 표시)

ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS landing_intro TEXT;

ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS landing_pick_package_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN affiliates.landing_intro IS
  '코브랜딩 랜딩 상단 인사·소개 (고객 노출, 줄바꿈 허용 — HTML 비권장)';
COMMENT ON COLUMN affiliates.landing_pick_package_ids IS
  '랜딩 "Pick" 영역에 노출할 travel_packages.id 목록 (비어 있으면 최신 상품 자동)';
