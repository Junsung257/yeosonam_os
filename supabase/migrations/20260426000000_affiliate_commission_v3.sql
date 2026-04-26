-- ============================================================
-- 어필리에이터 가산식 커미션 + 정책 감사로그 + 콘텐츠 어트리뷰션
-- (2026-04-26)
--
-- 가산식 커미션 모델:
--   final_rate = product.affiliate_commission_rate
--              + affiliates.bonus_rate (등급 보너스)
--              + Σ os_policies(category='commission') 가산
--              ↓ min(global_cap)
--   booking 시점 스냅샷 → bookings.commission_breakdown JSONB
--
-- ============================================================

-- ─────────────────────────────────────────────────
-- ① travel_packages: 상품별 어필리에이터 기본 커미션율 (모두 동일)
-- ─────────────────────────────────────────────────
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS affiliate_commission_rate NUMERIC(5,4) NOT NULL DEFAULT 0.02;

COMMENT ON COLUMN travel_packages.affiliate_commission_rate IS
  '상품별 어필리에이터 기본 커미션율 (예: 0.02 = 2%, 모든 어필리에이터 동일 적용)';

-- 안전장치: 0~30% 범위
ALTER TABLE travel_packages
  DROP CONSTRAINT IF EXISTS travel_packages_aff_commission_range;
ALTER TABLE travel_packages
  ADD  CONSTRAINT travel_packages_aff_commission_range
  CHECK (affiliate_commission_rate >= 0 AND affiliate_commission_rate <= 0.30);

-- ─────────────────────────────────────────────────
-- ② bookings: 예약 시점 커미션 분해 스냅샷
-- ─────────────────────────────────────────────────
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS commission_breakdown JSONB;

COMMENT ON COLUMN bookings.commission_breakdown IS
  '예약 시점 커미션 분해(스냅샷). 정책 변경에 영향받지 않음.
   { base, tier, campaigns: [{name, rate, policy_id}], raw_total, cap, final_rate, capped }';

-- ─────────────────────────────────────────────────
-- ③ bookings: 콘텐츠 크리에이티브 어트리뷰션 (어떤 카드뉴스/블로그로 들어왔나)
-- ─────────────────────────────────────────────────
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS content_creative_id UUID;

COMMENT ON COLUMN bookings.content_creative_id IS
  '예약 직전 마지막으로 본 콘텐츠 ID (BlogTracker.tsx contentCreativeId 매칭). 어필리에이터 콘텐츠별 매출 기여도 계산용.';

CREATE INDEX IF NOT EXISTS idx_bookings_content_creative ON bookings(content_creative_id) WHERE content_creative_id IS NOT NULL;

-- ─────────────────────────────────────────────────
-- ④ os_policies: 'commission' 카테고리 추가
-- ─────────────────────────────────────────────────
ALTER TABLE os_policies DROP CONSTRAINT IF EXISTS os_policies_category_check;
ALTER TABLE os_policies ADD CONSTRAINT os_policies_category_check
  CHECK (category IN (
    'pricing', 'mileage', 'booking', 'notification', 'display',
    'product', 'operations', 'marketing', 'saas',
    'commission'   -- ★ 신규: 어필리에이터 커미션 가산/캡 정책
  ));

-- ─────────────────────────────────────────────────
-- ⑤ os_policies 시드 (커미션 글로벌 캡 + 샘플 캠페인)
-- ─────────────────────────────────────────────────
INSERT INTO os_policies (category, name, description, trigger_type, trigger_config, action_type, action_config, target_scope, is_active, priority) VALUES
  ('commission', '커미션 글로벌 캡 7%', '모든 정책 합산 후 어필리에이터 최종 커미션은 7%를 넘을 수 없음', 'always', '{}', 'commission_cap', '{"max_rate":0.07}', '{"all":true}', true, 999),
  ('commission', '신규 어필리에이터 +0.5% 캠페인 (예시)', '가입 30일 이내 신규 어필리에이터 커미션 +0.5% (비활성 상태로 시드)', 'condition', '{"field":"days_since_signup","operator":"<=","value":30}', 'commission_campaign_bonus', '{"rate":0.005}', '{"all":true}', false, 100)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────
-- ⑥ 정책 변경 감사 로그 (누가/언제/무엇을/왜)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS os_policy_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id       UUID,                 -- DELETE 후에도 보존 위해 FK 안 검
  action          TEXT NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE','TOGGLE')),
  diff            JSONB NOT NULL,       -- { before: {...}, after: {...} }
  reason          TEXT,                 -- 사장님이 입력한 변경 사유
  changed_by      TEXT NOT NULL DEFAULT 'system',
  changed_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policy_audit_policy ON os_policy_audit_log(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_audit_changed_at ON os_policy_audit_log(changed_at DESC);

ALTER TABLE os_policy_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_all_policy_audit ON os_policy_audit_log FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE os_policy_audit_log IS
  '정책 변경 이력. 어필리에이터 분쟁 / 사장님 의사결정 추적용.';

-- ─────────────────────────────────────────────────
-- ⑦ 확인 쿼리
-- ─────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='travel_packages' AND column_name='affiliate_commission_rate') AS pkg_col,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='bookings' AND column_name='commission_breakdown') AS bk_breakdown,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='bookings' AND column_name='content_creative_id') AS bk_content,
  (SELECT COUNT(*) FROM os_policies WHERE category='commission') AS commission_policies,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='os_policy_audit_log') AS audit_table;
