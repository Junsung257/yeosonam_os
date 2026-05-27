-- 어드민 속도 감사 Phase 4 (2026-05-27) — 전체 개선
--
-- 이전 마이그레이션 (Phase 1~3):
--   20260505000000_query_optimization_indexes
--   20260503121000_travel_packages_search_indexes
--   20260512000000_travel_packages_indexes
--   20260512200000_hot_table_composite_indexes
--   20260513210000_phase10_partial_indexes
--   20260514010000_perf_indexes_hotpath
--   20260518020000_admin_perf_phase3_missing_indexes
--   20260519140000_unindexed_foreign_keys
--
-- Phase 4: 실제 부하 측정에서 식별된 미인덱스 핫패스
--   bank_transactions: received_at + match_status 복합 조회 (6~9초)
--   agent_actions: status + created_at 조회 (6~9초)
--   bookings: getDashboardStats departure_date + status 조회
--   capital_entries: entry_date 정렬 조회
-- ============================================================================

-- ── 1) bank_transactions: 메인 목록 (received_at DESC + match_status 조건) ──
-- 메인 GET: .order('received_at', false).limit(500) + .neq('status', 'excluded')
--   + 매칭 상태 필터 .in('match_status', ['unmatched'])
--   + booking_id 조인
CREATE INDEX IF NOT EXISTS idx_bank_tx_received_desc
  ON bank_transactions (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_bank_tx_match_status_received
  ON bank_transactions (match_status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_bank_tx_status_match_received
  ON bank_transactions (status, match_status, received_at DESC)
  WHERE status IS DISTINCT FROM 'excluded';

-- booking_id FK 조인 (bank_transactions ← bookings)
CREATE INDEX IF NOT EXISTS idx_bank_tx_booking_id
  ON bank_transactions (booking_id)
  WHERE booking_id IS NOT NULL;

-- 미매칭 조회 (match_status = 'unmatched' AND status != 'excluded')
CREATE INDEX IF NOT EXISTS idx_bank_tx_unmatched_active
  ON bank_transactions (received_at DESC)
  WHERE match_status = 'unmatched' AND status IS DISTINCT FROM 'excluded';

-- ── 2) agent_actions: 상태 필터 + created_at 정렬 ──
CREATE INDEX IF NOT EXISTS idx_agent_actions_status_created
  ON agent_actions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_actions_created_desc
  ON agent_actions (created_at DESC);

-- ── 3) bookings: getDashboardStats 주요 쿼리 가속 ──
-- 이번달 출발 기준 예약: .gte('departure_date', thisMonthStart)
--   + .or('is_deleted.is.null,is_deleted.eq.false')
--   + .neq('status', 'cancelled')
CREATE INDEX IF NOT EXISTS idx_bookings_departure_status
  ON bookings (departure_date, status)
  WHERE is_deleted IS NOT TRUE;

-- D-7 잔금미납 조회: .in('status', ['pending', 'confirmed'])
--   + .gte('departure_date', today).lte('departure_date', d7)
--   + is_deleted 조건
CREATE INDEX IF NOT EXISTS idx_bookings_departure_range_status
  ON bookings (departure_date, status)
  WHERE departure_date IS NOT NULL AND is_deleted IS NOT TRUE;

-- 진행 예약 건수: .in('status', ['pending', 'confirmed'])
--   + .gte('departure_date', thisMonthStart)
CREATE INDEX IF NOT EXISTS idx_bookings_active_month
  ON bookings (status, departure_date)
  WHERE is_deleted IS NOT TRUE;

-- ── 4) capital_entries: entry_date 정렬 ──
CREATE INDEX IF NOT EXISTS idx_capital_entries_entry_date
  ON capital_entries (entry_date DESC);

-- ── 5) package_review_digests: review-digest API 가속 ──
-- .eq('package_id', id).limit(1)
CREATE INDEX IF NOT EXISTS idx_pkg_review_digest_package_id
  ON package_review_digests (package_id);

-- ── 6) travel_packages 인덱스 보강 ──
-- 어드민 목록: status=pending + created_at DESC (서버 컴포넌트에서 Promise.all)
CREATE INDEX IF NOT EXISTS idx_travel_packages_pending_created
  ON travel_packages (created_at DESC)
  WHERE status = 'pending';

-- ── 7) agent_actions: agent_type 필터 보강 ──
CREATE INDEX IF NOT EXISTS idx_agent_actions_agent_type_status
  ON agent_actions (agent_type, status, created_at DESC);

-- ── 코멘트 ──
COMMENT ON INDEX idx_bank_tx_received_desc IS
  'Phase 4 perf: bank_transactions 메인 목록 정렬';
COMMENT ON INDEX idx_bank_tx_match_status_received IS
  'Phase 4 perf: 매칭 상태별 조회 (unmatched/review/auto)';
COMMENT ON INDEX idx_bank_tx_status_match_received IS
  'Phase 4 perf: active 제외 + match_status 필터 조회';
COMMENT ON INDEX idx_bank_tx_booking_id IS
  'Phase 4 perf: bank_transactions → bookings 조인';
COMMENT ON INDEX idx_bank_tx_unmatched_active IS
  'Phase 4 perf: 미매칭 목록 (match_status=unmatched, active)';
COMMENT ON INDEX idx_agent_actions_status_created IS
  'Phase 4 perf: agent-actions GET status 필터 + 정렬';
COMMENT ON INDEX idx_agent_actions_created_desc IS
  'Phase 4 perf: agent-actions 전체 목록 정렬';
COMMENT ON INDEX idx_bookings_departure_status IS
  'Phase 4 perf: getDashboardStats 월별 예약 조회';
COMMENT ON INDEX idx_bookings_departure_range_status IS
  'Phase 4 perf: D-7 잔금미납 departure_date 범위 조회';
COMMENT ON INDEX idx_bookings_active_month IS
  'Phase 4 perf: 진행 예약 건수 월별 집계';
COMMENT ON INDEX idx_capital_entries_entry_date IS
  'Phase 4 perf: capital GET entry_date 정렬';
COMMENT ON INDEX idx_pkg_review_digest_package_id IS
  'Phase 4 perf: review-digest package_id 조회';
COMMENT ON INDEX idx_travel_packages_pending_created IS
  'Phase 4 perf: 어드민 승인대기 목록';
COMMENT ON INDEX idx_agent_actions_agent_type_status IS
  'Phase 4 perf: agent-actions agent_type + status 복합 필터';
