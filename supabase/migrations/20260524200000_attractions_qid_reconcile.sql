-- ═══════════════════════════════════════════════════════════════
-- attractions_qid_reconcile:
--   1. attractions 에 Wikidata QID 컬럼 추가 (UNIQUE)
--   2. unmatched_activities status CHECK 에 'dismissed' 추가
--   3. unmatched_activities 에 note 컬럼 확인 (추가되지 않았다면 추가)
-- ═══════════════════════════════════════════════════════════════

-- 1) attractions.qid (Wikidata canonical entity ID)
ALTER TABLE public.attractions
  ADD COLUMN IF NOT EXISTS qid text;
COMMENT ON COLUMN public.attractions.qid IS 'Wikidata QID — canonical entity 식별자 (예: Q____)';

CREATE UNIQUE INDEX IF NOT EXISTS idx_attractions_qid
  ON public.attractions(qid)
  WHERE qid IS NOT NULL;

-- 2) unmatched_activities status CHECK 에 'dismissed' 추가
--    PostgreSQL 는 직접 ALTER CHECK 불가 → DROP 후 재생성
ALTER TABLE public.unmatched_activities
  DROP CONSTRAINT IF EXISTS unmatched_activities_status_check;

ALTER TABLE public.unmatched_activities
  ADD CONSTRAINT unmatched_activities_status_check
    CHECK (status IN ('pending', 'ignored', 'added', 'dismissed'));

-- 3) note 컬럼 (이전 migration 에서 빠진 경우 대비)
ALTER TABLE public.unmatched_activities
  ADD COLUMN IF NOT EXISTS note text;
COMMENT ON COLUMN public.unmatched_activities.note IS
  '관리자 메모 / Wikidata 제안 정보(JSON) / dismissed 사유';
