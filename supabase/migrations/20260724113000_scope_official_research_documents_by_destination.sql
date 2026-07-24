-- A reviewed domain is not enough to prove that a document applies to the
-- requested destination. Empty destinations remain global; non-empty arrays
-- are an explicit allowlist enforced by the automatic researcher.

ALTER TABLE public.blog_information_official_research_documents
  ADD COLUMN IF NOT EXISTS destinations text[] NOT NULL DEFAULT '{}';

UPDATE public.blog_information_official_research_documents
SET
  destinations = ARRAY['괌'],
  updated_at = now()
WHERE cardinality(destinations) = 0;

CREATE INDEX IF NOT EXISTS idx_blog_official_research_documents_destinations
  ON public.blog_information_official_research_documents
  USING gin (destinations);

WITH reviewed_wmo_city(destination, city_id) AS (
  VALUES
    ('괌', 1954),
    ('방콕', 233),
    ('도쿄', 183),
    ('오사카', 184),
    ('홍콩', 1),
    ('서울', 231),
    ('파리', 194),
    ('다낭', 656),
    ('나트랑', 3027),
    ('발리', 649),
    ('삿포로', 181),
    ('후쿠오카', 185),
    ('오키나와', 186),
    ('호치민', 309),
    ('하노이', 308),
    ('쿠알라룸푸르', 82),
    ('두바이', 1190),
    ('런던', 32),
    ('바르셀로나', 1232),
    ('시드니', 300),
    ('멜버른', 301),
    ('프라하', 197),
    ('부다페스트', 60),
    ('이스탄불', 47),
    ('나고야', 355),
    ('센다이', 182),
    ('부산', 336),
    ('제주', 337),
    ('베이징', 237),
    ('상하이', 240),
    ('비엔티안', 235),
    ('씨엠립', 347),
    ('양곤', 232),
    ('만달레이', 588),
    ('수라바야', 648),
    ('코타키나발루', 81),
    ('조호르바루', 78),
    ('콜롬보', 227),
    ('아부다비', 222),
    ('카이로', 248),
    ('아테네', 177),
    ('비엔나', 17),
    ('베를린', 59),
    ('뮌헨', 58),
    ('브뤼셀', 191),
    ('취리히', 312),
    ('제네바', 193),
    ('마드리드', 195),
    ('포르토', 3),
    ('더블린', 188),
    ('에든버러', 33),
    ('코펜하겐', 190),
    ('스톡홀름', 187),
    ('오슬로', 21),
    ('바르샤바', 24),
    ('크라쿠프', 27),
    ('니스', 902),
    ('리옹', 1054),
    ('퍼스', 314),
    ('케언스', 299),
    ('골드코스트', 405),
    ('칸쿤', 1209),
    ('리우데자네이루', 1080),
    ('상파울루', 1083),
    ('부에노스아이레스', 294),
    ('산티아고', 103)
),
reviewed_documents AS (
  SELECT
    destination,
    'https://worldweather.wmo.int/kr/city.html?cityId=' || city_id::text AS source_url,
    'WWIS reviewed Korean city context page for ' || destination || '.' AS review_note
  FROM reviewed_wmo_city
  UNION ALL
  SELECT
    destination,
    'https://worldweather.wmo.int/kr/json/' || city_id::text || '_kr.xml' AS source_url,
    'WWIS reviewed machine-readable climate normals for ' || destination || '.' AS review_note
  FROM reviewed_wmo_city
),
wmo_registry AS (
  SELECT id
  FROM public.blog_information_official_source_registry
  WHERE hostname = 'worldweather.wmo.int'
    AND source_type = 'meteorological_agency'
    AND status = 'active'
  LIMIT 1
)
INSERT INTO public.blog_information_official_research_documents (
  official_source_registry_id,
  source_url,
  intents,
  destinations,
  status,
  reviewed_by,
  reviewed_at,
  review_note
)
SELECT
  registry.id,
  document.source_url,
  ARRAY['monthly_weather'],
  ARRAY[document.destination],
  'active',
  'codex_wmo_catalog_audit',
  '2026-07-24T12:00:00Z',
  document.review_note
FROM reviewed_documents document
CROSS JOIN wmo_registry registry
ON CONFLICT (official_source_registry_id, source_url) DO UPDATE
SET
  intents = EXCLUDED.intents,
  destinations = EXCLUDED.destinations,
  status = EXCLUDED.status,
  reviewed_by = EXCLUDED.reviewed_by,
  reviewed_at = EXCLUDED.reviewed_at,
  review_note = EXCLUDED.review_note,
  updated_at = now();

UPDATE public.publishing_policies
SET
  posts_per_day = 5,
  slot_times = ARRAY['09:00', '12:00', '15:00', '18:00', '21:00'],
  updated_at = now()
WHERE scope = 'global';

COMMENT ON COLUMN public.blog_information_official_research_documents.destinations IS
  'Explicit destination allowlist for direct research; empty means globally applicable.';
