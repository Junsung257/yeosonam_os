-- active_destinations 뷰: 미래 출발일이 있는 패키지만 카운트하도록 alive 필터 추가.
--
-- WHY:
--   기존 뷰는 status IN ('approved','active') 만 본다.
--   → 출발일이 모두 지난 패키지도 package_count 에 포함됨.
--   → 홈 "인기 여행지·추천 TOP 4" 카드에는 "장가계 6개" 가 보이지만,
--     /destinations/[city] (alive 필터 적용) 클릭 시 "상품 없음" 으로 보이는 부정합 발생.
--
-- WHAT:
--   price_dates 가 비어있거나 (legacy 상품) 미래 날짜가 1개라도 있으면 alive.
--   alive 패키지가 0개인 destination 은 뷰에서 자동 제외 (HAVING).
--
-- IMPACT (모두 의도된 정합화):
--   - src/app/sitemap.ts                       — alive 0 destination 자동 제외
--   - src/app/destinations/page.tsx            — 허브 목록
--   - src/app/destinations/[city]/page.tsx     — 상세 (이미 페이지 레벨에서 alive 필터링 중. 이중 가드)
--   - src/app/destinations/region/[region]/page.tsx
--   - src/app/page.tsx                         — 홈 추천 TOP 4 (이미 destMap 보정 중. 이중 가드)
--   - src/app/blog/page.tsx
--   - src/lib/blog-pillar-generator.ts
--
-- NOTE:
--   - avg_rating, total_reviews 는 alive 와 무관하게 전체 (status alive) 패키지 기준 유지.
--     리뷰는 과거 출발 패키지에서도 수집되므로 alive 로 자르면 평점이 갑자기 떨어진다.
--   - min_price 는 alive 패키지의 price 컬럼 최소.
--     (price_dates 미래 가격까지 정확히 반영하려면 페이지 레벨 보정이 필요 — page.tsx 의 destMap 이 그 역할.)

CREATE OR REPLACE VIEW active_destinations AS
WITH alive_flag AS (
  SELECT
    destination,
    price,
    avg_rating,
    review_count,
    (
      price_dates IS NULL
      OR jsonb_array_length(COALESCE(price_dates::jsonb, '[]'::jsonb)) = 0
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(price_dates::jsonb) AS pd
        WHERE (pd->>'date') >= to_char(CURRENT_DATE, 'YYYY-MM-DD')
      )
    ) AS is_alive
  FROM travel_packages
  WHERE destination IS NOT NULL
    AND status::text = ANY (ARRAY['approved'::varchar, 'active'::varchar]::text[])
)
SELECT
  destination,
  COUNT(*) FILTER (WHERE is_alive) AS package_count,
  AVG(avg_rating) FILTER (WHERE avg_rating IS NOT NULL) AS avg_rating,
  SUM(review_count) AS total_reviews,
  MIN(price) FILTER (WHERE is_alive) AS min_price
FROM alive_flag
GROUP BY destination
HAVING COUNT(*) FILTER (WHERE is_alive) > 0;
