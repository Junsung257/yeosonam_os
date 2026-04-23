-- ============================================================
-- 카드뉴스 V2 인프라 테이블
-- 마이그레이션: 20260423010000
-- 목적:
--   1. card_news_renders: (card_news_id, slide_id, format, url) 매핑
--      같은 슬라이드를 1:1/4:5/9:16/블로그 4포맷으로 렌더한 결과 추적
--   2. card_news_variants: A/B 테스트용 variant 메타
--      같은 brief를 다른 family로 렌더한 variant들을 묶음
--   3. brand_kits: 멀티테넌시 대비 브랜드 토큰 테이블 (yeosonam 시드 1건)
--   4. card_news 테이블에 template_family / template_version / brand_kit_id 컬럼 추가
-- ============================================================

BEGIN;

-- ── 1. card_news 테이블 확장 ─────────────────────────
ALTER TABLE card_news
  ADD COLUMN IF NOT EXISTS template_family TEXT
    CHECK (template_family IN ('editorial','cinematic','premium','bold')),
  ADD COLUMN IF NOT EXISTS template_version TEXT DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS brand_kit_id UUID;

COMMENT ON COLUMN card_news.template_family IS 'V2 템플릿 family: editorial/cinematic/premium/bold';
COMMENT ON COLUMN card_news.template_version IS '템플릿 버전 고정 (v1=레거시, v2=Atom 기반). 향후 v3 배포해도 과거 카드 고정 렌더';
COMMENT ON COLUMN card_news.brand_kit_id IS '브랜드 토큰 FK (멀티테넌시 대비, 기본 NULL=yeosonam)';

-- ── 2. brand_kits ───────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_kits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT UNIQUE NOT NULL,       -- 'yeosonam', 'partner-xyz'
  name           TEXT NOT NULL,
  colors         JSONB NOT NULL DEFAULT '{}',  -- { primary, accent, ink, mute, surface, inverse, danger, success, gold }
  fonts          JSONB NOT NULL DEFAULT '{}',  -- { sans, serif, mono }
  logo_text      TEXT,                        -- "YEOSONAM" 등
  logo_url       TEXT,                        -- 이미지 로고 URL (옵셔널)
  domain         TEXT,                        -- 'yeosonam.com'
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_kits_code ON brand_kits(code);

-- FK 연결 (brand_kit_id → brand_kits.id)
DO $$ BEGIN
  ALTER TABLE card_news
    ADD CONSTRAINT fk_card_news_brand_kit
    FOREIGN KEY (brand_kit_id) REFERENCES brand_kits(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- yeosonam 시드 (충돌 시 업데이트)
INSERT INTO brand_kits (code, name, colors, fonts, logo_text, domain)
VALUES (
  'yeosonam',
  '여소남',
  jsonb_build_object(
    'primary', '#001f3f',
    'accent',  '#005d90',
    'ink',     '#001f3f',
    'mute',    '#475569',
    'surface', '#ffffff',
    'inverse', '#ffffff',
    'danger',  '#dc2626',
    'success', '#ea580c',
    'gold',    '#c9a961'
  ),
  jsonb_build_object(
    'sans', 'Pretendard',
    'serif', 'Noto Serif KR',
    'mono', 'JetBrains Mono'
  ),
  'YEOSONAM',
  'yeosonam.com'
)
ON CONFLICT (code) DO UPDATE SET
  colors = EXCLUDED.colors,
  fonts = EXCLUDED.fonts,
  updated_at = now();

-- ── 3. card_news_renders ─────────────────────────────
CREATE TABLE IF NOT EXISTS card_news_renders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_news_id     UUID NOT NULL REFERENCES card_news(id) ON DELETE CASCADE,
  slide_index      INTEGER NOT NULL,            -- 0-based slide position
  slide_id         TEXT,                         -- slides[i].id (내부 uuid, 옵셔널)
  format           TEXT NOT NULL
    CHECK (format IN ('1x1','4x5','9x16','blog')),
  template_family  TEXT,
  template_version TEXT,
  url              TEXT NOT NULL,                -- Supabase Storage public URL
  storage_path     TEXT,                         -- blob 경로 (삭제용)
  rendered_at      TIMESTAMPTZ DEFAULT now(),
  -- 재사용 추적 (이 PNG가 어디에 게시됐는지)
  used_on          JSONB DEFAULT '[]'::jsonb,    -- [{type:'instagram_post', id:'...'}, {type:'blog_post', id:'...'}]
  UNIQUE (card_news_id, slide_index, format, template_version)
);

CREATE INDEX IF NOT EXISTS idx_cn_renders_card  ON card_news_renders(card_news_id);
CREATE INDEX IF NOT EXISTS idx_cn_renders_format ON card_news_renders(format);
CREATE INDEX IF NOT EXISTS idx_cn_renders_rendered_at ON card_news_renders(rendered_at DESC);

COMMENT ON TABLE card_news_renders IS '카드뉴스 슬라이드를 format별로 렌더한 결과물. Instagram/블로그/릴스에서 재사용';

-- ── 4. card_news_variants ────────────────────────────
CREATE TABLE IF NOT EXISTS card_news_variants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_card_news_id UUID REFERENCES card_news(id) ON DELETE CASCADE,  -- 원본 카드뉴스
  variant_card_news_id UUID REFERENCES card_news(id) ON DELETE CASCADE, -- 파생된 variant 카드뉴스
  template_family  TEXT NOT NULL,
  variant_label    TEXT,                                               -- "A", "B", "C" 등
  metrics          JSONB DEFAULT '{}'::jsonb,                          -- impressions/clicks/saves 수집
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (base_card_news_id, template_family)
);

CREATE INDEX IF NOT EXISTS idx_cn_variants_base ON card_news_variants(base_card_news_id);

COMMENT ON TABLE card_news_variants IS '같은 brief로 family만 다르게 렌더한 A/B variant 집합. engagement 비교용';

-- ── 5. brand_kits 전용 updated_at 트리거 (독립 함수) ──
CREATE OR REPLACE FUNCTION update_brand_kits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_brand_kits_updated_at ON brand_kits;
CREATE TRIGGER trg_brand_kits_updated_at
  BEFORE UPDATE ON brand_kits
  FOR EACH ROW EXECUTE FUNCTION update_brand_kits_updated_at();

COMMIT;

-- PostgREST 스키마 캐시 즉시 리로드
NOTIFY pgrst, 'reload schema';
