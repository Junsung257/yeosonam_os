-- ============================================================
-- 여소남 OS — 전체 DB 마이그레이션 (한 번에 실행)
-- Supabase SQL Editor에 이 파일 전체를 붙여넣고 Run 클릭
-- ============================================================


-- ==================================================
-- [1] init.sql — travel_packages, qa_inquiries 등
-- ==================================================

CREATE TABLE IF NOT EXISTS travel_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  destination VARCHAR(255),
  duration INT,
  price INT,
  filename VARCHAR(255),
  file_type VARCHAR(20),
  raw_text TEXT,
  itinerary TEXT[] DEFAULT '{}',
  inclusions TEXT[] DEFAULT '{}',
  excludes TEXT[] DEFAULT '{}',
  accommodations TEXT[] DEFAULT '{}',
  special_notes TEXT,
  confidence FLOAT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending',
  parsed_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS qa_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  inquiry_type VARCHAR(50),
  related_packages UUID[] DEFAULT '{}',
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  customer_phone VARCHAR(20),
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  answered_at TIMESTAMP DEFAULT NULL,
  answered_by UUID
);

CREATE TABLE IF NOT EXISTS ai_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id UUID REFERENCES qa_inquiries(id) ON DELETE CASCADE,
  response_text TEXT NOT NULL,
  ai_model VARCHAR(50),
  confidence FLOAT DEFAULT 0,
  used_packages UUID[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  admin_feedback TEXT,
  approved BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS margin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID REFERENCES travel_packages(id) ON DELETE CASCADE,
  base_price INT NOT NULL,
  vip_margin_percent FLOAT DEFAULT 10,
  regular_margin_percent FLOAT DEFAULT 15,
  bulk_margin_percent FLOAT DEFAULT 20,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  api_endpoint VARCHAR(500),
  api_key VARCHAR(500),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_packages_status ON travel_packages(status);
CREATE INDEX IF NOT EXISTS idx_packages_destination ON travel_packages(destination);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON qa_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_created_at ON qa_inquiries(created_at);
CREATE INDEX IF NOT EXISTS idx_responses_inquiry_id ON ai_responses(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_responses_created_at ON ai_responses(created_at);


-- ==================================================
-- [2] crm.sql — customers, bookings, mileage_history
-- ==================================================

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  passport_no TEXT,
  passport_expiry DATE,
  birth_date DATE,
  mileage INTEGER DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  memo TEXT,
  total_spent INTEGER DEFAULT 0,
  booking_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_no TEXT UNIQUE NOT NULL DEFAULT '',
  package_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,
  package_title TEXT,
  lead_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  adult_count INTEGER DEFAULT 1,
  child_count INTEGER DEFAULT 0,
  adult_cost INTEGER DEFAULT 0,
  adult_price INTEGER DEFAULT 0,
  child_cost INTEGER DEFAULT 0,
  child_price INTEGER DEFAULT 0,
  fuel_surcharge INTEGER DEFAULT 0,
  total_cost INTEGER GENERATED ALWAYS AS (
    (adult_count * adult_cost) + (child_count * child_cost) + fuel_surcharge
  ) STORED,
  total_price INTEGER GENERATED ALWAYS AS (
    (adult_count * adult_price) + (child_count * child_price) + fuel_surcharge
  ) STORED,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','completed','cancelled')),
  departure_date DATE,
  notes TEXT,
  payment_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS booking_passengers (
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  PRIMARY KEY (booking_id, customer_id)
);

CREATE TABLE IF NOT EXISTS mileage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO app_settings (key, value) VALUES
  ('commission_rate', '{"rate": 9}'),
  ('vacation_mode', '{"enabled": false, "start": null, "end": null, "message": ""}'),
  ('mileage_event', '{"enabled": false, "name": "", "start": null, "end": null, "bonus_rate": 0}'),
  ('mileage_base_rate', '{"rate": 1}')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION generate_booking_no()
RETURNS TRIGGER AS $$
DECLARE
  next_no INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(booking_no FROM 4) AS INTEGER)), 0) + 1
  INTO next_no
  FROM bookings;
  NEW.booking_no := 'BK-' || LPAD(next_no::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_booking_no ON bookings;
CREATE TRIGGER set_booking_no
  BEFORE INSERT ON bookings
  FOR EACH ROW
  WHEN (NEW.booking_no IS NULL OR NEW.booking_no = '')
  EXECUTE FUNCTION generate_booking_no();


-- ==================================================
-- [3] saas_marketplace_v1.sql — tenants, inventory_blocks
-- ==================================================

CREATE TABLE IF NOT EXISTS tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  contact_name    TEXT,
  contact_phone   TEXT,
  contact_email   TEXT,
  commission_rate NUMERIC(5,2) DEFAULT 18.00,
  status          TEXT DEFAULT 'active'
    CHECK (status IN ('active','inactive','suspended')),
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

INSERT INTO tenants (name, contact_name, contact_phone, commission_rate, description) VALUES
  ('가나다 투어',    '김가나', '051-000-0001', 20.00, '동남아 전문 랜드사'),
  ('썬샤인 여행사',  '이선샤', '02-000-0002',  18.00, '일본/유럽 패키지 전문'),
  ('프리미엄 크루즈','박프리', '032-000-0003', 22.00, '지중해/알래스카 크루즈 전문')
ON CONFLICT DO NOTHING;

ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS tenant_id   UUID REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_price  INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_packages_tenant ON travel_packages(tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_blocks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES travel_packages(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  total_seats     INTEGER NOT NULL DEFAULT 0 CHECK (total_seats >= 0),
  booked_seats    INTEGER NOT NULL DEFAULT 0 CHECK (booked_seats >= 0),
  available_seats INTEGER GENERATED ALWAYS AS (total_seats - booked_seats) STORED,
  price_override  INTEGER,
  status          TEXT DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','CLOSED','SOLDOUT')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (product_id, date),
  CONSTRAINT booked_lte_total CHECK (booked_seats <= total_seats)
);
CREATE INDEX IF NOT EXISTS idx_inventory_product_date ON inventory_blocks(product_id, date);
CREATE INDEX IF NOT EXISTS idx_inventory_tenant        ON inventory_blocks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_available     ON inventory_blocks(available_seats) WHERE available_seats > 0;


-- ==================================================
-- [4] concierge_v1.sql — carts, transactions, api_orders
-- ==================================================

CREATE TABLE IF NOT EXISTS mock_api_configs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_name    TEXT NOT NULL UNIQUE,
  mode        TEXT NOT NULL DEFAULT 'success'
              CHECK (mode IN ('success','fail','timeout')),
  delay_ms    INTEGER DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO mock_api_configs (api_name, mode, delay_ms) VALUES
  ('agoda_mock',  'success', 0),
  ('klook_mock',  'success', 0),
  ('cruise_mock', 'success', 0)
ON CONFLICT (api_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS carts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT NOT NULL,
  items       JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carts_session ON carts(session_id);

CREATE TABLE IF NOT EXISTS transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key   TEXT NOT NULL UNIQUE,
  session_id        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN (
      'PENDING','CUSTOMER_PAID','API_PROCESSING',
      'COMPLETED','PARTIAL_FAIL','REFUNDED'
    )),
  total_cost        INTEGER NOT NULL DEFAULT 0,
  total_price       INTEGER NOT NULL DEFAULT 0,
  net_margin        INTEGER GENERATED ALWAYS AS (total_price - total_cost) STORED,
  customer_name     TEXT,
  customer_phone    TEXT,
  customer_email    TEXT,
  saga_log          JSONB NOT NULL DEFAULT '[]',
  vouchers          JSONB,
  tenant_cost_breakdown JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transactions_session  ON transactions(session_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status   ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created  ON transactions(created_at DESC);

CREATE TABLE IF NOT EXISTS api_orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  api_name       TEXT NOT NULL
    CHECK (api_name IN ('agoda_mock','klook_mock','cruise_mock','tenant_product')),
  product_type   TEXT NOT NULL
    CHECK (product_type IN ('HOTEL','ACTIVITY','CRUISE')),
  product_id     TEXT NOT NULL,
  product_name   TEXT NOT NULL,
  cost           INTEGER NOT NULL,
  price          INTEGER NOT NULL,
  quantity       INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','CONFIRMED','CANCELLED','REFUNDED')),
  external_ref   TEXT,
  attrs          JSONB,
  tenant_id      UUID REFERENCES tenants(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_orders_txn ON api_orders(transaction_id);

ALTER TABLE api_orders
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;


-- ==================================================
-- [5] payments.sql — sms_payments
-- ==================================================

CREATE TABLE IF NOT EXISTS sms_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_sms TEXT NOT NULL,
  sender_name TEXT,
  amount INTEGER,
  received_at TIMESTAMPTZ DEFAULT now(),
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  match_confidence FLOAT DEFAULT 0,
  status TEXT DEFAULT 'unmatched'
    CHECK (status IN ('unmatched', 'review', 'matched', 'manual')),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sms_payments_status   ON sms_payments(status);
CREATE INDEX IF NOT EXISTS idx_sms_payments_received ON sms_payments(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_payments_booking  ON sms_payments(booking_id);


-- ==================================================
-- [6] ad_tracking_v1.sql — 광고 세션 추적 4개 테이블
-- ==================================================

CREATE TABLE IF NOT EXISTS ad_traffic_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      TEXT NOT NULL,
  user_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  source          TEXT,
  medium          TEXT,
  campaign_name   TEXT,
  keyword         TEXT,
  gclid           TEXT,
  fbclid          TEXT,
  n_keyword       TEXT,
  current_cpc     INTEGER,
  consent_agreed  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_traffic_session ON ad_traffic_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_traffic_user    ON ad_traffic_logs(user_id)  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_traffic_gclid   ON ad_traffic_logs(gclid)   WHERE gclid   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_traffic_fbclid  ON ad_traffic_logs(fbclid)  WHERE fbclid  IS NOT NULL;

CREATE TABLE IF NOT EXISTS ad_search_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       TEXT NOT NULL,
  user_id          UUID REFERENCES customers(id) ON DELETE SET NULL,
  search_query     TEXT,
  search_category  TEXT,
  result_count     INTEGER DEFAULT 0,
  lead_time_days   INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_search_session ON ad_search_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_search_user    ON ad_search_logs(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ad_engagement_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      TEXT NOT NULL,
  user_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,
  product_id      TEXT,
  product_name    TEXT,
  cart_added      BOOLEAN NOT NULL DEFAULT FALSE,
  page_url        TEXT,
  lead_time_days  INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_engagement_session    ON ad_engagement_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_engagement_event_type ON ad_engagement_logs(event_type);

CREATE TABLE IF NOT EXISTS ad_conversion_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          TEXT NOT NULL,
  user_id             UUID REFERENCES customers(id) ON DELETE SET NULL,
  final_booking_id    UUID REFERENCES bookings(id) ON DELETE SET NULL,
  final_sales_price   INTEGER NOT NULL DEFAULT 0,
  base_cost           INTEGER NOT NULL DEFAULT 0,
  allocated_ad_spend  INTEGER NOT NULL DEFAULT 0,
  net_profit          INTEGER GENERATED ALWAYS AS
                        (final_sales_price - base_cost - allocated_ad_spend) STORED,
  attributed_source   TEXT,
  attributed_gclid    TEXT,
  attributed_fbclid   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversion_session    ON ad_conversion_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_conversion_booking    ON ad_conversion_logs(final_booking_id) WHERE final_booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversion_attributed ON ad_conversion_logs(attributed_source);


-- ==================================================
-- [7] group_rfq_v1.sql — 단체 RFQ 5개 테이블
-- ==================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'BRONZE'
    CHECK (tier IN ('GOLD','SILVER','BRONZE')),
  ADD COLUMN IF NOT EXISTS reliability_score INTEGER NOT NULL DEFAULT 100;

CREATE INDEX IF NOT EXISTS idx_tenants_tier ON tenants(tier);

CREATE TABLE IF NOT EXISTS group_rfqs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_code             TEXT UNIQUE NOT NULL,
  customer_id          UUID REFERENCES customers(id),
  customer_name        TEXT NOT NULL,
  customer_phone       TEXT,
  destination          TEXT NOT NULL,
  departure_date_from  DATE,
  departure_date_to    DATE,
  duration_nights      INTEGER,
  adult_count          INTEGER NOT NULL DEFAULT 1,
  child_count          INTEGER NOT NULL DEFAULT 0,
  budget_per_person    INTEGER,
  total_budget         INTEGER,
  hotel_grade          TEXT,
  meal_plan            TEXT,
  transportation       TEXT,
  special_requests     TEXT,
  custom_requirements  JSONB DEFAULT '{}',
  status               TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft','published','bidding','analyzing',
      'awaiting_selection','contracted','completed','cancelled'
    )),
  published_at         TIMESTAMPTZ,
  gold_unlock_at       TIMESTAMPTZ,
  silver_unlock_at     TIMESTAMPTZ,
  bronze_unlock_at     TIMESTAMPTZ,
  bid_deadline         TIMESTAMPTZ,
  max_proposals        INTEGER NOT NULL DEFAULT 5,
  selected_proposal_id UUID,
  ai_interview_log     JSONB DEFAULT '[]',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rfqs_status    ON group_rfqs(status);
CREATE INDEX IF NOT EXISTS idx_rfqs_customer  ON group_rfqs(customer_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_published ON group_rfqs(published_at) WHERE status != 'draft';

CREATE TABLE IF NOT EXISTS rfq_bids (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id           UUID NOT NULL REFERENCES group_rfqs(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  status           TEXT NOT NULL DEFAULT 'locked'
    CHECK (status IN ('locked','submitted','selected','rejected','timeout','withdrawn')),
  locked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  submit_deadline  TIMESTAMPTZ NOT NULL,
  submitted_at     TIMESTAMPTZ,
  is_penalized     BOOLEAN NOT NULL DEFAULT FALSE,
  penalty_reason   TEXT,
  UNIQUE (rfq_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_bids_rfq      ON rfq_bids(rfq_id);
CREATE INDEX IF NOT EXISTS idx_bids_tenant   ON rfq_bids(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bids_deadline ON rfq_bids(submit_deadline) WHERE status = 'locked';

CREATE TABLE IF NOT EXISTS rfq_proposals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id               UUID NOT NULL REFERENCES group_rfqs(id) ON DELETE CASCADE,
  bid_id               UUID NOT NULL REFERENCES rfq_bids(id),
  tenant_id            UUID NOT NULL REFERENCES tenants(id),
  proposal_title       TEXT,
  itinerary_summary    TEXT,
  total_cost           INTEGER NOT NULL,
  total_selling_price  INTEGER NOT NULL,
  hidden_cost_estimate INTEGER NOT NULL DEFAULT 0,
  real_total_price     INTEGER,
  checklist            JSONB NOT NULL DEFAULT '{}',
  checklist_completed  BOOLEAN NOT NULL DEFAULT FALSE,
  ai_review            JSONB,
  ai_reviewed_at       TIMESTAMPTZ,
  rank                 INTEGER,
  status               TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','reviewing','approved','selected','rejected')),
  submitted_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proposals_rfq    ON rfq_proposals(rfq_id);
CREATE INDEX IF NOT EXISTS idx_proposals_tenant ON rfq_proposals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_proposals_rank   ON rfq_proposals(rfq_id, rank) WHERE rank IS NOT NULL;

ALTER TABLE group_rfqs
  ADD CONSTRAINT fk_rfqs_selected_proposal
  FOREIGN KEY (selected_proposal_id)
  REFERENCES rfq_proposals(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS rfq_messages (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id                 UUID NOT NULL REFERENCES group_rfqs(id) ON DELETE CASCADE,
  proposal_id            UUID REFERENCES rfq_proposals(id),
  sender_type            TEXT NOT NULL
    CHECK (sender_type IN ('customer','tenant','ai','system')),
  sender_id              TEXT,
  raw_content            TEXT NOT NULL,
  processed_content      TEXT,
  pii_detected           BOOLEAN NOT NULL DEFAULT FALSE,
  pii_blocked            BOOLEAN NOT NULL DEFAULT FALSE,
  recipient_type         TEXT NOT NULL
    CHECK (recipient_type IN ('customer','tenant','admin')),
  is_visible_to_customer BOOLEAN NOT NULL DEFAULT TRUE,
  is_visible_to_tenant   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rfq_messages_rfq      ON rfq_messages(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_messages_proposal ON rfq_messages(proposal_id) WHERE proposal_id IS NOT NULL;

-- 테넌트 티어 씨드 (기존 테넌트가 있으면 적용)
DO $$
BEGIN
  UPDATE tenants SET tier = 'GOLD'   WHERE id = (SELECT id FROM tenants ORDER BY created_at LIMIT 1);
  UPDATE tenants SET tier = 'SILVER' WHERE id = (SELECT id FROM tenants ORDER BY created_at OFFSET 1 LIMIT 1);
  UPDATE tenants SET tier = 'BRONZE' WHERE id = (SELECT id FROM tenants ORDER BY created_at OFFSET 2 LIMIT 1);
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;


-- ==================================================
-- [8] secure_chat_voucher_v1.sql — 안심채팅 + 확정서
-- ==================================================

CREATE TABLE IF NOT EXISTS secure_chats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID REFERENCES bookings(id)    ON DELETE CASCADE,
  rfq_id          UUID REFERENCES group_rfqs(id)  ON DELETE CASCADE,
  sender_type     TEXT NOT NULL CHECK (sender_type IN ('customer','land_agency','system')),
  sender_id       TEXT NOT NULL,
  receiver_type   TEXT NOT NULL CHECK (receiver_type IN ('customer','land_agency','admin')),
  raw_message     TEXT NOT NULL,
  masked_message  TEXT NOT NULL,
  is_filtered     BOOLEAN NOT NULL DEFAULT FALSE,
  filter_detail   TEXT,
  is_unmasked     BOOLEAN NOT NULL DEFAULT FALSE,
  unmasked_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_secure_chat_booking ON secure_chats(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_secure_chat_rfq     ON secure_chats(rfq_id)     WHERE rfq_id     IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_secure_chat_sender  ON secure_chats(sender_id);

CREATE TABLE IF NOT EXISTS vouchers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID REFERENCES bookings(id)    ON DELETE SET NULL,
  rfq_id          UUID REFERENCES group_rfqs(id)  ON DELETE SET NULL,
  customer_id     UUID REFERENCES customers(id)   ON DELETE SET NULL,
  land_agency_id  UUID REFERENCES tenants(id)     ON DELETE SET NULL,
  parsed_data     JSONB NOT NULL DEFAULT '{}',
  upsell_data     JSONB NOT NULL DEFAULT '[]',
  pdf_url         TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','issued','sent','cancelled')),
  issued_at       TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  end_date        DATE,
  review_notified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voucher_booking  ON vouchers(booking_id)  WHERE booking_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voucher_rfq      ON vouchers(rfq_id)      WHERE rfq_id      IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voucher_customer ON vouchers(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voucher_status   ON vouchers(status);
CREATE INDEX IF NOT EXISTS idx_voucher_end_date ON vouchers(end_date)    WHERE review_notified = FALSE;


-- ==================================================
-- [9] ad_marketing_mileage_v1.sql — 광고계정 + 마일리지
-- ==================================================

CREATE TABLE IF NOT EXISTS ad_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform              TEXT NOT NULL CHECK (platform IN ('naver','google','meta')),
  account_name          TEXT NOT NULL DEFAULT '',
  current_balance       INTEGER NOT NULL DEFAULT 0,
  daily_budget          INTEGER NOT NULL DEFAULT 0,
  low_balance_threshold INTEGER NOT NULL DEFAULT 50000,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(platform, account_name)
);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_platform ON ad_accounts(platform);

CREATE TABLE IF NOT EXISTS keyword_performances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        TEXT NOT NULL CHECK (platform IN ('naver','google','meta')),
  keyword         TEXT NOT NULL,
  ad_account_id   UUID REFERENCES ad_accounts(id) ON DELETE SET NULL,
  total_spend     INTEGER NOT NULL DEFAULT 0,
  total_revenue   INTEGER NOT NULL DEFAULT 0,
  total_cost      INTEGER NOT NULL DEFAULT 0,
  net_profit      INTEGER GENERATED ALWAYS AS
                    (total_revenue - total_cost - total_spend) STORED,
  roas_pct        INTEGER GENERATED ALWAYS AS
                    (CASE WHEN total_spend > 0
                      THEN (total_revenue * 100 / total_spend)
                      ELSE 0
                    END) STORED,
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','PAUSED','FLAGGED_UP')),
  current_bid     INTEGER DEFAULT 0,
  clicks          INTEGER NOT NULL DEFAULT 0,
  impressions     INTEGER NOT NULL DEFAULT 0,
  conversions     INTEGER NOT NULL DEFAULT 0,
  is_longtail     BOOLEAN NOT NULL DEFAULT FALSE,
  discovered_at   TIMESTAMPTZ,
  period_start    DATE,
  period_end      DATE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kw_platform   ON keyword_performances(platform);
CREATE INDEX IF NOT EXISTS idx_kw_status     ON keyword_performances(status);
CREATE INDEX IF NOT EXISTS idx_kw_roas       ON keyword_performances(roas_pct);
CREATE INDEX IF NOT EXISTS idx_kw_net_profit ON keyword_performances(net_profit);

CREATE TABLE IF NOT EXISTS mileage_transactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  booking_id         UUID REFERENCES bookings(id) ON DELETE SET NULL,
  amount             INTEGER NOT NULL,
  type               TEXT NOT NULL CHECK (type IN ('EARNED','USED','CLAWBACK')),
  margin_impact      INTEGER DEFAULT 0,
  base_net_profit    INTEGER DEFAULT 0,
  mileage_rate       NUMERIC(5,2) DEFAULT 5.00,
  memo               TEXT,
  ref_transaction_id UUID REFERENCES mileage_transactions(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mileage_user    ON mileage_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_mileage_booking ON mileage_transactions(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mileage_type    ON mileage_transactions(type);

CREATE OR REPLACE VIEW customer_mileage_balances AS
SELECT
  user_id,
  SUM(amount) AS balance,
  SUM(CASE WHEN type = 'EARNED'   THEN amount ELSE 0 END) AS total_earned,
  SUM(CASE WHEN type = 'USED'     THEN ABS(amount) ELSE 0 END) AS total_used,
  SUM(CASE WHEN type = 'CLAWBACK' THEN ABS(amount) ELSE 0 END) AS total_clawback,
  COUNT(*) AS transaction_count,
  MAX(created_at) AS last_transaction_at
FROM mileage_transactions
GROUP BY user_id;


-- ==================================================
-- [10] fit_package_v1.sql — product_category + 공유 테이블
-- ==================================================

ALTER TABLE api_orders
  ADD COLUMN IF NOT EXISTS product_category TEXT NOT NULL DEFAULT 'DYNAMIC'
  CHECK (product_category IN ('DYNAMIC','FIXED'));

UPDATE api_orders SET product_category = 'FIXED'
  WHERE api_name = 'tenant_product';

UPDATE api_orders SET product_category = 'DYNAMIC'
  WHERE api_name IN ('agoda_mock','klook_mock','cruise_mock');

CREATE INDEX IF NOT EXISTS idx_api_orders_category ON api_orders(product_category);

CREATE TABLE IF NOT EXISTS shared_itineraries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_code    TEXT NOT NULL UNIQUE,
  share_type    TEXT NOT NULL CHECK (share_type IN ('DYNAMIC','FIXED')),
  items         JSONB,
  search_query  TEXT,
  product_id    TEXT,
  product_name  TEXT,
  review_text   TEXT,
  creator_name  TEXT NOT NULL DEFAULT '익명',
  view_count    INTEGER NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shared_itineraries_code    ON shared_itineraries(share_code);
CREATE INDEX IF NOT EXISTS idx_shared_itineraries_expires ON shared_itineraries(expires_at);
CREATE INDEX IF NOT EXISTS idx_shared_itineraries_type    ON shared_itineraries(share_type);


-- ============================================================
-- 완료! 총 테이블 수:
--   travel_packages, qa_inquiries, ai_responses, margin_settings, partners
--   customers, bookings, booking_passengers, mileage_history, app_settings
--   tenants, inventory_blocks
--   mock_api_configs, carts, transactions, api_orders
--   sms_payments
--   ad_traffic_logs, ad_search_logs, ad_engagement_logs, ad_conversion_logs
--   group_rfqs, rfq_bids, rfq_proposals, rfq_messages
--   secure_chats, vouchers
--   ad_accounts, keyword_performances, mileage_transactions
--   shared_itineraries
-- ============================================================
