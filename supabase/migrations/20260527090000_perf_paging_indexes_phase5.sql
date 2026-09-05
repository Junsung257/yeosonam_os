-- 성능 최적화 Phase 5 (2026-05-27) — 페이징 쿼리 + 필터 인덱스
--
-- 목표: .order().range() 페이징 쿼리와 .in()/.neq() 필터가 자주 호출되는
--       주요 API 라우트의 응답 시간 단축.

-- ── 1. blog_posts: 블로그 목록 페이징 (published_at DESC + range) ──
-- blog_posts is an untracked legacy table; content_creatives is the current blog SSOT.
CREATE INDEX IF NOT EXISTS idx_content_creatives_published_at
  ON content_creatives (published_at DESC);
-- blog/route.ts: .range() + .order('published_at', { ascending: false })

-- ── 2. travel_packages: 패키지 목록 페이징 (created_at DESC + range) ──
CREATE INDEX IF NOT EXISTS idx_travel_packages_created_at_desc
  ON travel_packages (created_at DESC);
-- packages/route.ts: .range() + .order('created_at', { ascending: false })
-- 참고: phase4 에서 travel_packages(created_at) ASC 생성 시 DESC 보강

-- ── 3. b2b_packages: B2B 패키지 페이징 ──
-- B2B package reads use travel_packages, covered by idx_travel_packages_created_at_desc above.
-- b2b/packages/route.ts

-- ── 4. products: 상품 목록 페이징 ──
CREATE INDEX IF NOT EXISTS idx_products_created_at_desc
  ON products (created_at DESC);
-- products/route.ts: .order('created_at', { ascending: false }).range()

-- ── 5. agent_*: AI 에이전트 테이블 페이징 ──
CREATE INDEX IF NOT EXISTS idx_agent_incidents_created_at_desc
  ON agent_incidents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_requested_at_desc
  ON agent_approvals (requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created_at_desc
  ON agent_tasks (created_at DESC);

-- ── 6. unmatched_attractions: 미매칭 관광지 페이징 ──
CREATE INDEX IF NOT EXISTS idx_unmatched_activities_created_at_desc
  ON unmatched_activities (created_at DESC);
-- unmatched/route.ts

-- ── 8. attractions: 관광지 페이징 (mention_count DESC — 기존 정렬 기준 보강) ──
CREATE INDEX IF NOT EXISTS idx_attractions_mention_count_desc
  ON attractions (mention_count DESC);
-- attractions/route.ts: .order('mention_count', { ascending: false }).range()

-- ── 9. payments (auto-suggest): status + customer_id 복합 ──
-- The payment suggestion flow reads bank_transactions and bookings; no payments table exists.
-- payments/auto-suggest/route.ts: .neq('status', 'cancelled')

-- ── 10. products (review): status 필터 인덱스 ──
CREATE INDEX IF NOT EXISTS idx_products_status
  ON products (status);
-- products/review/route.ts: .in('status', ['DRAFT', 'REVIEW_NEEDED'])
