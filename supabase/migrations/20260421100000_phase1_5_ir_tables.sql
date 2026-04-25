-- Phase 1.5: Intake Normalizer (IR) 레이어 DB 지원
-- 1) normalized_intakes 신설 — IR 저장
-- 2) unmatched_activities 확장 — misc 세그먼트 통합 처리

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. normalized_intakes — IR 영속 테이블
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.normalized_intakes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 소스 원문
  raw_text       TEXT NOT NULL,
  raw_text_hash  TEXT NOT NULL,
  -- IR 본체
  ir             JSONB NOT NULL,
  -- 연결된 상품 (생성 후)
  package_id     UUID REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  -- 소스 추적
  land_operator  TEXT,
  region         TEXT,
  normalizer_version TEXT NOT NULL,
  -- Canary / 감사 상태
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','confirmed','converted','failed','rejected')),
  canary_mode    BOOLEAN NOT NULL DEFAULT true,
  -- 사장님 컨펌 트래킹
  confirmed_by   TEXT,
  confirmed_at   TIMESTAMPTZ,
  -- Judge/감사 결과 (선택)
  judge_verdict  TEXT CHECK (judge_verdict IN ('clean','warnings','blocked')),
  judge_report   JSONB,
  -- 타임스탬프
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_normalized_intakes_hash ON public.normalized_intakes (raw_text_hash);
CREATE INDEX IF NOT EXISTS idx_normalized_intakes_pkg  ON public.normalized_intakes (package_id);
CREATE INDEX IF NOT EXISTS idx_normalized_intakes_region ON public.normalized_intakes (region);
CREATE INDEX IF NOT EXISTS idx_normalized_intakes_status ON public.normalized_intakes (status, created_at DESC);

-- RLS
ALTER TABLE public.normalized_intakes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service-role only" ON public.normalized_intakes
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.normalized_intakes IS
  'Phase 1.5 IR (NormalizedIntake) 영속. 원문→IR→pkg 3단 파이프의 중간 산출물. canary_mode=true 면 신규 파이프.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. unmatched_activities 확장 — misc 세그먼트 & attraction lookup 실패 통합
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.unmatched_activities
  ADD COLUMN IF NOT EXISTS segment_kind_guess TEXT,           -- 'attraction'|'transit'|'note'|'special'|'meal'|'hotel-check'|'misc'
  ADD COLUMN IF NOT EXISTS raw_label          TEXT,            -- IR segment.rawLabel
  ADD COLUMN IF NOT EXISTS normalizer_version TEXT,
  ADD COLUMN IF NOT EXISTS confidence         NUMERIC,         -- 0.0~1.0
  ADD COLUMN IF NOT EXISTS intake_id          UUID REFERENCES public.normalized_intakes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS segment_index      INTEGER,         -- days[].segments[] index
  ADD COLUMN IF NOT EXISTS resolved_kind      TEXT,            -- 어드민 재분류 결과
  ADD COLUMN IF NOT EXISTS resolved_attraction_id UUID REFERENCES public.attractions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by        TEXT;

CREATE INDEX IF NOT EXISTS idx_unmatched_activities_intake ON public.unmatched_activities (intake_id);
CREATE INDEX IF NOT EXISTS idx_unmatched_activities_status ON public.unmatched_activities (status, created_at DESC);

COMMENT ON COLUMN public.unmatched_activities.segment_kind_guess IS
  'Normalizer 가 추정한 segment 종류. misc 는 분류 실패 — 어드민 재분류 대상.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. updated_at 자동 갱신 트리거
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalized_intakes_updated_at ON public.normalized_intakes;
CREATE TRIGGER trg_normalized_intakes_updated_at
  BEFORE UPDATE ON public.normalized_intakes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
