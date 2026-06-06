-- =============================================================
-- 여소남 OS — bank_transactions SMS 직접 수신 출처 허용
-- =============================================================
-- Claude/Slack 중계가 끊겨도 Android SMS 웹훅에서 같은 송금내역 원장으로
-- 바로 저장할 수 있게 bank_transactions.source 에 sms_webhook 을 추가한다.

ALTER TABLE bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_source_check;

ALTER TABLE bank_transactions
  ADD CONSTRAINT bank_transactions_source_check
  CHECK (source IN (
    'slack_webhook',
    'slack_gap_fill',
    'bulk_import',
    'manual',
    'dlq_replay',
    'sms_webhook'
  ));

COMMENT ON CONSTRAINT bank_transactions_source_check ON bank_transactions
  IS '송금내역 수신 출처. sms_webhook은 Android SMS 직접 수신 경로.';
