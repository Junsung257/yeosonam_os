-- =============================================================
-- 여소남 OS — Phase 2-F: 다중통화 환율 장부
-- =============================================================
-- 목적:
--   상품은 KRW로 팔지만 랜드사 결제는 USD로 할 때
--   환차손/환차익을 자동 계산하기 위한 테이블 및 컬럼 추가.
-- =============================================================

-- ─── [1] fx_rate_snapshots: 일별 환율 스냅샷 ─────────────────

CREATE TABLE IF NOT EXISTS fx_rate_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL UNIQUE,
  usd_to_krw NUMERIC(10,2) NOT NULL,
  source TEXT NOT NULL DEFAULT 'open-exchange',
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE fx_rate_snapshots IS '일별 환율 스냅샷. 랜드사 USD 결제 시 환차손익 계산에 사용';
COMMENT ON COLUMN fx_rate_snapshots.snapshot_date IS 'UTC 기준 날짜 (UNIQUE — 하루 1행)';
COMMENT ON COLUMN fx_rate_snapshots.usd_to_krw IS '1 USD = N KRW (예: 1380.50)';
COMMENT ON COLUMN fx_rate_snapshots.source IS '수집 출처: open-exchange | manual | fallback';
COMMENT ON COLUMN fx_rate_snapshots.raw IS 'API 원본 응답 JSONB (감사용)';

CREATE INDEX IF NOT EXISTS idx_fx_snapshots_date
  ON fx_rate_snapshots(snapshot_date DESC);

-- ─── [2] ledger_entries: 다중통화 컬럼 추가 ──────────────────

ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'KRW',
  ADD COLUMN IF NOT EXISTS foreign_amount NUMERIC(14,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fx_gain_loss INTEGER DEFAULT NULL;

COMMENT ON COLUMN ledger_entries.currency IS '거래 통화 코드 (KRW, USD 등). 기본값 KRW';
COMMENT ON COLUMN ledger_entries.foreign_amount IS '외화 금액 (currency != KRW 인 경우 채워짐). 예: 500.00 USD';
COMMENT ON COLUMN ledger_entries.fx_rate IS '외화 → KRW 환율 (entry 생성 시점의 스냅샷). currency=KRW 이면 NULL';
COMMENT ON COLUMN ledger_entries.fx_gain_loss IS '환차손익 (원화). 양수=환차익, 음수=환차손';

-- 외화 entry 인덱스 (분석 쿼리 최적화)
CREATE INDEX IF NOT EXISTS idx_ledger_currency
  ON ledger_entries(currency)
  WHERE currency <> 'KRW';

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '[fx-rate-ledger] fx_rate_snapshots 테이블 생성 + ledger_entries 다중통화 컬럼 추가 완료';
END $$;
