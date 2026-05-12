-- ============================================================================
-- Data Intelligence Phase 1 — 사유 카테고리화 (Free-text → ENUM)
-- ============================================================================
-- 목적: 자유텍스트로 누수되던 "왜?" 데이터를 카테고리화하여 학습 가능 형태로
--   - bookings: cancel_reason_category, void_reason_category
--   - travel_packages: review_reject_category, review_reject_subcode
--   - price_history: change_reason_category
--   - customer_notes: note_category, outcome
-- 모든 컬럼은 nullable + CHECK (기존 데이터 무영향, 점진적 백필)
-- ============================================================================

-- ─── bookings: 취소·환불 사유 카테고리 ──────────────────────────────────────
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cancel_reason_category TEXT
    CHECK (cancel_reason_category IS NULL OR cancel_reason_category IN (
      'customer_request',        -- 고객 단순 요청 (변심)
      'customer_schedule',       -- 고객 일정 변경 (불가피)
      'customer_health',         -- 건강/사고
      'customer_payment_fail',   -- 결제 실패/지연
      'product_unavailable',     -- 상품 좌석/날짜 불가
      'price_mismatch',          -- 가격 안내 오류
      'competitor_switch',       -- 타사 전환
      'land_operator_issue',     -- 랜드사 사유 (취소·일정변경)
      'force_majeure',           -- 천재지변/정세
      'duplicate_booking',       -- 중복 예약
      'system_error',            -- 시스템 오류
      'admin_force',             -- 관리자 강제 취소 (정책 위반 등)
      'other'
    )),
  ADD COLUMN IF NOT EXISTS cancel_reason_subnote TEXT,
  ADD COLUMN IF NOT EXISTS void_reason_category TEXT
    CHECK (void_reason_category IS NULL OR void_reason_category IN (
      'test_data', 'wrong_input', 'merge_to_other', 'admin_force', 'other'
    ));

CREATE INDEX IF NOT EXISTS idx_bookings_cancel_reason_cat
  ON bookings(cancel_reason_category)
  WHERE cancel_reason_category IS NOT NULL;

COMMENT ON COLUMN bookings.cancel_reason_category IS
  '취소 사유 카테고리(ENUM). 자유텍스트 cancel_reason은 보조. AI 학습용.';

-- ─── travel_packages: 검수 반려 사유 카테고리 ──────────────────────────────
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS review_reject_category TEXT
    CHECK (review_reject_category IS NULL OR review_reject_category IN (
      'extraction_error',        -- AI 추출 오류
      'missing_fields',          -- 필수 필드 누락
      'price_unverified',        -- 가격 미확정
      'date_unverified',         -- 출발일 미확정
      'duplicate_product',       -- 중복 상품
      'inappropriate_content',   -- 부적절한 내용
      'low_confidence',          -- 신뢰도 낮음
      'land_op_changed',         -- 랜드사 정책 변경
      'pending_supplier_code',   -- 공급사 코드 미매핑
      'other'
    )),
  ADD COLUMN IF NOT EXISTS review_reject_subnote TEXT;

CREATE INDEX IF NOT EXISTS idx_travel_packages_reject_cat
  ON travel_packages(review_reject_category)
  WHERE review_reject_category IS NOT NULL;

-- ─── price_history: 가격 변경 사유 카테고리 ─────────────────────────────────
ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS change_reason_category TEXT
    CHECK (change_reason_category IS NULL OR change_reason_category IN (
      'demand_surge',            -- 수요 증가
      'demand_drop',             -- 수요 감소
      'seat_scarcity',           -- 좌석 부족
      'cost_increase',           -- 원가 인상
      'cost_decrease',           -- 원가 인하
      'competitor_match',        -- 경쟁가 대응
      'promotion',               -- 프로모션
      'closeout',                -- 임박마감
      'season_factor',           -- 시즌 요인
      'fx_adjustment',           -- 환율 조정
      'manual_correction',       -- 수동 정정
      'other'
    ));

CREATE INDEX IF NOT EXISTS idx_price_history_reason_cat
  ON price_history(change_reason_category)
  WHERE change_reason_category IS NOT NULL;

-- ─── customer_notes: 상담 카테고리 + 결과 ─────────────────────────────────
ALTER TABLE customer_notes
  ADD COLUMN IF NOT EXISTS note_category TEXT
    CHECK (note_category IS NULL OR note_category IN (
      'inbound_inquiry',         -- 인바운드 문의
      'outbound_followup',       -- 아웃바운드 팔로업
      'reservation_request',     -- 예약 요청
      'reservation_change',      -- 예약 변경
      'reservation_cancel',      -- 예약 취소
      'refund_request',          -- 환불 요청
      'complaint',               -- 컴플레인
      'compliment',              -- 칭찬/감사
      'product_question',        -- 상품 문의
      'price_negotiation',       -- 가격 협상
      'document_request',        -- 서류 요청 (여권/사증)
      'upsell',                  -- 업셀
      'happy_call',              -- 해피콜
      'other'
    )),
  ADD COLUMN IF NOT EXISTS outcome TEXT
    CHECK (outcome IS NULL OR outcome IN (
      'resolved',                -- 즉시 해결
      'pending_followup',        -- 팔로업 필요
      'escalated',               -- 에스컬레이션
      'booking_created',         -- 예약 생성으로 이어짐
      'lost_to_competitor',      -- 경쟁사로 이탈
      'lost_to_price',           -- 가격 이슈로 이탈
      'lost_other',              -- 기타 이탈
      'no_response_needed'       -- 응답 불요
    )),
  ADD COLUMN IF NOT EXISTS sentiment SMALLINT
    CHECK (sentiment IS NULL OR (sentiment >= -2 AND sentiment <= 2)),
  ADD COLUMN IF NOT EXISTS duration_sec INTEGER;

CREATE INDEX IF NOT EXISTS idx_customer_notes_category
  ON customer_notes(note_category)
  WHERE note_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_notes_outcome
  ON customer_notes(outcome)
  WHERE outcome IS NOT NULL;

COMMENT ON COLUMN customer_notes.sentiment IS
  '감정 점수 -2(매우 부정) ~ +2(매우 긍정). 분석 시 NPS·이탈 예측 신호.';
