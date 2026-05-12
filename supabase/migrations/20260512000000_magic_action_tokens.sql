-- 매직링크 통합 SSOT (S1)
-- 기존 booking_guest_tokens / guidebook_token 은 백워드 호환 유지하되,
-- 신규 액션(잔금결제·동의·여권업로드·리뷰·동반자·자비스세션)은 이 테이블로 일원화.
--
-- 핵심 결정:
--   1. POST-confirm 패턴 디폴트 (Outlook SafeLinks / Slackbot prefetch burn 방지)
--   2. 토큰 원문은 DB 미저장 — SHA-256 hash 만
--   3. recipient (전화·이메일) 도 SHA-256 으로 PII 최소화
--   4. 감사 로그는 매 이벤트(mint/confirm/consume/expire/revoke/verify_fail/rate_limited)
--   5. RLS: service_role 만 접근, 앱 코드는 supabaseAdmin 경유

BEGIN;

-- ── action_type ENUM (확장 가능) ────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE magic_action_type AS ENUM (
    'booking_portal',        -- 예약 요약/상태 조회 (booking_guest_tokens 와 중복 허용)
    'guidebook',             -- 가이드북 (기존 guidebook-token JWT 와 병행)
    'payment_balance',       -- S2: 잔금 결제
    'itinerary_consent',     -- S3: 일정 변경 동의
    'passport_upload',       -- S4: 여권/APIS 데이터 업로드
    'review_request',        -- S3: 리뷰·사진 업로드
    'companion_input',       -- S5: 동반자 self-input fan-out
    'jarvis_session'         -- 자비스 채팅 게스트 진입 전용
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE magic_recipient_channel AS ENUM (
    'sms','email','alimtalk','friend_talk','kakao_channel','manual_share'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 통합 토큰 테이블 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS magic_action_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash       TEXT NOT NULL,
  action_type      magic_action_type NOT NULL,

  -- 컨텍스트 (action_type 별로 어떤 컬럼 채울지 다름)
  booking_id       UUID REFERENCES bookings(id) ON DELETE CASCADE,
  tenant_id        UUID,
  customer_id      UUID REFERENCES customers(id) ON DELETE SET NULL,
  metadata         JSONB NOT NULL DEFAULT '{}',

  -- 발송 채널 (감사·재발송용)
  recipient_channel magic_recipient_channel,
  recipient_hash    TEXT,  -- SHA-256(phone or email) — PII 최소화

  -- 정책
  single_use       BOOLEAN NOT NULL DEFAULT true,
  expires_at       TIMESTAMPTZ NOT NULL,

  -- POST-confirm 게이트 (AV/SafeLinks burn 방지)
  confirm_required BOOLEAN NOT NULL DEFAULT true,
  confirmed_at     TIMESTAMPTZ,

  -- 라이프사이클
  used_at          TIMESTAMPTZ,
  use_count        INT NOT NULL DEFAULT 0,
  revoked_at       TIMESTAMPTZ,
  revoked_reason   TEXT,

  -- 옵션 바인딩
  ua_fingerprint   TEXT,   -- 'sha256:<hex>' 또는 NULL (binding off)

  -- 생성자
  created_by       UUID,   -- admin user id (있다면), 시스템 발급은 NULL
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_magic_action_tokens_hash
  ON magic_action_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_magic_action_tokens_booking
  ON magic_action_tokens (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_magic_action_tokens_tenant_action
  ON magic_action_tokens (tenant_id, action_type, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_magic_action_tokens_recipient
  ON magic_action_tokens (recipient_hash, created_at DESC)
  WHERE recipient_hash IS NOT NULL;

-- single_use 일관성: single_use=true 면 use_count <= 1
ALTER TABLE magic_action_tokens DROP CONSTRAINT IF EXISTS chk_magic_action_tokens_single_use;
ALTER TABLE magic_action_tokens
  ADD CONSTRAINT chk_magic_action_tokens_single_use
  CHECK (NOT single_use OR use_count <= 1);

COMMENT ON TABLE magic_action_tokens IS
  '매직링크 통합 SSOT — POST-confirm 게이트, SHA-256 hash 저장, single_use/reusable 정책 토큰별 분리. 발행처: src/lib/magic-link.ts';
COMMENT ON COLUMN magic_action_tokens.confirm_required IS
  'true 면 첫 클릭에 토큰 소진 X — /m/[token] 페이지에서 사용자가 "확인" 누를 때만 confirmed_at 기록 후 액션 페이지로 이동. SafeLinks/AV 스캐너 burn 방지.';
COMMENT ON COLUMN magic_action_tokens.metadata IS
  'action_type 별 자유 데이터: payment_balance → {amount,currency,due_date}, itinerary_consent → {diff_summary,deadline}, companion_input → {role,profile_id} 등';

-- ── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE magic_action_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "magic_action_tokens service role" ON magic_action_tokens;
CREATE POLICY "magic_action_tokens service role"
  ON magic_action_tokens FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 일반 사용자 직접 접근 금지 (앱 코드는 supabaseAdmin 으로만)
DROP POLICY IF EXISTS "magic_action_tokens deny all anon" ON magic_action_tokens;
CREATE POLICY "magic_action_tokens deny all anon"
  ON magic_action_tokens FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 감사 로그 (Air Canada 방지·법적 증거·운영 모니터링) ───────────────
CREATE TABLE IF NOT EXISTS magic_link_audit (
  id            BIGSERIAL PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  token_id      UUID REFERENCES magic_action_tokens(id) ON DELETE SET NULL,
  action_type   magic_action_type,
  event         TEXT NOT NULL,
  --   'mint'         발급
  --   'confirm'      POST-confirm 클릭
  --   'consume'      액션 실행 (single_use 면 used_at 기록과 함께)
  --   'expire'       만료 감지 (verify 시 expires_at 초과)
  --   'revoke'       강제 폐기
  --   'verify_fail'  해시 불일치 or revoked or 만료
  --   'rate_limited' rate-limiter 차단
  --   'session_issue' magic-session 쿠키 발급
  --   'session_verify_fail' magic-session 쿠키 검증 실패

  ip            TEXT,
  ua            TEXT,
  recipient_hash TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  success       BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_magic_link_audit_token
  ON magic_link_audit (token_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_magic_link_audit_event_time
  ON magic_link_audit (event, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_magic_link_audit_action_time
  ON magic_link_audit (action_type, occurred_at DESC);

COMMENT ON TABLE magic_link_audit IS
  '매직링크 감사 로그 — 발급/사용/실패 전 이벤트 보관. 90일 보존 후 cron 으로 archive. 법적 증거(Air Canada 패턴) 와 abuse 탐지에 사용.';

ALTER TABLE magic_link_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "magic_link_audit service role" ON magic_link_audit;
CREATE POLICY "magic_link_audit service role"
  ON magic_link_audit FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "magic_link_audit deny all anon" ON magic_link_audit;
CREATE POLICY "magic_link_audit deny all anon"
  ON magic_link_audit FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 만료/소진 토큰 정리 RPC (cron 에서 호출) ──────────────────────────
CREATE OR REPLACE FUNCTION cleanup_expired_magic_tokens(retention_days INT DEFAULT 30)
RETURNS TABLE (deleted_tokens BIGINT, archived_audit BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tokens_deleted BIGINT;
  audit_archived BIGINT;
BEGIN
  -- 만료 토큰: expires_at + retention 지난 것만 삭제
  WITH deleted AS (
    DELETE FROM magic_action_tokens
    WHERE expires_at < now() - (retention_days || ' days')::INTERVAL
    RETURNING 1
  )
  SELECT count(*) INTO tokens_deleted FROM deleted;

  -- 감사 로그: 90일 지난 것 삭제 (필요시 별도 archive 테이블로 이관)
  WITH archived AS (
    DELETE FROM magic_link_audit
    WHERE occurred_at < now() - INTERVAL '90 days'
    RETURNING 1
  )
  SELECT count(*) INTO audit_archived FROM archived;

  RETURN QUERY SELECT tokens_deleted, audit_archived;
END;
$$;

REVOKE EXECUTE ON FUNCTION cleanup_expired_magic_tokens(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_expired_magic_tokens(INT) TO service_role;

COMMENT ON FUNCTION cleanup_expired_magic_tokens IS
  '만료 토큰 + 90일 지난 감사 로그 정리. /api/cron/magic-tokens-cleanup 에서 일 1회 호출.';

COMMIT;
