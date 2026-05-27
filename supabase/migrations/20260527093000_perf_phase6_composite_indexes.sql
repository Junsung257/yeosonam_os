-- 성능 최적화 Phase 6 (2026-05-27) — 복합 인덱스 + 부분 인덱스 보강
--
-- Phase 5까지의 인덱스 중 실제 쿼리 패턴과 불일치가 있는 부분을 보강.
--
-- 식별된 미인덱스 핫패스:
--   1) travel_packages: status IN ('active','approved') + created_at DESC
--      → packages/search/route.ts: .in('status',[...]).order('created_at',false).limit(N)
--   2) attractions: photos IS NOT NULL + mention_count DESC
--      → packages/search/route.ts: .not('photos','is',null).order('mention_count',false)
--   3) content_creatives: status=published + channel + published_at DESC
--      → blog/route.ts: .eq('status','published').eq('channel','naver_blog').order('published_at',false)
-- ============================================================================

DO $$ BEGIN
  -- ── 1) travel_packages: 활성 패키지 목록 조회 ──
  -- packages/search/route.ts: L64 .in('status', ['active', 'approved']).order('created_at', { ascending: false }).limit(fetchLimit)
  CREATE INDEX IF NOT EXISTS idx_travel_packages_active_created_desc
    ON travel_packages (created_at DESC)
    WHERE status IN ('active', 'approved');
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  -- ── 2) attractions: 사진 있는 관광지 정렬 조회 ──
  -- packages/search/route.ts: L119 .not('photos', 'is', null).order('mention_count', { ascending: false }).limit(attractionLimit)
  CREATE INDEX IF NOT EXISTS idx_attractions_photos_mention_desc
    ON attractions (mention_count DESC)
    WHERE photos IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  -- ── 3) content_creatives: 블로그 발행 목록 조회 ──
  -- blog/route.ts: .eq('status','published').eq('channel','naver_blog').order('published_at',false).range()
  CREATE INDEX IF NOT EXISTS idx_content_creatives_published_blog
    ON content_creatives (published_at DESC)
    WHERE status = 'published' AND channel = 'naver_blog';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── 코멘트 ──
COMMENT ON INDEX idx_travel_packages_active_created_desc IS
  'Phase 6 perf: 패키지 검색 목록 (active/approved → created_at DESC)';
COMMENT ON INDEX idx_attractions_photos_mention_desc IS
  'Phase 6 perf: 사진 있는 관광지 mention_count 정렬';
COMMENT ON INDEX idx_content_creatives_published_blog IS
  'Phase 6 perf: 블로그 발행 목록 published_at 정렬';
