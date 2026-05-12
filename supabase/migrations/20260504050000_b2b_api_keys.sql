-- =============================================================
-- 여소남 OS — Phase 2-G: B2B API Out (도매 공급 API)
-- =============================================================
-- 목적:
--   여소남 패키지를 외부 대리점이 가져다 팔 수 있는 API 키 관리.
--   raw key는 절대 저장하지 않으며 SHA-256 hash만 보관.
-- =============================================================

CREATE TABLE IF NOT EXISTS b2b_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash TEXT NOT NULL UNIQUE,       -- SHA-256 of raw key, never store raw
  label TEXT NOT NULL,                 -- 발급 목적 (예: "○○여행사 연동")
  is_active BOOLEAN NOT NULL DEFAULT true,
  rate_limit_per_hour INT NOT NULL DEFAULT 100,
  allowed_ips TEXT[],                  -- NULL = 모든 IP 허용
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ DEFAULT NULL,
  total_calls INT NOT NULL DEFAULT 0
);

COMMENT ON TABLE b2b_api_keys IS 'B2B 도매 API 접근 키. raw key는 저장 안 함 (hash만). Authorization: Bearer {raw_key} 로 인증';
COMMENT ON COLUMN b2b_api_keys.key_hash IS 'SHA-256(raw_key) hex digest. 인증 시 요청 키를 hash 후 대조';
COMMENT ON COLUMN b2b_api_keys.label IS '키 발급 목적 및 대리점 식별자 (예: "○○여행사 연동")';
COMMENT ON COLUMN b2b_api_keys.rate_limit_per_hour IS '시간당 최대 API 호출 수';
COMMENT ON COLUMN b2b_api_keys.allowed_ips IS 'IP 화이트리스트. NULL이면 모든 IP 허용';
COMMENT ON COLUMN b2b_api_keys.total_calls IS '누적 API 호출 수. 인증 성공 시 1씩 증가';

-- 활성 키 조회 최적화
CREATE INDEX IF NOT EXISTS idx_b2b_api_keys_hash_active
  ON b2b_api_keys(key_hash)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_b2b_api_keys_created_at
  ON b2b_api_keys(created_at DESC);

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '[b2b-api-keys] b2b_api_keys 테이블 생성 완료';
END $$;
