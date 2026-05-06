-- ============================================================
-- 여소남 OS — terms_templates 공식 마이그레이션 v1
-- Phase 1: 마스터 약관 시드 (자동발권·영업시간·최소인원 방어조항 포함)
-- ON CONFLICT (name) DO UPDATE → 멱등성 보장 (재실행 안전)
-- ============================================================

-- 1. terms_templates 테이블 (idempotent)
CREATE TABLE IF NOT EXISTS public.terms_templates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  tier          SMALLINT    NOT NULL CHECK (tier IN (1, 2, 3)),
  scope         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  notices       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  priority      INTEGER     NOT NULL DEFAULT 50,
  version       INTEGER     NOT NULL DEFAULT 1,
  is_current    BOOLEAN     NOT NULL DEFAULT true,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  starts_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at       TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. name 유니크 제약 (멱등성 UPSERT용)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'terms_templates_name_key'
      AND n.nspname = 'public'
      AND t.relname = 'terms_templates'
  ) THEN
    ALTER TABLE public.terms_templates ADD CONSTRAINT terms_templates_name_key UNIQUE (name);
  END IF;
END $$;

-- 3. updated_at 자동 트리거
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'set_updated_at' AND n.nspname = 'public'
  ) THEN
    EXECUTE $f$
      CREATE FUNCTION public.set_updated_at()
      RETURNS TRIGGER LANGUAGE plpgsql AS $inner$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $inner$;
    $f$;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_terms_templates_updated_at ON public.terms_templates;
CREATE TRIGGER trg_terms_templates_updated_at
  BEFORE UPDATE ON public.terms_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. 인덱스
CREATE INDEX IF NOT EXISTS idx_terms_templates_active_tier
  ON public.terms_templates (is_active, is_current, tier, priority);
CREATE INDEX IF NOT EXISTS idx_terms_templates_scope
  ON public.terms_templates USING GIN (scope);
CREATE INDEX IF NOT EXISTS idx_terms_templates_effective
  ON public.terms_templates (starts_at, ends_at);

-- 5. RLS
ALTER TABLE public.terms_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.terms_templates;
CREATE POLICY "Service role full access"
  ON public.terms_templates FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read" ON public.terms_templates;
CREATE POLICY "Authenticated read"
  ON public.terms_templates FOR SELECT TO authenticated
  USING (true);

-- 6. bookings.terms_snapshot (예약 시점 약관 스냅샷 — 법적 증빙용)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS terms_snapshot JSONB DEFAULT NULL;

COMMENT ON COLUMN public.bookings.terms_snapshot IS
  '예약 확정 시점에 고객이 동의한 약관 블록 전체 (immutable). 분쟁 시 증빙용.';

-- 7. Tier 1 플랫폼 기본 마스터 약관 UPSERT (10블록: 신규 3 + 기존 7 강화)
--    ON CONFLICT (name) DO UPDATE: 재실행 시 notices 내용 안전하게 덮어씀
INSERT INTO public.terms_templates (name, tier, scope, notices, priority, notes)
VALUES (
  '여소남 플랫폼 기본약관 v1',
  1,
  '{"all": true}'::jsonb,
  $notices$[
    {
      "type": "AUTO_TICKETING",
      "title": "✈️ 자동 발권 및 실비 취소 규정",
      "severity": "critical",
      "surfaces": ["mobile", "booking_guide"],
      "text": "• 당사는 원활한 좌석 확보를 위해 예약(결제) 확인 즉시 고객에게 별도 통보 없이 항공권을 발권하고 현지 호텔 객실 파이널(Final) 확정을 진행할 수 있습니다\n• 이미 발권·확정된 이후 고객이 취소를 요청할 경우, 표준 취소 날짜와 무관하게 취소 의사를 밝힌 시점에 발생한 항공사·호텔 실제 위약금(최대 100%)이 산출되어 청구됩니다\n• 발권 여부는 별도 고지 없이 진행되므로, 예약 확정 후 변심 취소 시 실비 전액이 부과될 수 있음을 반드시 인지하시기 바랍니다"
    },
    {
      "type": "BUSINESS_HOURS",
      "title": "🕘 취소 접수 영업시간 기준",
      "severity": "critical",
      "surfaces": ["mobile", "booking_guide"],
      "text": "• 취소 및 예약 변경 접수는 당사 영업시간(평일 월~금 09:00~18:00, 주말·법정공휴일 제외)을 기준으로 합니다\n• 영업시간 종료 후(18:00 이후) 또는 주말·공휴일에 카카오톡, 게시판, 문자, 이메일 등으로 남기신 취소 요청은 다음 첫 영업일 오전 09:00 접수로 간주하여 취소 수수료를 산정합니다\n• 예시: 금요일 19시 카톡 취소 통보 → 월요일 09:00 접수 기준으로 위약금 산정"
    },
    {
      "type": "RESERVATION",
      "title": "📋 표준 취소 수수료",
      "severity": "critical",
      "surfaces": ["a4", "mobile", "booking_guide"],
      "text": "• 출발 30일 전까지: 전액 환불\n• 출발 20일 전까지: 여행 요금의 10% 공제\n• 출발 10일 전까지: 여행 요금의 15% 공제\n• 출발 8일 전까지: 여행 요금의 20% 공제\n• 출발 1일 전까지: 여행 요금의 30% 공제\n• 출발 당일 취소 또는 노쇼(No-Show): 여행 요금의 50% 공제\n• 단, 항공 발권·호텔 파이널 이후 취소 시 항공사·호텔 실비 위약금이 위 기준보다 우선 청구됩니다 (최대 100%)\n• 천재지변·불가항력 사유로 인한 취소는 별도 협의 적용"
    },
    {
      "type": "LIABILITY",
      "title": "⚖️ 천재지변·항공 면책 및 체재비",
      "severity": "critical",
      "surfaces": ["mobile", "booking_guide"],
      "text": "• 기상 악화(태풍·지진·폭설 등), 천재지변, 전염병, 국가 비상사태, 항공사 파업·결항·스케줄 임의 변경 등 당사 귀책이 아닌 사유로 일정이 취소·변경되는 경우 당사는 손해배상 책임을 지지 않습니다\n• 상기 사유로 현지 체류 기간이 연장되어 발생하는 추가 숙박비, 식사비, 교통비 등 모든 체재 비용은 여행자 본인이 100% 부담합니다\n• 여행 중 개인 소지품 분실·도난은 여행자 본인 책임이며, 여행사는 보험사 연락 편의만 제공합니다"
    },
    {
      "type": "NOSHOW",
      "title": "🚫 일정 이탈·No-Show·쇼핑 불참",
      "severity": "critical",
      "surfaces": ["a4", "mobile", "booking_guide"],
      "text": "• 패키지 여행 중 개인 사정으로 일정에 불참하거나 중도 이탈하는 경우 미사용분 환불은 일절 불가합니다\n• 여권 유효기간 미달(출발일 기준 6개월 미만), 여권 훼손·단수여권으로 출국 거절 시 당일 취소(No-Show)로 처리됩니다\n• 비자 미발급, 입국 규정 위반, 지각으로 인한 항공 미탑승 시 No-Show 100% 공제\n• 일정표에 명시된 의무 쇼핑센터 및 지정 투어에 무단 불참 시 현지 랜드사 규정에 따라 1인당 페널티($100~$150 상당)가 별도 청구될 수 있으며 고객이 현지에서 직접 지불해야 합니다"
    },
    {
      "type": "PASSPORT",
      "title": "🛂 여권·비자 안내",
      "severity": "critical",
      "surfaces": ["mobile", "a4", "booking_guide"],
      "text": "• 여권 유효기간은 출발일 기준 6개월 이상 남아 있어야 합니다 (일부 국가는 1년 이상 요구)\n• 여권 훼손·단수여권·영문명 불일치 등으로 출국이 거절될 경우 당일 취소 수수료가 부과됩니다\n• 비자가 필요한 국가는 고객이 직접 준비해야 합니다 (여행사는 안내만 제공)\n• 상기 서류 결함으로 인한 출국 불가·입국 거절은 100% 고객 귀책이며 여행사는 환불 의무를 지지 않습니다\n• 여권 갱신 기간을 반드시 확인하시고 출발 최소 3개월 전 준비를 권고합니다"
    },
    {
      "type": "PAYMENT",
      "title": "💳 결제 및 계약",
      "severity": "standard",
      "surfaces": ["mobile", "booking_guide"],
      "text": "• 예약 확정 시 계약금 결제 (여행 요금의 10~20%)\n• 잔금은 출발일 기준 2주 전까지 완납\n• 미완납 시 예약이 자동 취소될 수 있습니다\n• 카드 결제는 일시불/할부 가능 (카드사 정책 준용)\n• 전자 계약서는 결제 완료 후 이메일·카카오톡으로 발송됩니다"
    },
    {
      "type": "SURCHARGE",
      "title": "💱 유류할증료 및 성수기 추가 요금",
      "severity": "standard",
      "surfaces": ["mobile", "a4"],
      "text": "• 유류할증료(FSC)는 항공사 정책에 따라 출발 전까지 변동될 수 있으며 변동분은 고객 부담입니다\n• 명절·연휴·성수기·박람회 기간 현지 써차지(Surcharge)가 발생할 경우 추가 청구됩니다\n• 급격한 환율 변동(±10% 초과)으로 인한 상품가 인상분은 출발 30일 전까지 고지 후 청구할 수 있습니다"
    },
    {
      "type": "PANDEMIC",
      "title": "🦠 감염병 발생 시 계약 해제",
      "severity": "info",
      "surfaces": ["mobile", "booking_guide"],
      "text": "• 외국 정부가 우리 국민에 대해 입국금지·격리 명령 발령 시 손해배상액 없이 계약해제 가능\n• 외교부 여행경보 3단계(철수권고)·4단계(여행금지) 발령 시 계약해제 가능\n• 항공·선박 운항 중단으로 계약 이행 불가 시 계약해제 가능\n• 외교부 특별여행주의보 또는 WHO 감염병 경보 5·6단계 선언 시 손해배상액 50% 감경하여 계약해제 가능"
    },
    {
      "type": "MIN_PARTICIPANTS",
      "title": "👥 최소 출발 인원 미달 처리",
      "severity": "info",
      "surfaces": ["mobile", "booking_guide"],
      "text": "• 기획여행 상품은 최소 출발 인원이 충족되어야 행사가 진행됩니다\n• 최소 인원 미달로 행사 취소 시 출발 7일 전까지 고객에게 개별 통보합니다\n• 이 경우 결제 금액 전액을 환불하며, 추가 배상 책임은 지지 않습니다\n• 대체 출발일 또는 유사 상품으로의 변경을 우선 제안드립니다"
    }
  ]$notices$::jsonb,
  100,
  '플랫폼 전체 적용 기본약관 v2. AUTO_TICKETING(자동발권)·BUSINESS_HOURS(영업시간취소)·MIN_PARTICIPANTS 추가. Tier 2/3/4가 같은 type을 가지면 override됨.'
)
ON CONFLICT (name) DO UPDATE SET
  notices    = EXCLUDED.notices,
  notes      = EXCLUDED.notes,
  version    = public.terms_templates.version + 1,
  updated_at = now();

-- 확인
SELECT id, name, tier, jsonb_array_length(notices) AS block_count, version, updated_at
FROM public.terms_templates
ORDER BY tier, priority;
