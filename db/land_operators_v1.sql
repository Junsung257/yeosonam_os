-- ============================================================
-- 여소남 OS — land_operators 테이블 생성
-- Supabase > SQL Editor 에서 실행하세요.
-- ============================================================

-- 1. 테이블 생성
CREATE TABLE IF NOT EXISTS public.land_operators (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,
  contact    TEXT,
  regions    TEXT[]      DEFAULT '{}',
  memo       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_land_operators_updated_at ON public.land_operators;
CREATE TRIGGER trg_land_operators_updated_at
  BEFORE UPDATE ON public.land_operators
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. bookings 테이블에 FK 컬럼 추가 (없을 경우에만)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS land_operator_id UUID REFERENCES public.land_operators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_name     TEXT,
  ADD COLUMN IF NOT EXISTS adult_price      INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS has_sent_docs    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata         JSONB   DEFAULT '{}';

-- 4. 기본 랜드사 시드 데이터 (중복 무시)
INSERT INTO public.land_operators (name, regions) VALUES
  ('투어폰',       '{}'),
  ('투어비',       '{}'),
  ('현지투어',     '{}'),
  ('나라투어',     '{}'),
  ('하나투어 현지','{}'),
  ('모두투어 현지','{}'),
  ('선셋투어',     '{}'),
  ('아시아투어',   '{}'),
  ('골든투어',     '{}'),
  ('퍼시픽투어',   '{}'),
  ('드래곤투어',   '{}'),
  ('로열투어',     '{}'),
  ('직접 진행',    '{}'),
  ('기타',         '{}')
ON CONFLICT (name) DO NOTHING;

-- 5. RLS 설정 (이미 bookings 테이블과 동일 정책 사용 권장)
ALTER TABLE public.land_operators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.land_operators;
CREATE POLICY "Service role full access"
  ON public.land_operators
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read" ON public.land_operators;
CREATE POLICY "Authenticated read"
  ON public.land_operators
  FOR SELECT
  TO authenticated
  USING (true);

-- 6. 인덱스
CREATE INDEX IF NOT EXISTS idx_land_operators_name    ON public.land_operators (name);
CREATE INDEX IF NOT EXISTS idx_bookings_land_op_id    ON public.bookings (land_operator_id);

-- 확인
SELECT id, name, regions FROM public.land_operators ORDER BY name;
