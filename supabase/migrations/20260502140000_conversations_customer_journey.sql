-- 고객 여정(대화 기반 자동화 단계) — 자비스/채팅 테스트·추후 워크플로 연동용 JSON 스냅샷

BEGIN;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS journey JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN conversations.journey IS
  '고객 여정 스냅샷: stage, checklist_preview, automation_hints, updated_at 등 — 예약/준비물/정산 자동화 파이프 연결 전제';

COMMIT;
