-- ============================================================
-- os_policies: OS 관제탑 정책 엔진 테이블
-- 가격/마일리지/알림/노출/운영/마케팅/SaaS 100개 정책을 하나로 관리
-- ============================================================

CREATE TABLE IF NOT EXISTS os_policies (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,

  -- 분류
  category        TEXT        NOT NULL
    CHECK (category IN (
      'pricing',       -- 가격 & 할인
      'mileage',       -- 마일리지 & CRM
      'booking',       -- 예약 & 취소 룰
      'notification',  -- 알림 & 알림톡
      'display',       -- 프론트 노출 & UX
      'product',       -- 상품 & 재고
      'operations',    -- 운영 & CS
      'marketing',     -- AI 마케팅 관제
      'saas'           -- SaaS 플랫폼
    )),
  name            TEXT        NOT NULL,
  description     TEXT,

  -- 조건 (언제 발동?)
  trigger_type    TEXT        NOT NULL DEFAULT 'condition'
    CHECK (trigger_type IN ('condition', 'schedule', 'event', 'cron', 'always')),
  trigger_config  JSONB       DEFAULT '{}'::jsonb,
  -- condition: { "field": "destination", "operator": "=", "value": "다낭" }
  -- schedule:  { "starts_at": "2026-03-24", "ends_at": "2026-03-31" }
  -- event:     { "event": "booking_created", "days_before": 7 }
  -- cron:      { "cron": "0 9 * * 1" }  (매주 월 9시)
  -- always:    {} (상시 적용)

  -- 액션 (뭘 하나?)
  action_type     TEXT        NOT NULL,
  -- pricing:      'price_discount_fixed', 'price_discount_pct', 'price_surcharge_pct'
  -- mileage:      'mileage_multiply', 'mileage_fixed', 'mileage_grant'
  -- notification: 'send_alimtalk', 'send_sms', 'send_email', 'auto_reply'
  -- display:      'show_badge', 'show_banner', 'show_popup', 'hide_product'
  -- booking:      'auto_cancel', 'auto_refund', 'require_document', 'hold_approval'
  -- product:      'deactivate_expired', 'lock_stock', 'sort_bottom'
  -- operations:   'set_holiday', 'block_user', 'slack_notify'
  -- marketing:    'pause_campaign', 'scale_budget', 'boost_keyword'
  action_config   JSONB       DEFAULT '{}'::jsonb,
  -- { "amount": 30000 }  정액 할인
  -- { "rate": 0.05 }     5% 할인
  -- { "multiplier": 2 }  마일리지 2배
  -- { "template": "d7_reminder" }  알림 템플릿
  -- { "badge_text": "마감임박", "badge_color": "red" }
  -- { "banner_text": "...", "banner_color": "red", "position": "top" }

  -- 대상 범위 (누구/뭐에 적용?)
  target_scope    JSONB       DEFAULT '{}'::jsonb,
  -- { "destination": "다낭" }           특정 목적지
  -- { "product_ids": ["uuid1", ...] }  특정 상품
  -- { "customer_grade": "VVIP" }       특정 등급
  -- { "min_price": 1500000 }           가격 조건
  -- { "all": true }                    전체 적용

  -- 기간
  starts_at       TIMESTAMPTZ DEFAULT NOW(),
  ends_at         TIMESTAMPTZ,          -- NULL이면 상시 적용
  is_active       BOOLEAN     DEFAULT true,
  priority        INT         DEFAULT 100,  -- 낮을수록 우선 (충돌 시)

  -- 메타
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_os_policies_category ON os_policies(category);
CREATE INDEX IF NOT EXISTS idx_os_policies_active ON os_policies(is_active);
CREATE INDEX IF NOT EXISTS idx_os_policies_dates ON os_policies(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_os_policies_trigger ON os_policies USING gin(trigger_config);
CREATE INDEX IF NOT EXISTS idx_os_policies_scope ON os_policies USING gin(target_scope);

-- updated_at 트리거
CREATE OR REPLACE FUNCTION update_os_policies_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_os_policies_updated_at ON os_policies;
CREATE TRIGGER trg_os_policies_updated_at
  BEFORE UPDATE ON os_policies
  FOR EACH ROW EXECUTE FUNCTION update_os_policies_updated_at();

-- RLS
ALTER TABLE os_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_os_policies" ON os_policies FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 기본 정책 시드 데이터 (사장님이 바로 사용 가능)
-- ============================================================
INSERT INTO os_policies (category, name, description, trigger_type, trigger_config, action_type, action_config, target_scope, is_active, priority) VALUES

-- A. 가격
('pricing', 'VVIP 단골 할인 3%', '2회 이상 예약 이력 고객 자동 3% 할인', 'condition', '{"field":"booking_count","operator":">=","value":2}', 'price_discount_pct', '{"rate":0.03}', '{"all":true}', false, 100),
('pricing', '얼리버드 10% 할인', '출발 D-90 이전 예약 시 10% 할인', 'condition', '{"field":"days_before_departure","operator":">=","value":90}', 'price_discount_pct', '{"rate":0.10}', '{"all":true}', false, 90),
('pricing', '라스트미닛 20% 할인', '출발 D-7 이내 잔여석 20% 할인', 'condition', '{"field":"days_before_departure","operator":"<=","value":7}', 'price_discount_pct', '{"rate":0.20}', '{"all":true}', false, 80),
('pricing', '주말 출발 10% 할증', '토/일 출발 상품 10% 할증', 'condition', '{"field":"departure_day","operator":"in","value":["토","일"]}', 'price_surcharge_pct', '{"rate":0.10}', '{"all":true}', false, 100),
('pricing', '단체 할인 2만원', '4인 이상 예약 시 인당 2만원 할인', 'condition', '{"field":"pax_count","operator":">=","value":4}', 'price_discount_fixed', '{"amount":20000}', '{"all":true}', false, 100),

-- B. 마일리지
('mileage', '기본 마일리지 1% 적립', '결제 완료 시 총금액 1% 적립', 'always', '{}', 'mileage_fixed', '{"rate":0.01}', '{"all":true}', true, 100),
('mileage', 'VVIP 마일리지 3%', 'VVIP 등급 3% 적립', 'condition', '{"field":"customer_grade","operator":"=","value":"VVIP"}', 'mileage_fixed', '{"rate":0.03}', '{"customer_grade":"VVIP"}', true, 50),
('mileage', '우수 고객 마일리지 2%', '우수 등급 2% 적립', 'condition', '{"field":"customer_grade","operator":"=","value":"우수"}', 'mileage_fixed', '{"rate":0.02}', '{"customer_grade":"우수"}', true, 60),
('mileage', '신규 가입 웰컴 10,000P', '신규 회원 가입 시 10,000점 즉시 지급', 'event', '{"event":"member_signup"}', 'mileage_grant', '{"points":10000}', '{"all":true}', true, 100),
('mileage', '마일리지 사용 한도 30%', '1회 결제 시 결제액의 30%까지만 사용 가능', 'always', '{}', 'mileage_limit', '{"max_usage_rate":0.30}', '{"all":true}', true, 100),

-- C. 예약/취소
('booking', 'D-30 전액 환불', '출발 30일 전 취소 시 100% 환불', 'condition', '{"field":"days_before_departure","operator":">=","value":30}', 'auto_refund', '{"refund_rate":1.0}', '{"all":true}', true, 100),
('booking', 'D-14~8 위약금 30%', '출발 14~8일 전 취소 시 30% 위약금', 'condition', '{"field":"days_before_departure","operator":"between","value":[8,14]}', 'auto_refund', '{"refund_rate":0.70}', '{"all":true}', true, 100),
('booking', '가예약 24시간 자동 취소', '무통장 입금 미결제 24시간 후 자동 취소', 'condition', '{"field":"unpaid_hours","operator":">=","value":24}', 'auto_cancel', '{"reason":"미결제 자동취소"}', '{"all":true}', true, 100),

-- D. 알림
('notification', 'D-7 출발 안내', '출발 7일 전 여행 준비물 안내', 'event', '{"event":"departure","days_before":7}', 'send_alimtalk', '{"template":"d7_reminder"}', '{"all":true}', true, 100),
('notification', 'D-1 리마인드', '출발 1일 전 최종 안내', 'event', '{"event":"departure","days_before":1}', 'send_alimtalk', '{"template":"d1_reminder"}', '{"all":true}', true, 100),
('notification', '예약 확정 알림', '결제 완료 시 예약 확정 알림톡', 'event', '{"event":"payment_completed"}', 'send_alimtalk', '{"template":"booking_confirmed"}', '{"all":true}', true, 100),
('notification', '귀국 후 리뷰 요청', '귀국일 D+1 리뷰 작성 안내', 'event', '{"event":"return","days_after":1}', 'send_alimtalk', '{"template":"review_request"}', '{"all":true}', true, 100),
('notification', '생일 축하 쿠폰', '생일 D-7 축하 쿠폰 발송', 'event', '{"event":"birthday","days_before":7}', 'send_alimtalk', '{"template":"birthday_coupon"}', '{"all":true}', true, 100),
('notification', '여권 만료 경고', '여권 만료일 6개월 미만 경고', 'condition', '{"field":"passport_months_left","operator":"<","value":6}', 'send_alimtalk', '{"template":"passport_expiry"}', '{"all":true}', true, 100),
('notification', '휴면 전환 안내', '11개월 미접속 시 휴면 전환 안내', 'condition', '{"field":"inactive_months","operator":">=","value":11}', 'send_alimtalk', '{"template":"dormant_warning"}', '{"all":true}', true, 100),

-- E. 프론트 노출
('display', '마감임박 뱃지', '잔여석 3석 이하 상품 마감임박 표시', 'condition', '{"field":"remaining_seats","operator":"<=","value":3}', 'show_badge', '{"text":"마감임박","color":"red"}', '{"all":true}', true, 100),
('display', 'NEW 뱃지 14일', '신규 등록 14일간 NEW 뱃지', 'condition', '{"field":"days_since_created","operator":"<=","value":14}', 'show_badge', '{"text":"NEW","color":"blue"}', '{"all":true}', true, 100),
('display', '베스트셀러 뱃지', '주간 예약 1위 상품 자동 뱃지', 'condition', '{"field":"weekly_booking_rank","operator":"=","value":1}', 'show_badge', '{"text":"BEST","color":"amber"}', '{"all":true}', true, 100),

-- F. 상품 자동화
('product', '만료 상품 자동 숨김', '출발일 지난 상품 자동 비활성화', 'cron', '{"cron":"0 0 * * *"}', 'deactivate_expired', '{}', '{"all":true}', true, 100),
('product', '품절 상품 하단 정렬', '잔여석 0 상품 검색 목록 맨 밑', 'condition', '{"field":"remaining_seats","operator":"=","value":0}', 'sort_bottom', '{}', '{"all":true}', true, 100),

-- G. 운영
('operations', '자동 정산 리포트', '매일 자정 일일 매출/취소 자동 정산', 'cron', '{"cron":"0 0 * * *"}', 'slack_notify', '{"channel":"finance","template":"daily_settlement"}', '{"all":true}', true, 100),
('operations', '블랙리스트 예약 홀딩', '블랙리스트 고객 예약 시 관리자 승인 대기', 'condition', '{"field":"is_blacklisted","operator":"=","value":true}', 'hold_approval', '{"reason":"블랙리스트 고객"}', '{"all":true}', true, 100),

-- H. 마케팅
('marketing', '킬 스위치', 'CTR 1% 미만 + 5만원 소진 캠페인 자동 정지', 'condition', '{"field":"ctr","operator":"<","value":1,"and":{"field":"spend","operator":">=","value":50000}}', 'pause_campaign', '{}', '{"all":true}', true, 100),
('marketing', 'ROAS 스케일업', 'ROAS 300% 이상 캠페인 예산 20% 자동 증액', 'condition', '{"field":"roas","operator":">=","value":300}', 'scale_budget', '{"increase_rate":0.20}', '{"all":true}', true, 100)

ON CONFLICT DO NOTHING;
