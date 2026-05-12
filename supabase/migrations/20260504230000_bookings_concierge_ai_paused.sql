-- 예약 포털 채팅: 상담 직원 모드 시 AI 자동 답변 비활성화

BEGIN;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS concierge_ai_paused BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN bookings.concierge_ai_paused IS
  'true면 /trip 포털 채팅에서 AI 자동 답변을 보내지 않고 staff 메시지만 기대. 어드민에서 토글.';

COMMIT;
