-- post_trip_reviews 에 source_type 컬럼 추가
-- 확장 전략: 현재는 admin_seeded(카카오 피드백 수동입력)만 사용
--   verified_booking  — 예약 완료 고객이 직접 작성 (고객 계정 생성 후 활성화)
--   platform_import   — 외부 플랫폼(네이버/카카오맵) 임포트 (미래)
--   admin_seeded      — 어드민이 카카오/이메일 피드백에서 수동 입력

ALTER TABLE post_trip_reviews
  ADD COLUMN IF NOT EXISTS source_type TEXT
    NOT NULL DEFAULT 'admin_seeded'
    CHECK (source_type IN ('admin_seeded', 'verified_booking', 'platform_import'));

-- booking_id 는 admin_seeded 일 때 NULL 허용
ALTER TABLE post_trip_reviews
  ALTER COLUMN booking_id DROP NOT NULL;

-- customer_id 도 admin_seeded 일 때 NULL 허용
ALTER TABLE post_trip_reviews
  ALTER COLUMN customer_id DROP NOT NULL;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_review_source_type
  ON post_trip_reviews(source_type);

-- travel_packages 의 avg_rating / review_count 집계 뷰를
-- source_type 무관하게 approved 전체 기준으로 유지 (변경 없음)
-- 단, verified_booking 리뷰는 가중치 1.2배 적용 예정 (미래 컬럼: weight NUMERIC DEFAULT 1.0)
