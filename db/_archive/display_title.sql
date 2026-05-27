-- 고객용 제목 컬럼 추가
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS display_title TEXT;
COMMENT ON COLUMN travel_packages.display_title IS '고객 노출용 제목 (등록 시 자동 생성). 렌더링 우선순위: display_title > products.display_name > title';
