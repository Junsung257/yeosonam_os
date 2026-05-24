-- ============================================================
-- Social Publishing — content_distributions 확장 + platform configs
-- 마이그레이션: 20260524013400
-- ============================================================

BEGIN;

-- ── 1. content_distributions 확장 ─────────────────────────────────────────
-- 기존: external_id, external_url, published_at, scheduled_for, status 있음
-- 신규 추가: retry_count, max_retries, error_message (+ scheduled_at alias는 미사용)

ALTER TABLE content_distributions
  ADD COLUMN IF NOT EXISTS retry_count  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries   INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

COMMENT ON COLUMN content_distributions.retry_count   IS '발행 재시도 횟수';
COMMENT ON COLUMN content_distributions.max_retries    IS '최대 재시도 허용 횟수 (기본 3)';
COMMENT ON COLUMN content_distributions.error_message  IS '마지막 발행 실패 에러 메시지';

-- approved 상태 추가 (어드민 검토 완료 → 발행 대기)
ALTER TABLE content_distributions
  DROP CONSTRAINT IF EXISTS content_distributions_status_check;

ALTER TABLE content_distributions
  ADD CONSTRAINT content_distributions_status_check
    CHECK (status IN ('draft','approved','scheduled','published','archived','failed'));

-- ── 2. 소셜 플랫폼 설정 ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS social_platform_configs (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  platform          TEXT NOT NULL UNIQUE
    CHECK (platform IN ('instagram', 'facebook', 'threads', 'twitter', 'naver_cafe')),
  enabled           BOOLEAN DEFAULT false,
  account_id        TEXT,
  access_token      TEXT,  -- ⚠️ 평문 저장. Phase 2에서 Vault/pgcrypto 암호화 권장
  token_expires_at  TIMESTAMPTZ,
  default_post_type TEXT DEFAULT 'image',
  daily_post_limit  INTEGER DEFAULT 3,
  posts_today       INTEGER DEFAULT 0,
  last_post_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE  social_platform_configs IS '소셜 미디어 플랫폼별 발행 설정 (OAuth 계정·한도)';
COMMENT ON COLUMN social_platform_configs.posts_today IS '오늘 발행한 횟수 (UTC, daily cron으로 리셋 필요)';

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_social_platform_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_spc_updated_at ON social_platform_configs;
CREATE TRIGGER trg_spc_updated_at
  BEFORE UPDATE ON social_platform_configs
  FOR EACH ROW EXECUTE FUNCTION update_social_platform_configs_updated_at();

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_spc_platform ON social_platform_configs(platform);
CREATE INDEX IF NOT EXISTS idx_spc_enabled ON social_platform_configs(enabled)
  WHERE enabled = true;

-- ── 3. 기본 시드 ──────────────────────────────────────────────────────────

INSERT INTO social_platform_configs (platform, enabled) VALUES
  ('instagram',  false),
  ('facebook',   false),
  ('threads',    false),
  ('twitter',    false),
  ('naver_cafe', false)
ON CONFLICT (platform) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
