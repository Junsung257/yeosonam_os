-- Hot-path indexes for Supabase resource pressure incidents.
-- Covers 503/504/522 paths observed in public landing reads and background crons.
-- Use guarded blocks so older review databases do not fail when optional tables are absent.

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_travel_packages_public_updated_desc
    ON public.travel_packages (updated_at DESC)
    WHERE status IN ('active', 'approved');
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_travel_packages_rating_updated_desc
    ON public.travel_packages (updated_at DESC)
    WHERE avg_rating IS NOT NULL AND review_count >= 1;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_cron_run_logs_name_started_desc
    ON public.cron_run_logs (cron_name, started_at DESC);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_content_distributions_scheduled_due
    ON public.content_distributions (scheduled_for ASC)
    WHERE status = 'scheduled';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_agent_actions_pending_expires
    ON public.agent_actions (expires_at ASC)
    WHERE status = 'pending' AND expires_at IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_blog_topic_queue_status_updated
    ON public.blog_topic_queue (status, updated_at);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_indexing_reports_reported_desc
    ON public.indexing_reports (reported_at DESC);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_blog_visibility_snapshots_checked_desc
    ON public.blog_visibility_snapshots (checked_at DESC);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_creative_performance_impressions_date
    ON public.creative_performance (date DESC, impressions DESC)
    WHERE impressions > 100;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_ad_creatives_active_meta
    ON public.ad_creatives (meta_ad_id)
    WHERE status = 'active' AND meta_ad_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_upload_review_queue_pending_severity_created
    ON public.upload_review_queue (severity, created_at DESC)
    WHERE status = 'pending';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
