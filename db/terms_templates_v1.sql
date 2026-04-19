-- ============================================================
-- 여소남 OS — terms_templates 테이블 생성
-- 4-level 약관 우선순위 시스템 (Platform → Operator → Variant → Product)
-- Supabase > SQL Editor 에서 실행
-- ============================================================

-- 1. terms_templates 테이블 생성
CREATE TABLE IF NOT EXISTS public.terms_templates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  tier          SMALLINT    NOT NULL CHECK (tier IN (1, 2, 3)),
  -- 1 = 플랫폼 기본, 2 = 랜드사 공통, 3 = 랜드사 × 상품타입 variant
  scope         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- tier=1: {"all": true}
  -- tier=2: {"land_operator_id": "uuid"}
  -- tier=3: {"land_operator_id": "uuid", "product_type_keywords": ["전세기","골프"]}
  notices       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- [{type, title, text, surfaces: ['a4'|'mobile'|'booking_guide'], severity: 'critical'|'standard'|'info'}]
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

-- 2. updated_at 자동 갱신 트리거 (set_updated_at 함수가 이미 있으면 재사용)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    CREATE FUNCTION public.set_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $inner$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $inner$;
  END IF;
END$$;

DROP TRIGGER IF EXISTS trg_terms_templates_updated_at ON public.terms_templates;
CREATE TRIGGER trg_terms_templates_updated_at
  BEFORE UPDATE ON public.terms_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. 인덱스
CREATE INDEX IF NOT EXISTS idx_terms_templates_active_tier
  ON public.terms_templates (is_active, is_current, tier, priority);
CREATE INDEX IF NOT EXISTS idx_terms_templates_scope
  ON public.terms_templates USING GIN (scope);
CREATE INDEX IF NOT EXISTS idx_terms_templates_effective
  ON public.terms_templates (starts_at, ends_at);

-- 4. RLS
ALTER TABLE public.terms_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.terms_templates;
CREATE POLICY "Service role full access"
  ON public.terms_templates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read" ON public.terms_templates;
CREATE POLICY "Authenticated read"
  ON public.terms_templates
  FOR SELECT
  TO authenticated
  USING (true);

-- 5. bookings.terms_snapshot — 예약 시점 약관 스냅샷 (법적 방어용, Ironclad/Juro CLM 관행)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS terms_snapshot JSONB DEFAULT NULL;
-- {resolved_at, surface, notices: [...], template_ids: [...]}

COMMENT ON COLUMN public.bookings.terms_snapshot IS
  '예약 확정 시점에 고객이 동의한 약관 블록 전체 (immutable). 분쟁 시 증빙용.';

-- 6. Tier 1 플랫폼 기본약관 시드 (현재 DetailClient.tsx:963-1013 하드코딩을 이관)
INSERT INTO public.terms_templates (name, tier, scope, notices, priority, notes)
VALUES (
  '여소남 플랫폼 기본약관 v1',
  1,
  '{"all": true}'::jsonb,
  $notices$[
    {
      "type": "RESERVATION",
      "title": "📋 예약 및 취소 규정",
      "severity": "critical",
      "surfaces": ["a4", "mobile", "booking_guide"],
      "text": "• 여행 출발 30일 전까지 취소: 계약금 전액 환불\n• 29~21일 전 취소: 예약금의 50% 공제\n• 20~10일 전 취소: 계약금 전액 + 여행 요금의 30% 공제\n• 9~1일 전 취소: 여행 요금의 50% 공제\n• 여행 당일 또는 연락 없이 불참(No-show): 여행 요금의 100% 공제\n• 항공권 발권 이후 취소 시 항공사 규정에 따른 별도 수수료 발생\n• 천재지변·전쟁·테러 등 불가항력으로 인한 취소는 별도 규정 적용"
    },
    {
      "type": "PASSPORT",
      "title": "🛂 여권 및 비자 안내",
      "severity": "standard",
      "surfaces": ["mobile", "booking_guide"],
      "text": "• 여권 유효기간은 출발일 기준 6개월 이상 남아 있어야 합니다\n• 단수여권 또는 여권 훼손 시 출국이 불가할 수 있습니다\n• 비자가 필요한 국가는 고객이 직접 준비해야 합니다 (여행사는 안내만 제공)\n• 미성년자 단독 여행 시 부모 동반 또는 동의서가 필요합니다 (국가별 상이)\n• 여권 분실 시 즉시 현지 대사관/영사관에 신고 (재발급 절차는 고객 본인 부담)"
    },
    {
      "type": "PAYMENT",
      "title": "💳 결제 및 계약",
      "severity": "standard",
      "surfaces": ["mobile", "booking_guide"],
      "text": "• 예약 확정 시 계약금 결제 (여행 요금의 10~20%)\n• 잔금은 출발일 기준 2주 전까지 완납\n• 미완납 시 예약이 자동 취소될 수 있습니다\n• 카드 결제는 일시불/할부 가능 (카드사 정책 준용)\n• 현금 영수증 발행 가능 (요청 시 별도 안내)\n• 전자 계약서는 결제 완료 후 이메일/카카오톡으로 발송됩니다"
    },
    {
      "type": "LIABILITY",
      "title": "⚖️ 여행사 책임 및 고객 의무",
      "severity": "standard",
      "surfaces": ["mobile", "booking_guide"],
      "text": "• 현지 교통 체증, 기상 악화, 천재지변 등 불가항력 사유 발생 시 대체 일정 제공\n• 개인 사유(질병, 비자 거절, 출입국 심사 거부 등)로 인한 여행 불가 시 취소 수수료 규정 적용\n• 여행 중 개인 소지품 분실·도난은 여행자 본인 책임\n• 여행자 보험은 패키지 요금에 포함되어 있으며 세부 약관은 보험증권 참조\n• 가이드 지시 미준수로 인한 안전 사고는 여행사 책임에서 제외됩니다\n• 음주·약물 복용 상태의 활동 참여는 금지되며 이로 인한 사고는 본인 책임\n• 취소 및 예약 변경 접수는 당사 영업일·업무시간(월~금 09:00~18:00, 주말·법정공휴일 제외) 이내 유선·공식 채널로 접수된 건만 당일 취소로 인정\n• 업무시간 외·주말·공휴일 접수 건은 다음 영업일 기준으로 위약금 날짜 산정"
    },
    {
      "type": "COMPLAINT",
      "title": "📞 클레임 및 긴급 문의",
      "severity": "standard",
      "surfaces": ["mobile", "booking_guide"],
      "text": "• 여행 중 불만사항은 즉시 가이드 또는 인솔자에게 고지해주세요 (현지 개선 우선)\n• 사후 클레임은 귀국일 기준 30일 이내에 접수 부탁드립니다\n• 30일 경과 후 클레임은 사실 확인이 어려워 처리가 제한될 수 있습니다\n• 여소남 고객센터: 카카오톡 @여소남 (1:1 채팅, 평일 09~18시)\n• 긴급 상황(사고·질병 등) 발생 시 현지 가이드 또는 여행사 긴급 연락망으로 즉시 통보"
    },
    {
      "type": "NOSHOW",
      "title": "🚫 고객 귀책 No-Show (100% 환불 불가)",
      "severity": "critical",
      "surfaces": ["a4", "mobile", "booking_guide"],
      "text": "• 여권 유효기간 미달(출발일 기준 6개월 미만) 및 여권 훼손으로 출국 거절\n• 해당 국가의 비자 미발급 및 입국 규정 위반(예: 금지 품목 반입)\n• 미팅 시간 지각으로 인한 항공기 미탑승 및 투어 차량 미탑승\n• 문신(타투) 등으로 인한 현지 시설(골프장·온천 등) 입장 거부\n• 고객의 임의적인 일행 이탈 및 개인 행동으로 인한 행사 누락\n• 상기 사유로 인한 출국 거절·행사 누락은 당일 취소(No-Show)로 간주하며 100% 환불 불가"
    },
    {
      "type": "PANDEMIC",
      "title": "🦠 감염병 발생 시 계약 해제",
      "severity": "info",
      "surfaces": ["mobile", "booking_guide"],
      "text": "• 외국정부가 우리 국민에 대해 입국금지·격리조치 등 명령 발령 시 손해배상액 없이 계약해제 가능\n• 외교부가 여행지역에 여행경보 3단계(철수권고)·4단계(여행금지) 발령 시 계약해제 가능\n• 항공·선박 운항 중단으로 계약 이행 불가 시 계약해제 가능\n• 외교부 특별여행주의보 또는 WHO 감염병 경보 5·6단계 선언 시 손해배상액 50% 감경하여 계약해제 가능"
    },
    {
      "type": "SURCHARGE",
      "title": "💱 현지 사정 추가 요금 (고객 부담)",
      "severity": "standard",
      "surfaces": ["mobile", "booking_guide"],
      "text": "• 현지 기상 악화·천재지변·항공 지연/결항·현지 파업 등 통제 불가 사유로 인한 일정 변경·대체 발생 시 여행사 귀책사유 아님\n• 추가 체류비, 송영비(택시비 등), 명절·연휴 써차지(Surcharge) 고객 부담\n• 급격한 환율 변동으로 인한 상품가 인상분 고객 부담\n• 상기 사유로 인한 손해에 대해 당사는 배상 책임을 지지 않음"
    }
  ]$notices$::jsonb,
  100,
  '플랫폼 전체 적용 기본약관. Tier 2/3/4(상품 특약)가 같은 type을 가지면 override됨.'
)
ON CONFLICT DO NOTHING;

-- 확인
SELECT id, name, tier, jsonb_array_length(notices) AS notice_count, priority, is_active
FROM public.terms_templates
ORDER BY tier, priority;
