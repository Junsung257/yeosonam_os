-- V2 §B.2.1 — P0 테이블에 tenant_id 컬럼 추가 (nullable 로 시작)
--
-- 전략:
-- 1) 컬럼 추가 (nullable)               ← 이 파일
-- 2) 애플리케이션에서 신규 row 는 tenant_id 채움
-- 3) 데이터 백필 스크립트 실행          ← 운영 단계, 별도 PR
-- 4) NOT NULL 승격 + RLS 활성화         ← Phase 3d
--
-- 안전성:
-- - DO 블록 + information_schema 체크로 없는 테이블은 자동 스킵
--   (여소남 OS 의 Supabase 환경마다 일부 테이블 이름이 다르거나 없을 수 있음)
-- - 기존 tenant_id 있는 테이블 (saas_marketplace_v1.sql 등) 은 IF NOT EXISTS 로 멱등 처리
-- - 실측 42P01 'relation payments does not exist' 대응

DO $$
DECLARE
  t TEXT;
  target_tables TEXT[] := ARRAY[
    'bookings','customers','payments','bank_transactions','message_logs',
    'settlements','jarvis_sessions','jarvis_tool_logs','jarvis_pending_actions',
    'agent_actions'
  ];
  added INT := 0;
  skipped INT := 0;
BEGIN
  FOREACH t IN ARRAY target_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = t AND table_schema = 'public'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL',
        t
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_%s_tenant ON %I(tenant_id)',
        t, t
      );
      RAISE NOTICE '✅ Added tenant_id to %', t;
      added := added + 1;
    ELSE
      RAISE NOTICE '⏭  Skipped (table not exists): %', t;
      skipped := skipped + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '━━━ 완료: % 테이블에 추가, % 테이블 스킵 ━━━', added, skipped;
END $$;

-- bookings 가 있는 경우에만 코멘트 추가 (조건부)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bookings' AND table_schema = 'public') THEN
    EXECUTE 'COMMENT ON COLUMN bookings.tenant_id IS ''테넌트 격리용. NULL = 여소남 본사. 마이그레이션 완료 후 NOT NULL 승격 예정.''';
  END IF;
END $$;
