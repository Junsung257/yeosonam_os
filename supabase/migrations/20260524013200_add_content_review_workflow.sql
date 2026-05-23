-- ============================================================
-- Content Review/Approval Workflow — 검토 할당·우선순위 큐·거절 분류
-- ============================================================
-- 기존 content_creatives.status('draft' → 'published') 를 깨지 않고
-- review metadata 를 별도 테이블로 추가하는 additive migration.
-- ============================================================

BEGIN;

-- ─── 1) content_reviews: 검토 내역 (멀티 라운드) ─────────────
CREATE TABLE IF NOT EXISTS content_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  creative_id UUID REFERENCES content_creatives(id) ON DELETE CASCADE,
  reviewer_id UUID,                                   -- admin user id
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_review', 'approved', 'rejected', 'changes_requested'
  )),
  review_note TEXT,
  rejection_reason TEXT,
  rejection_category TEXT CHECK (rejection_category IN (
    'quality_low', 'fact_error', 'seo_issue', 'brand_violation',
    'duplicate', 'inappropriate_tone', 'legal_issue', 'other'
  )),
  suggested_changes TEXT,                             -- JSON string with change suggestions
  review_round INTEGER DEFAULT 1,
  previous_review_id UUID,                            -- link to previous round
  assigned_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── 2) content_review_queue: 우선순위 큐 ────────────────────
CREATE TABLE IF NOT EXISTS content_review_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  creative_id UUID REFERENCES content_creatives(id) ON DELETE CASCADE,
  priority INTEGER DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
  reason TEXT NOT NULL CHECK (reason IN (
    'new_content', 're_resubmit', 'auto_generated', 'high_traffic_update', 'scheduled_publish'
  )),
  due_at TIMESTAMPTZ,
  auto_approve_after_hours INTEGER DEFAULT 48,
  status TEXT DEFAULT 'queued' CHECK (status IN (
    'queued', 'assigned', 'completed', 'auto_approved', 'skipped'
  )),
  assigned_to UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── 3) 인덱스 ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_content_reviews_creative
  ON content_reviews(creative_id);
CREATE INDEX IF NOT EXISTS idx_content_reviews_reviewer
  ON content_reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_content_reviews_status
  ON content_reviews(status);
CREATE INDEX IF NOT EXISTS idx_content_review_queue_priority
  ON content_review_queue(priority DESC);
CREATE INDEX IF NOT EXISTS idx_content_review_queue_status
  ON content_review_queue(status);
CREATE INDEX IF NOT EXISTS idx_content_review_queue_creative
  ON content_review_queue(creative_id);

-- ─── 4) RLS: service_role 전용 (admin API 경유) ────────────────
ALTER TABLE content_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_review_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_reviews service_role" ON content_reviews;
CREATE POLICY "content_reviews service_role"
  ON content_reviews FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "content_review_queue service_role" ON content_review_queue;
CREATE POLICY "content_review_queue service_role"
  ON content_review_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 5) content_creatives 에 review_status 확장 컬럼 (선택적) ──
--     기존 status('draft', 'published') 는 그대로 두고,
--     review 전용 상태를 별도 컬럼으로 추적한다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'content_creatives' AND column_name = 'review_status'
  ) THEN
    ALTER TABLE content_creatives
      ADD COLUMN review_status TEXT
        DEFAULT 'none'
        CHECK (review_status IN (
          'none', 'pending_review', 'in_review',
          'approved', 'rejected', 'changes_requested'
        ));
  END IF;
END$$;

COMMIT;
