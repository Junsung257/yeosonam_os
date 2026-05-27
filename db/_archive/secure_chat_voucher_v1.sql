-- ============================================================
-- B2B-B2C 안심 중개 채팅 & 여소남 표준 확정서(Voucher) 스키마
-- ============================================================
-- Supabase SQL Editor에서 실행: db/secure_chat_voucher_v1.sql 붙여넣고 Run 클릭

-- ── 1. 안심 중개 채팅 (SecureChat) ────────────────────────────
CREATE TABLE IF NOT EXISTS secure_chats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID REFERENCES bookings(id) ON DELETE CASCADE,
  -- RFQ 채팅의 경우 rfq_id로 연결 (booking_id가 NULL일 수 있음)
  rfq_id          UUID REFERENCES group_rfqs(id) ON DELETE CASCADE,
  sender_type     TEXT NOT NULL CHECK (sender_type IN ('customer', 'land_agency', 'system')),
  sender_id       TEXT NOT NULL,              -- customer_id 또는 tenant_id (UUID string)
  receiver_type   TEXT NOT NULL CHECK (receiver_type IN ('customer', 'land_agency', 'admin')),
  raw_message     TEXT NOT NULL,              -- 원본 메시지 (서버 내부 보관, 고객/랜드사 미노출)
  masked_message  TEXT NOT NULL,              -- 마스킹 처리된 메시지 (상대방 전달용)
  is_filtered     BOOLEAN NOT NULL DEFAULT FALSE,  -- PII 감지 여부
  filter_detail   TEXT,                       -- 감지된 패턴 설명 (로그용)
  -- 마스킹 해제 조건: booking 결제 완료(COMPLETED) 이후
  is_unmasked     BOOLEAN NOT NULL DEFAULT FALSE,
  unmasked_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_secure_chat_booking ON secure_chats(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_secure_chat_rfq     ON secure_chats(rfq_id)     WHERE rfq_id     IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_secure_chat_sender  ON secure_chats(sender_id);

-- ── 2. 여소남 표준 확정서 (Voucher) ───────────────────────────
CREATE TABLE IF NOT EXISTS vouchers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,
  rfq_id          UUID REFERENCES group_rfqs(id) ON DELETE SET NULL,
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  land_agency_id  UUID REFERENCES tenants(id)   ON DELETE SET NULL,
  -- 파싱/매핑된 표준 확정서 데이터 (VoucherData 인터페이스 구조)
  parsed_data     JSONB NOT NULL DEFAULT '{}',
  -- 업셀링 항목 (여행자 보험 + 유심) — 자동 주입, 원가 0 전액 마진
  upsell_data     JSONB NOT NULL DEFAULT '[]',
  -- PDF 생성 후 Supabase Storage URL
  pdf_url         TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'sent', 'cancelled')),
  issued_at       TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  -- 여행 종료일 (사후 관리 스케줄러용)
  end_date        DATE,
  -- 만족도 조사 알림 발송 여부
  review_notified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voucher_booking    ON vouchers(booking_id)    WHERE booking_id    IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voucher_rfq        ON vouchers(rfq_id)        WHERE rfq_id        IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voucher_customer   ON vouchers(customer_id)   WHERE customer_id   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voucher_status     ON vouchers(status);
CREATE INDEX IF NOT EXISTS idx_voucher_end_date   ON vouchers(end_date)      WHERE review_notified = FALSE;
