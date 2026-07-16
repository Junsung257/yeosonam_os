-- The Phase 2a implementation replaces the legacy three-argument RPC with an
-- eight-argument, default-compatible implementation. PostgreSQL otherwise
-- keeps both overloads, making unqualified calls and COMMENT statements
-- ambiguous.
DROP FUNCTION IF EXISTS public.update_booking_ledger(UUID, INTEGER, INTEGER);
