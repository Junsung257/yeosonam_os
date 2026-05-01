-- =============================================================
-- 여소남 OS — Phase 2a: ledger_entries RLS + RPC EXECUTE 권한 정리
-- =============================================================
-- 목적:
--   1) ledger_entries 테이블 RLS 활성화 — 실제 돈 데이터, anon/authenticated 키
--      가 노출되어도 전체 원장이 새지 않도록 service_role-only 정책.
--   2) Phase 2a 에서 만든 RPC 들의 EXECUTE 권한을 service_role 로만 제한.
--      기본 PUBLIC 권한은 차단 (anon/authenticated 가 직접 호출 못함).
--
-- 어드민 UI 는 supabaseAdmin (service_role key) 으로 호출하므로 정상 동작.
-- 클라이언트 측에서 anon key 로 호출하던 경우는 없음 (전수 grep 검증).
-- =============================================================

-- ─── [1] ledger_entries RLS ──────────────────────────────────

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;

-- 기존 동명 정책 정리 (재실행 안전)
DROP POLICY IF EXISTS ledger_entries_service_role_only ON ledger_entries;

-- service_role 만 select / insert / update / delete (RULE 로 update/delete 는 어차피 NOTHING)
CREATE POLICY ledger_entries_service_role_only ON ledger_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY ledger_entries_service_role_only ON ledger_entries IS
  'Phase 2a — service_role 만 ledger 접근 가능. anon/authenticated 키는 RLS 로 0행 응답.';

-- ─── [2] RPC EXECUTE 권한 정리 ────────────────────────────────

DO $$
DECLARE
  fn TEXT;
  funcs TEXT[] := ARRAY[
    'record_ledger_entry(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT)',
    'update_booking_ledger(UUID, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT)',
    'confirm_payment_match(UUID, UUID, NUMERIC, TEXT)',
    'create_land_settlement(UUID, UUID, JSONB, TEXT, BOOLEAN, TEXT, INT)',
    'reverse_land_settlement(UUID, TEXT, TEXT)',
    'record_manual_paid_amount_change(UUID, INT, INT, TEXT, TEXT, TEXT, TEXT, TEXT)',
    'seed_ledger_from_current_balances()',
    'reconcile_ledger()',
    'resync_paid_amounts_with_ledger()'
  ];
BEGIN
  FOREACH fn IN ARRAY funcs LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE '[grant-cleanup] 함수 없음 (skip): %', fn;
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
