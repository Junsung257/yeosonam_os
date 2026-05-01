-- MRT 관광지·호텔 데이터 연동을 위한 attractions 테이블 확장
-- mrt_gid: MRT 상품 고유 ID (upsert 기준 키)
-- mrt_rating: MRT 리뷰 평점 (A4·모바일 랜딩에 자동 표시)
-- mrt_review_count: MRT 리뷰 수
-- mrt_min_price: MRT 최저가 (KRW)
-- mrt_category: MRT 카테고리 (stay / tna / flight)
-- mrt_synced_at: 마지막 MRT 동기화 시각

ALTER TABLE attractions
  ADD COLUMN IF NOT EXISTS mrt_gid          TEXT,
  ADD COLUMN IF NOT EXISTS mrt_rating       NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS mrt_review_count INTEGER,
  ADD COLUMN IF NOT EXISTS mrt_min_price    INTEGER,
  ADD COLUMN IF NOT EXISTS mrt_category     TEXT CHECK (mrt_category IN ('stay', 'tna', 'flight')),
  ADD COLUMN IF NOT EXISTS mrt_synced_at    TIMESTAMPTZ;

-- 중복 방지 인덱스 (upsert 기준)
CREATE UNIQUE INDEX IF NOT EXISTS idx_attractions_mrt_gid
  ON attractions (mrt_gid)
  WHERE mrt_gid IS NOT NULL;

-- 조회 성능용 인덱스
CREATE INDEX IF NOT EXISTS idx_attractions_mrt_rating
  ON attractions (mrt_rating DESC)
  WHERE mrt_rating IS NOT NULL;
