-- ============================================================
-- Group RFQ v1: AI 단체여행 무인 중개 & 선착순 입찰 엔진
-- ============================================================

-- 1. tenants 테이블 확장: 티어 + 신뢰도 점수
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'BRONZE'
    CHECK (tier IN ('GOLD','SILVER','BRONZE')),
  ADD COLUMN IF NOT EXISTS reliability_score INTEGER NOT NULL DEFAULT 100;

CREATE INDEX IF NOT EXISTS idx_tenants_tier ON tenants(tier);
-- 티어별 노출 지연: GOLD=즉시, SILVER=+10분, BRONZE=+20분 (env: RFQ_TIER_DELAY_MINUTES로 단축 가능)

-- 2. group_rfqs: 고객 RFQ (AI 인터뷰 → 표준 견적 요청서)
CREATE TABLE IF NOT EXISTS group_rfqs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_code             TEXT UNIQUE NOT NULL,   -- GRP-0001 형식, 앱에서 채번
  customer_id          UUID REFERENCES customers(id),
  customer_name        TEXT NOT NULL,
  customer_phone       TEXT,
  -- AI 인터뷰 수집 필드
  destination          TEXT NOT NULL,
  departure_date_from  DATE,
  departure_date_to    DATE,
  duration_nights      INTEGER,
  adult_count          INTEGER NOT NULL DEFAULT 1,
  child_count          INTEGER NOT NULL DEFAULT 0,
  budget_per_person    INTEGER,    -- 1인당 예산 (원)
  total_budget         INTEGER,    -- 총 예산 (원)
  hotel_grade          TEXT,       -- '3성','4성','5성','무관'
  meal_plan            TEXT,       -- '전식포함','조식','불포함'
  transportation       TEXT,       -- '전세버스','기차','자유이동'
  special_requests     TEXT,
  custom_requirements  JSONB DEFAULT '{}',
  -- 상태 머신
  status               TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',              -- 작성 중 (AI 인터뷰)
      'published',          -- 공고 등록됨 (티어별 노출 진행)
      'bidding',            -- 입찰 진행 중 (1건 이상 bid 확정)
      'analyzing',          -- AI 분석 중 (제안서 3건 이상 제출)
      'awaiting_selection', -- 고객 선택 대기 (팩트폭격 리포트 완료)
      'contracted',         -- 계약 완료
      'completed',          -- 여행 완료
      'cancelled'
    )),
  -- 티어별 공고 노출 타이밍
  published_at         TIMESTAMPTZ,
  gold_unlock_at       TIMESTAMPTZ,  -- published_at + 0분
  silver_unlock_at     TIMESTAMPTZ,  -- published_at + N분 (env: RFQ_TIER_DELAY_MINUTES, 기본 10)
  bronze_unlock_at     TIMESTAMPTZ,  -- published_at + 2N분 (기본 20)
  bid_deadline         TIMESTAMPTZ,  -- published_at + 24시간
  max_proposals        INTEGER NOT NULL DEFAULT 5,
  -- 낙찰 정보
  selected_proposal_id UUID,         -- 지연 FK (아래에서 ALTER로 추가)
  -- 메타
  ai_interview_log     JSONB DEFAULT '[]',  -- 인터뷰 대화 로그
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfqs_status       ON group_rfqs(status);
CREATE INDEX IF NOT EXISTS idx_rfqs_customer     ON group_rfqs(customer_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_published    ON group_rfqs(published_at) WHERE status != 'draft';

-- 3. rfq_bids: 선착순 입찰 슬롯
CREATE TABLE IF NOT EXISTS rfq_bids (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id           UUID NOT NULL REFERENCES group_rfqs(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  status           TEXT NOT NULL DEFAULT 'locked'
    CHECK (status IN (
      'locked',     -- 참여 확정, 3시간 제출 타이머 진행 중
      'submitted',  -- 제안서 제출 완료
      'selected',   -- 낙찰
      'rejected',   -- 미선택
      'timeout',    -- 3시간 내 미제출 → 자동 박탈
      'withdrawn'   -- 자진 철회
    )),
  locked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  submit_deadline  TIMESTAMPTZ NOT NULL,   -- locked_at + 3시간 (env: RFQ_BID_TIMEOUT_MINUTES로 단축)
  submitted_at     TIMESTAMPTZ,
  -- 패널티 추적
  is_penalized     BOOLEAN NOT NULL DEFAULT FALSE,
  penalty_reason   TEXT,
  UNIQUE (rfq_id, tenant_id)  -- 테넌트당 RFQ 1회만 참여
);

CREATE INDEX IF NOT EXISTS idx_bids_rfq      ON rfq_bids(rfq_id);
CREATE INDEX IF NOT EXISTS idx_bids_tenant   ON rfq_bids(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bids_deadline ON rfq_bids(submit_deadline)
  WHERE status = 'locked';  -- 만료 크론에서 빠르게 조회

-- 4. rfq_proposals: 제안서 + 필수 원가 체크리스트
CREATE TABLE IF NOT EXISTS rfq_proposals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id               UUID NOT NULL REFERENCES group_rfqs(id) ON DELETE CASCADE,
  bid_id               UUID NOT NULL REFERENCES rfq_bids(id),
  tenant_id            UUID NOT NULL REFERENCES tenants(id),
  -- 제안 내용
  proposal_title       TEXT,
  itinerary_summary    TEXT,
  total_cost           INTEGER NOT NULL,           -- 원가 (플랫폼 내부 전용, 고객 비공개)
  total_selling_price  INTEGER NOT NULL,           -- 판매가 (고객 노출)
  -- AI 계산 필드
  hidden_cost_estimate INTEGER NOT NULL DEFAULT 0, -- AI: 불포함 비용 예측 합계
  real_total_price     INTEGER,                    -- AI: 판매가 + 숨은 비용 (팩트폭격 기준)
  -- 필수 원가 체크리스트 (JSONB)
  -- 구조:
  -- {
  --   guide_fee:      { included: bool, amount: number|null, note: string },
  --   driver_tip:     { included: bool, amount: number|null, note: string },
  --   fuel_surcharge: { included: bool, amount: number|null, note: string },
  --   local_tax:      { included: bool, amount: number|null, note: string },
  --   water_cost:     { included: bool, amount: number|null, note: string },
  --   inclusions:     string[],
  --   exclusions:     string[],
  --   optional_tours: [{ name: string, price: number }],
  --   hotel_info:     { grade: string, name: string, notes: string },
  --   meal_plan:      string,
  --   transportation: string
  -- }
  checklist            JSONB NOT NULL DEFAULT '{}',
  checklist_completed  BOOLEAN NOT NULL DEFAULT FALSE,  -- 5개 필수항목 모두 입력 시 true
  -- AI 검수 결과 (비동기)
  ai_review            JSONB,
  -- { score: number, issues: string[], suggestions: string[], fact_check: string[] }
  ai_reviewed_at       TIMESTAMPTZ,
  rank                 INTEGER,   -- 1,2,3 (TOP 3 선정 후 채번, NULL=분석 전)
  -- 상태
  status               TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',      -- 작성 중
      'submitted',  -- 제출됨 (AI 검수 대기)
      'reviewing',  -- AI 검수 중
      'approved',   -- AI 검수 통과
      'selected',   -- 고객 선택 (낙찰)
      'rejected'    -- 미선택
    )),
  submitted_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposals_rfq    ON rfq_proposals(rfq_id);
CREATE INDEX IF NOT EXISTS idx_proposals_tenant ON rfq_proposals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_proposals_rank   ON rfq_proposals(rfq_id, rank)
  WHERE rank IS NOT NULL;

-- selected_proposal_id FK (순환 참조 방지를 위해 지연 추가)
ALTER TABLE group_rfqs
  ADD CONSTRAINT fk_rfqs_selected_proposal
  FOREIGN KEY (selected_proposal_id)
  REFERENCES rfq_proposals(id)
  DEFERRABLE INITIALLY DEFERRED;

-- 5. rfq_messages: AI 중개 메시지
CREATE TABLE IF NOT EXISTS rfq_messages (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id                 UUID NOT NULL REFERENCES group_rfqs(id) ON DELETE CASCADE,
  proposal_id            UUID REFERENCES rfq_proposals(id),  -- 특정 제안서 대화
  -- 발신자
  sender_type            TEXT NOT NULL
    CHECK (sender_type IN ('customer','tenant','ai','system')),
  sender_id              TEXT,  -- customer_id, tenant_id, 'ai', 'system'
  -- 메시지
  raw_content            TEXT NOT NULL,   -- 원본 (서버 전용, 상대방에게 직접 노출 안 됨)
  processed_content      TEXT,            -- AI 번역/정제/익명화 후
  -- PII 감지
  pii_detected           BOOLEAN NOT NULL DEFAULT FALSE,
  pii_blocked            BOOLEAN NOT NULL DEFAULT FALSE,
  -- 수신자 및 가시성
  recipient_type         TEXT NOT NULL
    CHECK (recipient_type IN ('customer','tenant','admin')),
  is_visible_to_customer BOOLEAN NOT NULL DEFAULT TRUE,
  is_visible_to_tenant   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfq_messages_rfq      ON rfq_messages(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_messages_proposal ON rfq_messages(proposal_id)
  WHERE proposal_id IS NOT NULL;

-- ============================================================
-- 씨드 데이터 (개발/테스트 전용)
-- 실제 프로덕션에서는 이 블록을 실행하지 마세요
-- ============================================================

-- 기존 테넌트가 있으면 티어 업데이트 (없으면 새로 삽입)
-- 실제 환경에서는 UI에서 티어를 설정하세요
DO $$
BEGIN
  -- 기존 테넌트가 있는 경우 첫 번째를 GOLD로 설정 (테스트용)
  UPDATE tenants SET tier = 'GOLD' WHERE id = (SELECT id FROM tenants ORDER BY created_at LIMIT 1);
  UPDATE tenants SET tier = 'SILVER' WHERE id = (SELECT id FROM tenants ORDER BY created_at OFFSET 1 LIMIT 1);
  UPDATE tenants SET tier = 'BRONZE' WHERE id = (SELECT id FROM tenants ORDER BY created_at OFFSET 2 LIMIT 1);
EXCEPTION
  WHEN OTHERS THEN
    NULL; -- 테넌트가 없으면 무시
END;
$$;
