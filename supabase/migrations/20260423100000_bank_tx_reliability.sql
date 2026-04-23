-- =============================================================
-- 여소남 OS — Bank Transaction 신뢰성 강화 마이그레이션
-- =============================================================
-- 목적:
--   1. Slack Raw Events 보존 (Outbox 패턴 — 파싱 실패해도 원문은 반드시 산다)
--   2. Customer Aliases 학습 (입금자명 ↔ 고객 매핑을 점점 똑똑하게)
--   3. bank_transactions에 감사(audit) 필드 추가 (어느 경로로 들어왔는지 추적)
--   4. 누락 없는 처리를 위한 모니터링 뷰
--
-- 주의:
--   - 기존 message_logs는 slack webhook이 더 이상 DLQ로 사용하지 않음
--     (slack_raw_events가 완전히 대체). 따라서 message_logs 스키마 건드리지 않음.
--
-- 원칙:
--   - 모든 기존 데이터 보존. IF NOT EXISTS 로 멱등성 확보
--   - ENUM 추가만 하고 제거 안함
--   - FK 변경 없음
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- [1] slack_raw_events: Outbox 원문 보관소 (파싱 실패해도 절대 사라지지 않음)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slack_raw_events (
  -- Slack이 보장하는 유일 식별자 2종을 복합 가드로 사용
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Slack event_id (webhook 경로)
  event_id TEXT UNIQUE,

  -- Slack channel + ts (conversations.history 경로 — gap-fill 크론이 사용)
  channel_id TEXT,
  message_ts TEXT,

  -- 원문 페이로드 (재파싱 가능)
  raw_payload JSONB NOT NULL,
  extracted_text TEXT NOT NULL,                       -- deepExtractText + unescape 결과

  -- 수신 소스 추적
  source TEXT NOT NULL DEFAULT 'webhook'
    CHECK (source IN ('webhook', 'gap_fill', 'manual_replay')),

  -- 처리 상태 기계
  parse_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (parse_status IN ('pending', 'parsed', 'failed', 'dead', 'ignored')),
  parse_attempts INTEGER NOT NULL DEFAULT 0,
  last_parse_error TEXT,

  -- 이 원문에서 생성된 bank_transactions 개수 (0건 = 파싱 실패)
  parsed_tx_count INTEGER NOT NULL DEFAULT 0,

  -- 타임스탬프
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  parsed_at TIMESTAMPTZ,
  slack_message_at TIMESTAMPTZ,                       -- Slack ts를 파싱해 넣은 시각

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- (channel_id, message_ts) 복합 UNIQUE — gap-fill 크론의 dedupe 키
CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_raw_channel_ts
  ON slack_raw_events (channel_id, message_ts)
  WHERE channel_id IS NOT NULL AND message_ts IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_slack_raw_status
  ON slack_raw_events (parse_status);

CREATE INDEX IF NOT EXISTS idx_slack_raw_received
  ON slack_raw_events (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_slack_raw_failed_retry
  ON slack_raw_events (parse_status, parse_attempts)
  WHERE parse_status = 'failed';

-- updated_at 트리거 (bank_transactions와 동일 함수 재사용)
DROP TRIGGER IF EXISTS trg_slack_raw_updated_at ON slack_raw_events;
CREATE TRIGGER trg_slack_raw_updated_at
  BEFORE UPDATE ON slack_raw_events
  FOR EACH ROW EXECUTE FUNCTION update_bank_tx_timestamp();

ALTER TABLE slack_raw_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON slack_raw_events;
CREATE POLICY "authenticated_access" ON slack_raw_events
  FOR ALL TO authenticated USING (true);


-- ─────────────────────────────────────────────────────────────
-- [2] customer_aliases: 입금자명 ↔ 고객 매핑 학습
-- ─────────────────────────────────────────────────────────────
-- 예: 은행 계좌명이 "LEE MIKYUNG"인데 고객명이 "이미경"일 때
-- 한 번 매칭에 성공하면 다음부터 신뢰도 가중치 +0.3
CREATE TABLE IF NOT EXISTS customer_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,                                -- 정규화 전 원문 (예: "이미경")
  normalized_alias TEXT NOT NULL,                     -- normalizeName() 결과 (공백·특수문자 제거)
  source TEXT NOT NULL DEFAULT 'manual_match'
    CHECK (source IN ('manual_match', 'auto_match', 'admin_added')),
  confidence_boost FLOAT NOT NULL DEFAULT 0.3,        -- 매칭 시 추가 가중치 (0.0 ~ 0.5)
  usage_count INTEGER NOT NULL DEFAULT 1,             -- 이 alias로 매칭된 횟수
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 같은 alias가 같은 고객에 중복 등록되지 않도록
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_alias_normalized
  ON customer_aliases (customer_id, normalized_alias);

CREATE INDEX IF NOT EXISTS idx_customer_aliases_normalized
  ON customer_aliases (normalized_alias);

CREATE INDEX IF NOT EXISTS idx_customer_aliases_customer
  ON customer_aliases (customer_id);

ALTER TABLE customer_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_access" ON customer_aliases;
CREATE POLICY "authenticated_access" ON customer_aliases
  FOR ALL TO authenticated USING (true);


-- ─────────────────────────────────────────────────────────────
-- [3] bank_transactions: 감사 필드 추가 (누락 추적)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'slack_webhook'
    CHECK (source IN ('slack_webhook', 'slack_gap_fill', 'bulk_import', 'manual', 'dlq_replay')),
  ADD COLUMN IF NOT EXISTS raw_event_id UUID REFERENCES slack_raw_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'excluded')),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bank_tx_source ON bank_transactions (source);
CREATE INDEX IF NOT EXISTS idx_bank_tx_raw_event ON bank_transactions (raw_event_id);

-- 'error' match_status 허용 — 기존 CHECK 제약에 추가
ALTER TABLE bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_match_status_check;

ALTER TABLE bank_transactions
  ADD CONSTRAINT bank_transactions_match_status_check
  CHECK (match_status IN ('auto', 'review', 'unmatched', 'manual', 'error'));


-- ─────────────────────────────────────────────────────────────
-- [4] 모니터링 뷰 — 누락 의심 상황 즉시 감지
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW bank_tx_health AS
SELECT
  -- 최근 수신 내역 (영업시간 무음 감지용)
  (SELECT MAX(received_at) FROM slack_raw_events)                     AS last_slack_event_at,
  (SELECT MAX(received_at) FROM bank_transactions)                    AS last_bank_tx_at,

  -- 미처리 원문
  (SELECT COUNT(*) FROM slack_raw_events WHERE parse_status = 'pending')  AS pending_raw_events,
  (SELECT COUNT(*) FROM slack_raw_events WHERE parse_status = 'failed')   AS failed_raw_events,
  (SELECT COUNT(*) FROM slack_raw_events WHERE parse_status = 'dead')     AS dead_raw_events,

  -- 매칭 상태별 집계
  (SELECT COUNT(*) FROM bank_transactions WHERE match_status = 'unmatched' AND status = 'active') AS unmatched_count,
  (SELECT COUNT(*) FROM bank_transactions WHERE match_status = 'review' AND status = 'active')    AS review_count,
  (SELECT COUNT(*) FROM bank_transactions WHERE match_status = 'error' AND status = 'active')     AS error_count,

  -- 24h 이상 미처리된 검토/미매칭 (경고 대상)
  (SELECT COUNT(*) FROM bank_transactions
    WHERE match_status IN ('unmatched', 'review', 'error')
      AND status = 'active'
      AND created_at < NOW() - INTERVAL '24 hours')                   AS stale_over_24h;


-- ─────────────────────────────────────────────────────────────
-- [5] RPC: 24h 경과 stale 레코드 조회 (push notification / slack alert 용)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_stale_bank_transactions(hours INT DEFAULT 24)
RETURNS TABLE (
  id UUID,
  match_status TEXT,
  counterparty_name TEXT,
  amount INTEGER,
  received_at TIMESTAMPTZ,
  hours_stale NUMERIC
) AS $$
  SELECT
    id,
    match_status,
    counterparty_name,
    amount,
    received_at,
    EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS hours_stale
  FROM bank_transactions
  WHERE match_status IN ('unmatched', 'review', 'error')
    AND status = 'active'
    AND created_at < NOW() - (hours || ' hours')::INTERVAL
  ORDER BY created_at ASC;
$$ LANGUAGE SQL STABLE;


-- ─────────────────────────────────────────────────────────────
-- 마이그레이션 완료 로그
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '[bank-tx-reliability] 마이그레이션 완료: slack_raw_events, customer_aliases, 감사 필드, 모니터링 뷰';
END $$;
