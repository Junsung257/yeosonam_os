-- ============================================================
-- products_ai_expansion_v1.sql
-- 여소남 OS: AI 파싱 자산화 + 빅테크급 DB 아키텍처 확장
--
-- 실행 순서:
--   1. Supabase Dashboard > Database > Extensions > vector 활성화
--   2. 아래 SQL 전체를 SQL Editor에서 순서대로 실행
-- ============================================================


-- ─── 0. pgvector 익스텐션 ─────────────────────────────────────────
-- Supabase Dashboard > Database > Extensions > vector 를 먼저 활성화한 후 실행하거나
-- 아래 명령으로 활성화합니다.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;


-- ─── 1. document_hashes (파일 중복 업로드 차단) ───────────────────
-- SHA-256 해시 기반으로 동일 파일 재업로드 시 AI 파싱 토큰 낭비를 방지합니다.

CREATE TABLE IF NOT EXISTS document_hashes (
  file_hash   TEXT          PRIMARY KEY,            -- SHA-256 hex (64자)
  file_name   TEXT          NOT NULL,               -- 원본 파일명
  product_id  VARCHAR       REFERENCES products(internal_code) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ   DEFAULT now()
);

COMMENT ON TABLE document_hashes IS 'PDF 파일 SHA-256 해시 → 중복 업로드 방지 및 토큰 낭비 차단';
COMMENT ON COLUMN document_hashes.file_hash IS 'SHA-256 hex string (64자). 동일 파일이면 동일 hash.';

ALTER TABLE document_hashes ENABLE ROW LEVEL SECURITY;

-- Service Role 전용 (일반 사용자 직접 접근 불가)
CREATE POLICY "document_hashes: service role only"
  ON document_hashes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ─── 2. products 테이블 AI 확장 컬럼 추가 ────────────────────────
-- ADD COLUMN IF NOT EXISTS → 이미 존재하는 컬럼은 무시하므로 안전합니다.

-- 2-1. status CHECK 제약 확장
--      기존: 'draft' | 'active' | 'expired' | 'cancelled'  (lowercase)
--      신규: 'DRAFT' | 'REVIEW_NEEDED' | 'ACTIVE' | 'INACTIVE' 추가
--      하위 호환: 기존 코드(upload/route.ts)의 lowercase 'draft' 값 계속 허용
DO $$
BEGIN
  -- 기존 인라인 CHECK 제약 제거 (이름이 다를 수 있으므로 3가지 명칭 시도)
  ALTER TABLE products DROP CONSTRAINT IF EXISTS products_status_check;
  ALTER TABLE products DROP CONSTRAINT IF EXISTS products_status_check1;
  ALTER TABLE products DROP CONSTRAINT IF EXISTS products_status_fkey;
EXCEPTION WHEN undefined_object THEN
  NULL; -- 제약이 없으면 그냥 통과
END$$;

ALTER TABLE products
  ADD CONSTRAINT products_status_check
  CHECK (status IN (
    -- 기존 lowercase (하위 호환)
    'draft', 'active', 'expired', 'cancelled',
    -- 신규 uppercase (HITL 상태 관리)
    'DRAFT', 'REVIEW_NEEDED', 'ACTIVE', 'INACTIVE'
  ));

-- DEFAULT를 신규 표준인 'DRAFT'로 변경
ALTER TABLE products
  ALTER COLUMN status SET DEFAULT 'DRAFT';

COMMENT ON COLUMN products.status IS
  'DRAFT(파싱완료/검토전) | REVIEW_NEEDED(AI확신도낮음) | ACTIVE(활성판매) | INACTIVE(판매중단) | expired(만료) | cancelled(취소)';

-- 2-2. AI 파싱 품질 관리
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ai_confidence_score  INT
    CHECK (ai_confidence_score BETWEEN 0 AND 100);

COMMENT ON COLUMN products.ai_confidence_score IS 'AI 파싱 확신도 0~100. 70 미만이면 status=REVIEW_NEEDED 권장';

-- 2-3. 마케팅 태그 (기존 ai_tags와 별도 운영)
--      ai_tags: AI 자동 태그 / theme_tags: 마케터가 검수한 마케팅 태그
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS theme_tags            TEXT[]   DEFAULT '{}';

COMMENT ON COLUMN products.theme_tags IS '마케팅 테마 태그 배열 (예: {"노옵션","가족여행","허니문"})';

-- 2-4. 세일즈 & 항공 정보 (JSONB)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS selling_points        JSONB;

COMMENT ON COLUMN products.selling_points IS
  '핵심 세일즈 포인트 JSON (예: {"hotel":"그랜드하얏트","airline":"대한항공","unique":["야경투어포함"]})';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS flight_info           JSONB;

COMMENT ON COLUMN products.flight_info IS
  '항공 정보 JSON (예: {"airline":"OZ","depart":"07:30","arrive":"09:45","return_depart":"14:00"})';

-- 2-5. 원본 파싱 데이터
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS raw_extracted_text    TEXT;

COMMENT ON COLUMN products.raw_extracted_text IS 'PDF에서 추출한 원본 텍스트 전문. ai_training_logs의 기초 데이터.';

-- 2-6. 이미지 URL 배열
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS thumbnail_urls        TEXT[]   DEFAULT '{}';

COMMENT ON COLUMN products.thumbnail_urls IS 'PDF/카드뉴스에서 추출된 이미지 URL 배열 (Supabase Storage)';

-- 2-7. RAG 벡터 임베딩 (pgvector)
--      주의: extensions.vector 타입 사용. vector extension이 반드시 먼저 활성화되어야 합니다.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS embedding             extensions.vector(1536);

COMMENT ON COLUMN products.embedding IS 'OpenAI text-embedding-3-small (1536차원). RAG 검색용. 생성 전 NULL 허용.';

-- embedding 컬럼 RLS: 일반 authenticated 사용자에게 노출 차단
-- (Service Role로만 읽기/쓰기 가능하게 하려면 별도 컬럼 마스킹 정책 필요)
-- 현재는 테이블 레벨 RLS로 authenticated read 허용 상태이므로 주의
-- 향후 embedding 전용 보안 뷰 생성 권장:
--   CREATE VIEW products_public AS SELECT internal_code, display_name, ...(embedding 제외) FROM products;


-- ─── 3. product_prices (1:N 날짜별 가격 테이블) ───────────────────
-- JSONB pricing_matrix의 한계를 넘기 위한 정규화 테이블.
-- 날짜 또는 요일별 가격 고속 인덱스 검색 가능.

CREATE TABLE IF NOT EXISTS product_prices (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            VARCHAR      NOT NULL
                          REFERENCES products(internal_code) ON DELETE CASCADE,
  target_date           DATE,        -- 특정 날짜 가격 (예: 2025-05-03)
  day_of_week           VARCHAR(3),  -- 요일별 가격 (MON, TUE, WED, THU, FRI, SAT, SUN)
  net_price             INTEGER      NOT NULL,             -- 원가
  adult_selling_price   INTEGER,                          -- 성인 판매가
  child_price           INTEGER,                          -- 소아 가격
  note                  TEXT,                             -- 가격 조건 메모 (예: "연휴 추가요금")
  created_at            TIMESTAMPTZ  DEFAULT now(),

  -- target_date와 day_of_week 중 하나는 반드시 존재해야 함
  CONSTRAINT product_prices_date_or_dow
    CHECK (target_date IS NOT NULL OR day_of_week IS NOT NULL),

  -- day_of_week 유효값 제한
  CONSTRAINT product_prices_dow_check
    CHECK (day_of_week IN ('MON','TUE','WED','THU','FRI','SAT','SUN') OR day_of_week IS NULL)
);

COMMENT ON TABLE product_prices IS '상품별 날짜/요일 가격 테이블. product_id + target_date 복합 인덱스로 고속 검색.';
COMMENT ON COLUMN product_prices.target_date IS '특정 날짜 가격. day_of_week와 상호 배타적으로 사용 가능.';
COMMENT ON COLUMN product_prices.day_of_week IS '요일별 정규 가격. MON/TUE/WED/THU/FRI/SAT/SUN 중 하나.';

-- 복합 인덱스: product_id + target_date (가장 빈번한 검색 패턴)
CREATE INDEX IF NOT EXISTS idx_product_prices_product_date
  ON product_prices (product_id, target_date);

-- product_id 단독 인덱스 (상품별 전체 가격 조회)
CREATE INDEX IF NOT EXISTS idx_product_prices_product_id
  ON product_prices (product_id);

ALTER TABLE product_prices ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자: 읽기 허용
CREATE POLICY "product_prices: authenticated read"
  ON product_prices FOR SELECT TO authenticated USING (true);

-- 쓰기는 Service Role 전용 (API 라우트에서 supabaseAdmin 사용)
CREATE POLICY "product_prices: service role write"
  ON product_prices FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- ─── 4. ai_training_logs (Data Flywheel 훈련 로그) ───────────────
-- 직원이 AI 파싱 결과를 수정한 내역을 저장.
-- 누적 데이터로 향후 Fine-tuning / Few-shot 프롬프트 개선에 활용.

CREATE TABLE IF NOT EXISTS ai_training_logs (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id               VARCHAR     REFERENCES products(internal_code) ON DELETE CASCADE,
  original_raw_text        TEXT,                  -- AI가 파싱한 원본 텍스트
  ai_parsed_json           JSONB,                 -- AI가 반환한 파싱 결과
  human_corrected_json     JSONB,                 -- 직원이 수정한 최종 결과
  correction_diff          JSONB,                 -- 변경된 필드만 추출 (자동 계산 권장)
  corrected_by             UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  ai_model_used            VARCHAR,               -- 사용된 AI 모델 (예: 'gpt-4o', 'gemini-2.5-flash')
  confidence_before        INT,                   -- 수정 전 ai_confidence_score
  confidence_after         INT,                   -- 수정 후 사람이 평가한 신뢰도
  created_at               TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE ai_training_logs IS
  'AI 파싱 결과와 사람 수정 내역 로그. Data Flywheel — 누적 데이터로 AI 정확도 개선.';
COMMENT ON COLUMN ai_training_logs.correction_diff IS
  '변경된 필드 diff JSON (예: {"net_price": {"from": 0, "to": 450000}})';
COMMENT ON COLUMN ai_training_logs.ai_model_used IS
  '파싱에 사용된 AI 모델 ID. 모델별 성능 비교 분석에 사용.';

-- product_id 인덱스 (상품별 훈련 로그 조회)
CREATE INDEX IF NOT EXISTS idx_ai_training_logs_product_id
  ON ai_training_logs (product_id);

-- 최신 로그 조회 최적화
CREATE INDEX IF NOT EXISTS idx_ai_training_logs_created_at
  ON ai_training_logs (created_at DESC);

ALTER TABLE ai_training_logs ENABLE ROW LEVEL SECURITY;

-- Service Role 전용 (민감한 원본 텍스트 포함)
CREATE POLICY "ai_training_logs: service role only"
  ON ai_training_logs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 관리자는 읽기만 허용 (수정/삭제 불가)
CREATE POLICY "ai_training_logs: authenticated read only"
  ON ai_training_logs FOR SELECT
  TO authenticated
  USING (true);


-- ─── 5. embedding 벡터 검색 인덱스 (IVFFlat) ─────────────────────
-- 주의: embedding 컬럼에 데이터가 충분히 쌓인 후 생성하세요 (최소 100건 이상 권장).
-- 지금 생성하면 빈 테이블에 인덱스를 만들어 lists 파라미터가 무의미합니다.

-- 아래는 데이터 적재 후 실행하세요:
-- CREATE INDEX idx_products_embedding_cosine
--   ON products
--   USING ivfflat (embedding extensions.vector_cosine_ops)
--   WITH (lists = 100);

-- 당장 테스트용으로 작은 데이터셋에서 사용할 경우 (100건 미만):
-- CREATE INDEX idx_products_embedding_cosine
--   ON products
--   USING ivfflat (embedding extensions.vector_cosine_ops)
--   WITH (lists = 10);

-- ─── 완료 ────────────────────────────────────────────────────────
-- 실행 후 확인:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'products' ORDER BY ordinal_position;
