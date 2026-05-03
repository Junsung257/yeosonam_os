-- MRT 수집 파이프라인: 도시별 카테고리(랜딩 칩) + 상세 본문 큐
-- Phase1: 목록 upsert 후 카테고리 저장, 선택적으로 상세 작업 큐 적재
-- Phase2: db/mrt_detail_worker.js 가 큐를 순차 소비 → attractions.mrt_raw_desc

BEGIN;

-- 목록에서 상세 API 호출 시 TNA 딥링크 보존 (getTnaDetail gid+url)
ALTER TABLE public.attractions
  ADD COLUMN IF NOT EXISTS mrt_provider_url TEXT;

COMMENT ON COLUMN public.attractions.mrt_provider_url IS
  'MRT 상품 딥링크. getTnaDetail 시 url 인자로 사용. 내부·추적용.';

-- 도시별 getCategoryList 결과 (모바일 랜딩 탭/칩 SSOT)
CREATE TABLE IF NOT EXISTS public.mrt_city_categories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_query        TEXT NOT NULL,
  region            TEXT,
  country           TEXT,
  category_ext_id   TEXT,
  category_name     TEXT NOT NULL,
  item_count        INTEGER,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mrt_city_categories_dedup UNIQUE (city_query, category_name)
);

CREATE INDEX IF NOT EXISTS idx_mrt_city_categories_city
  ON public.mrt_city_categories (city_query);

COMMENT ON TABLE public.mrt_city_categories IS
  'MRT getCategoryList — 도시별 TNA 카테고리(칩). 랜딩 UI 정형화용.';

-- 상세 본문 수집 큐 (순차 워커)
CREATE TABLE IF NOT EXISTS public.mrt_detail_fetch_queue (
  mrt_gid       TEXT PRIMARY KEY,
  mrt_category  TEXT NOT NULL CHECK (mrt_category IN ('tna', 'stay')),
  provider_url  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mrt_detail_queue_pending
  ON public.mrt_detail_fetch_queue (created_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.mrt_detail_fetch_queue IS
  'MRT getTnaDetail/getStayDetail 배치 큐. service_role/워커만 쓰기.';

ALTER TABLE public.mrt_city_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mrt_detail_fetch_queue ENABLE ROW LEVEL SECURITY;

COMMIT;
