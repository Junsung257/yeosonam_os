-- =============================================================
-- 여소남 OS — Booking Tasks (Inbox Zero Action Queue) 마이그레이션
-- =============================================================
-- 목적:
--   "상태(Status) 나열" → "행동(Action) 큐" 로의 UI/UX 패러다임 전환 지원.
--   예약 도메인의 예외 상황(미수금/마진폭락/클레임/입금미매칭 등)을
--   자동 감지하여 운영자의 Inbox에 카드로 띄우고, 조건 해소 시 시스템이
--   스스로 종결(auto_resolve)하는 Task Queue 인프라.
--
-- 해결하는 시나리오:
--   1. Alert Fatigue: 고객이 자발적으로 입금하면 "잔금 미수" Task는
--      다음 크론 런에서 자동으로 auto_resolved 처리 (evaluateStale)
--   2. 알람 지옥: 한번 해결한 Task가 다음날 똑같이 재생성되는 문제를
--      - (a) fingerprint UNIQUE 로 같은 날 중복 INSERT 차단
--      - (b) cooldownDays 로 N일간 재감지 차단 (runner 레이어)
--      - (c) 활성(open+snoozed) 유니크 인덱스 로 동시 중복 차단
--      3중 방어로 해결
--   3. 예약 취소 연쇄: bookings.status='cancelled' 전이 시
--      supersede_booking_tasks(booking_id) RPC로 관련 Task 일괄 종결
--   4. Snooze: 운영자가 "내일 다시" 버튼 → snoozed_until 업데이트
--      → wake_snoozed_tasks() RPC 로 만기 도래 시 open 으로 복귀
--
-- 원칙 (기존 마이그레이션 관례 준수):
--   - 모든 기존 데이터 보존. IF NOT EXISTS 로 멱등성 확보
--   - 새 테이블/RPC 추가만. 기존 스키마 건드리지 않음
--   - RLS 활성화 + authenticated_access 정책 (bank_tx / slack_raw 와 동일)
--   - updated_at 트리거는 update_bank_tx_timestamp() 재사용
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- [1] booking_tasks: 예약 도메인 액션 큐
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,

  -- 룰 식별자 (TEXT 로 두어 새 룰 추가 시 스키마 변경 불필요)
  --   예: 'unpaid_balance_d7' | 'unmatched_deposit' | 'low_margin'
  --       'claim_keyword_reply' | 'doc_missing_d3' | 'happy_call_followup'
  task_type     TEXT NOT NULL,

  -- 우선순위 (0=urgent 1=high 2=normal 3=low)
  priority      SMALLINT NOT NULL DEFAULT 2
    CHECK (priority BETWEEN 0 AND 3),

  -- UI에 그대로 노출되는 1줄 요약
  title         TEXT NOT NULL,

  -- 감지 당시 스냅샷 (금액/마진율/D-N/문구 인용 등)
  -- UI 배지/상세/디버깅 모두 이 JSON에서 파생
  context       JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- 5-state 상태 머신
  --   open          : 현재 처리 필요
  --   snoozed       : 운영자가 보류. snoozed_until 도래 시 open 복귀
  --   resolved      : 운영자가 수동 종결
  --   auto_resolved : 조건 해소 감지로 시스템이 자동 종결
  --   superseded    : 예약이 취소되어 더 이상 유효하지 않음
  status        TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'snoozed', 'resolved', 'auto_resolved', 'superseded')),

  -- 보류 만기 (status='snoozed' 일 때만 의미 있음)
  snoozed_until TIMESTAMPTZ,

  -- 자동 종결 사유 (status='auto_resolved' 일 때만 세팅)
  --   예: 'balance_paid' | 'booking_cancelled' | 'margin_recovered'
  auto_resolve_reason TEXT,

  -- 멱등성 키: 같은 크론이 하루에 2회 돌아도 중복 INSERT 안 되도록.
  -- 보통 md5(booking_id || task_type || YYYYMMDD) 로 생성하지만
  -- 룰이 자유롭게 정의 가능 (예: 해시 내에 week_bucket 포함 등)
  fingerprint   TEXT NOT NULL,

  -- 담당자 (현재는 null=전사 공유. 직원 도입 시 'user:<id>' 로 채움)
  assigned_to   TEXT,

  -- 감사 (누가 만들고 누가 닫았는지)
  created_by    TEXT NOT NULL,                -- 'system:rule:{rule_id}' | 'user:<id>'
  resolved_at   TIMESTAMPTZ,
  resolved_by   TEXT,                         -- 'user:<id>' | 'system:evaluate_stale' | 'system:supersede'
  resolution    TEXT,                         -- 'sent_reminder' | 'waived' | 'auto' | 'cancelled_booking'

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- [2] 인덱스 (조회 핫패스 + 중복 방지)
-- ─────────────────────────────────────────────────────────────

-- (a) 활성 상태(open + snoozed)일 때 같은 (booking, type) 중복 금지
--     → 같은 예약에 "unpaid_balance_d7" open 카드가 2개 생기는 것 방지
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_tasks_active
  ON booking_tasks (booking_id, task_type)
  WHERE status IN ('open', 'snoozed');

-- (b) 멱등성: 같은 fingerprint 는 전체 테이블에서 유일
--     → 크론 2회 실행 시 같은 날 같은 Task 재생성 방지
--     (resolved 후 cooldown 기간이 지나면 fingerprint 가 달라지므로 허용)
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_tasks_fingerprint
  ON booking_tasks (fingerprint);

-- (c) Cooldown 조회 핫패스: (booking, type) 별 가장 최근 resolved 시각
CREATE INDEX IF NOT EXISTS idx_booking_tasks_cooldown
  ON booking_tasks (booking_id, task_type, resolved_at DESC)
  WHERE resolved_at IS NOT NULL;

-- (d) Inbox 목록 쿼리 (우선순위 asc → 최신 desc)
CREATE INDEX IF NOT EXISTS idx_booking_tasks_inbox
  ON booking_tasks (priority, created_at DESC)
  WHERE status = 'open';

-- (e) Snooze 만기 스캔 (크론 wake)
CREATE INDEX IF NOT EXISTS idx_booking_tasks_snooze_wake
  ON booking_tasks (snoozed_until)
  WHERE status = 'snoozed';

-- (f) 룰별 evaluateStale 스캔용 (task_type 으로 open 만 빠르게)
CREATE INDEX IF NOT EXISTS idx_booking_tasks_by_type_open
  ON booking_tasks (task_type, booking_id)
  WHERE status = 'open';

-- (g) 예약별 최근 Task (드로어에서 "이 예약의 과거 Task 이력" 표시용)
CREATE INDEX IF NOT EXISTS idx_booking_tasks_by_booking
  ON booking_tasks (booking_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- [3] updated_at 트리거 (bank_tx 와 동일 함수 재사용)
-- ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_booking_tasks_updated_at ON booking_tasks;
CREATE TRIGGER trg_booking_tasks_updated_at
  BEFORE UPDATE ON booking_tasks
  FOR EACH ROW EXECUTE FUNCTION update_bank_tx_timestamp();

-- ─────────────────────────────────────────────────────────────
-- [4] RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE booking_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON booking_tasks;
CREATE POLICY "authenticated_access" ON booking_tasks
  FOR ALL TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────
-- [5] 모니터링 뷰 — bank_tx_health 스타일
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW booking_tasks_health AS
SELECT
  COUNT(*) FILTER (WHERE status = 'open' AND priority = 0)                        AS urgent_open,
  COUNT(*) FILTER (WHERE status = 'open' AND priority = 1)                        AS high_open,
  COUNT(*) FILTER (WHERE status = 'open' AND priority = 2)                        AS normal_open,
  COUNT(*) FILTER (WHERE status = 'open' AND priority = 3)                        AS low_open,
  COUNT(*) FILTER (WHERE status = 'open')                                         AS total_open,
  COUNT(*) FILTER (WHERE status = 'snoozed')                                      AS snoozed_count,
  COUNT(*) FILTER (WHERE status = 'open'
    AND created_at < NOW() - INTERVAL '48 hours')                                 AS stale_over_48h,
  COUNT(*) FILTER (WHERE status = 'auto_resolved'
    AND resolved_at > NOW() - INTERVAL '24 hours')                                AS auto_resolved_last_24h,
  COUNT(*) FILTER (WHERE status = 'resolved'
    AND resolved_at > NOW() - INTERVAL '24 hours')                                AS manually_resolved_last_24h,
  (SELECT MAX(created_at) FROM booking_tasks)                                     AS last_task_at
FROM booking_tasks;

-- ─────────────────────────────────────────────────────────────
-- [6] RPC: wake_snoozed_tasks — Snooze 만기 일괄 깨우기
-- ─────────────────────────────────────────────────────────────
-- 호출처: cron/booking-tasks-runner 가 매 실행마다 최초 단계에서 호출
-- 반환: 깨어난 레코드 수
CREATE OR REPLACE FUNCTION wake_snoozed_tasks()
RETURNS INT
LANGUAGE SQL
AS $$
  WITH woken AS (
    UPDATE booking_tasks
    SET status        = 'open',
        snoozed_until = NULL,
        updated_at    = NOW()
    WHERE status = 'snoozed'
      AND snoozed_until IS NOT NULL
      AND snoozed_until <= NOW()
    RETURNING 1
  )
  SELECT COUNT(*)::INT FROM woken;
$$;

-- ─────────────────────────────────────────────────────────────
-- [7] RPC: supersede_booking_tasks — 예약 취소 시 연쇄 종결
-- ─────────────────────────────────────────────────────────────
-- 호출처: /api/bookings/[id]/cancel 성공 시, 예약 상태 전이 훅
-- 반환: 종결된 레코드 수
CREATE OR REPLACE FUNCTION supersede_booking_tasks(
  p_booking_id UUID,
  p_reason     TEXT DEFAULT 'booking_cancelled'
)
RETURNS INT
LANGUAGE SQL
AS $$
  WITH updated AS (
    UPDATE booking_tasks
    SET status              = 'superseded',
        resolved_at         = NOW(),
        resolved_by         = 'system:supersede',
        resolution          = p_reason,
        auto_resolve_reason = p_reason,
        updated_at          = NOW()
    WHERE booking_id = p_booking_id
      AND status IN ('open', 'snoozed')
    RETURNING 1
  )
  SELECT COUNT(*)::INT FROM updated;
$$;

-- ─────────────────────────────────────────────────────────────
-- [8] RPC: resolve_booking_task — 운영자 "완료" 버튼
-- ─────────────────────────────────────────────────────────────
-- 호출처: /api/admin/tasks/[id]/resolve
-- status='resolved' 로 전이하며 resolved_at/by/resolution 세팅
CREATE OR REPLACE FUNCTION resolve_booking_task(
  p_task_id    UUID,
  p_resolved_by TEXT,
  p_resolution TEXT DEFAULT 'manual'
)
RETURNS booking_tasks
LANGUAGE plpgsql
AS $$
DECLARE
  v_row booking_tasks;
BEGIN
  UPDATE booking_tasks
  SET status      = 'resolved',
      resolved_at = NOW(),
      resolved_by = p_resolved_by,
      resolution  = p_resolution,
      updated_at  = NOW()
  WHERE id = p_task_id
    AND status IN ('open', 'snoozed')
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- [9] RPC: snooze_booking_task — "내일 다시" 버튼
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION snooze_booking_task(
  p_task_id       UUID,
  p_snoozed_until TIMESTAMPTZ,
  p_actor         TEXT
)
RETURNS booking_tasks
LANGUAGE plpgsql
AS $$
DECLARE
  v_row booking_tasks;
BEGIN
  UPDATE booking_tasks
  SET status        = 'snoozed',
      snoozed_until = p_snoozed_until,
      resolved_by   = p_actor,           -- 누가 snooze 시켰는지 추적 (resolved_at 은 NULL 유지)
      updated_at    = NOW()
  WHERE id = p_task_id
    AND status = 'open'
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- [10] RPC: get_inbox_tasks — 페이지네이션 포함 Inbox 조회
-- ─────────────────────────────────────────────────────────────
-- 프런트에서 복잡한 조인 없이 한 번에 필요한 데이터 가져가도록 View 형태 제공
-- booking 정보까지 JOIN 해서 UI 렌더링에 필요한 최소 필드 제공
CREATE OR REPLACE FUNCTION get_inbox_tasks(
  p_priority_max SMALLINT DEFAULT 3,   -- 3까지 = 전체
  p_limit        INT      DEFAULT 100,
  p_offset       INT      DEFAULT 0
)
RETURNS TABLE (
  id                UUID,
  booking_id        UUID,
  booking_no        TEXT,
  package_title     TEXT,
  customer_name     TEXT,
  departure_date    DATE,
  task_type         TEXT,
  priority          SMALLINT,
  title             TEXT,
  context           JSONB,
  status            TEXT,
  created_at        TIMESTAMPTZ,
  snoozed_until     TIMESTAMPTZ
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    t.id,
    t.booking_id,
    b.booking_no::TEXT,
    b.package_title::TEXT,
    c.name::TEXT               AS customer_name,
    b.departure_date,
    t.task_type,
    t.priority,
    t.title,
    t.context,
    t.status,
    t.created_at,
    t.snoozed_until
  FROM booking_tasks t
  LEFT JOIN bookings  b ON b.id = t.booking_id
  LEFT JOIN customers c ON c.id = b.lead_customer_id
  WHERE t.status = 'open'
    AND t.priority <= p_priority_max
  ORDER BY t.priority ASC, t.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

-- ─────────────────────────────────────────────────────────────
-- [11] RPC: get_recent_resolved_task — Cooldown 체크 헬퍼
-- ─────────────────────────────────────────────────────────────
-- 러너(runner.ts)에서 cooldown 검사 시 호출
-- 같은 (booking, type) 조합으로 최근 N일 내에 resolved/auto_resolved 된 건이
-- 있는지 확인. 있으면 새 detect 결과를 skip
CREATE OR REPLACE FUNCTION get_recent_resolved_task(
  p_booking_id UUID,
  p_task_type  TEXT,
  p_since      TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE SQL STABLE
AS $$
  SELECT resolved_at
  FROM booking_tasks
  WHERE booking_id = p_booking_id
    AND task_type  = p_task_type
    AND resolved_at IS NOT NULL
    AND resolved_at >= p_since
    AND status IN ('resolved', 'auto_resolved', 'superseded')
  ORDER BY resolved_at DESC
  LIMIT 1;
$$;

-- ─────────────────────────────────────────────────────────────
-- 마이그레이션 완료 로그
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '[booking-tasks] 마이그레이션 완료: Inbox Zero 액션 큐 + 5 RPCs (wake/supersede/resolve/snooze/get_inbox/get_recent_resolved) + 헬스 뷰';
END $$;
