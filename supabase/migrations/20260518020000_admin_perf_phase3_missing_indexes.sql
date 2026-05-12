-- 어드민 속도 감사 Phase 3 (2026-05-11) — hot path missing index 보강.
-- 감사: docs/audits/2026-05-11-admin-perf-audit.md §13
--
-- EXPLAIN ANALYZE 결과로 식별된 인덱스 부재:
--   travel_packages 목록 (status='all', LIMIT 100, created_at DESC)
--     → Seq Scan + Top-N heapsort, execution 72ms
--   customers 목록 (deleted_at IS NULL, LIMIT 30, created_at DESC)
--     → idx_customers_deleted_at 는 full index 라 IS NULL + 정렬 동시 활용 약함

-- ── 1) travel_packages — 어드민 목록 (status 미지정 + created_at DESC) ──
-- 기존: idx_travel_packages_status_created(status, created_at DESC) — status filter 일 때만 활용.
-- 어드민 목록 페이지가 status='all' 시 Seq Scan + Top-N sort (72ms, 348행).
-- 신규 인덱스 적용 후 Index Scan 으로 10ms (−86%) 검증 완료.
CREATE INDEX IF NOT EXISTS idx_travel_packages_created_at
  ON travel_packages (created_at DESC);

-- ── 2) customers — 활성 고객 목록 (deleted_at IS NULL + created_at DESC) ──
-- 기존: idx_customers_deleted_at(deleted_at) — full index, IS NULL 활용 약함.
-- 부분 인덱스로 활성 고객만 인덱싱 → 더 작은 인덱스 + 정렬 즉시 활용.
CREATE INDEX IF NOT EXISTS idx_customers_active_created
  ON customers (created_at DESC)
  WHERE deleted_at IS NULL;
