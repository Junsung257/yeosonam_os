-- X4-3 박제 (2026-05-15): 어드민 attraction 정확/부정확 1-click 피드백.
-- 사장님 도메인 전문성으로 자동 시드 결과 검증 → confidence_score 자동 조정.

CREATE TABLE IF NOT EXISTS public.attraction_feedback (
  id           bigserial PRIMARY KEY,
  attraction_id uuid NOT NULL REFERENCES public.attractions(id) ON DELETE CASCADE,
  verdict      text NOT NULL CHECK (verdict IN ('accurate','inaccurate')),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attraction_feedback_attraction ON public.attraction_feedback(attraction_id);

ALTER TABLE public.attraction_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_anon_attraction_feedback" ON public.attraction_feedback
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

COMMENT ON TABLE public.attraction_feedback IS
'어드민 사장님 1-click 정확/부정확 피드백. accurate 시 confidence_score +0.1 / inaccurate 시 -0.2 + is_active=false 자동. 2026-05-15 박제.';
