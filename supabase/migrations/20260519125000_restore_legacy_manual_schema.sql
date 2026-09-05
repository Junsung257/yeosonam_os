-- Restore schema objects that historically existed in the hosted database but
-- were created through manual/archive SQL rather than tracked migrations.
--
-- This migration is schema-only: it intentionally contains no demo rows,
-- operational settings, or automatic seed data. CREATE TABLE IF NOT EXISTS
-- keeps it safe for databases where the legacy objects already exist.

CREATE TABLE IF NOT EXISTS public.raw_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  filename TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.parsed_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_document_id UUID REFERENCES public.raw_documents(id) ON DELETE SET NULL,
  package_name TEXT,
  destination TEXT,
  origin TEXT,
  departure_start_date DATE,
  departure_end_date DATE,
  schedule JSONB,
  price_details JSONB,
  surcharge_notes JSONB,
  airline_exclusions JSONB,
  cancellation_policy TEXT,
  additional_notes TEXT,
  generated_content TEXT,
  approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.airline_exclusions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parsed_package_id UUID REFERENCES public.parsed_packages(id) ON DELETE CASCADE,
  exclusion_date DATE NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS public.package_pricings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parsed_package_id UUID REFERENCES public.parsed_packages(id) ON DELETE CASCADE,
  valid_from DATE,
  valid_to DATE,
  day_of_week TEXT,
  cost INTEGER,
  sale_price INTEGER,
  surcharge INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.surcharge_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parsed_package_id UUID REFERENCES public.parsed_packages(id) ON DELETE CASCADE,
  surcharge_date DATE NOT NULL,
  amount INTEGER NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS public.external_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parsed_package_id UUID REFERENCES public.parsed_packages(id) ON DELETE SET NULL,
  external_id TEXT,
  booking_data JSONB,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('naver', 'google', 'meta')),
  account_name TEXT NOT NULL DEFAULT '',
  current_balance INTEGER NOT NULL DEFAULT 0,
  daily_budget INTEGER NOT NULL DEFAULT 0,
  low_balance_threshold INTEGER NOT NULL DEFAULT 50000,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, account_name)
);

CREATE TABLE IF NOT EXISTS public.keyword_performances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('naver', 'google', 'meta')),
  keyword TEXT NOT NULL,
  ad_account_id UUID REFERENCES public.ad_accounts(id) ON DELETE SET NULL,
  total_spend INTEGER NOT NULL DEFAULT 0,
  total_revenue INTEGER NOT NULL DEFAULT 0,
  total_cost INTEGER NOT NULL DEFAULT 0,
  net_profit INTEGER GENERATED ALWAYS AS
    (total_revenue - total_cost - total_spend) STORED,
  roas_pct INTEGER GENERATED ALWAYS AS
    (CASE WHEN total_spend > 0 THEN total_revenue * 100 / total_spend ELSE 0 END) STORED,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'PAUSED', 'FLAGGED_UP')),
  current_bid INTEGER DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  is_longtail BOOLEAN NOT NULL DEFAULT false,
  discovered_at TIMESTAMPTZ,
  period_start DATE,
  period_end DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.qa_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  inquiry_type TEXT,
  related_packages UUID[] DEFAULT '{}',
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  answered_at TIMESTAMPTZ,
  answered_by UUID
);

CREATE TABLE IF NOT EXISTS public.ai_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id UUID REFERENCES public.qa_inquiries(id) ON DELETE CASCADE,
  response_text TEXT NOT NULL,
  ai_model TEXT,
  confidence DOUBLE PRECISION DEFAULT 0,
  used_packages UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  admin_feedback TEXT,
  approved BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.archive_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_hash TEXT UNIQUE NOT NULL,
  original_file_name TEXT NOT NULL,
  original_file_path TEXT NOT NULL,
  raw_content TEXT,
  parsed_chunks JSONB,
  metadata JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'processed'
    CHECK (status IN ('processed', 'needs_ocr')),
  parser_version TEXT DEFAULT 'v1.0-regex-only',
  sku_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.capital_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount BIGINT NOT NULL CHECK (amount > 0),
  note TEXT,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN (
      'PENDING', 'CUSTOMER_PAID', 'API_PROCESSING',
      'COMPLETED', 'PARTIAL_FAIL', 'REFUNDED'
    )),
  total_cost INTEGER NOT NULL DEFAULT 0,
  total_price INTEGER NOT NULL DEFAULT 0,
  net_margin INTEGER GENERATED ALWAYS AS (total_price - total_cost) STORED,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  saga_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  vouchers JSONB,
  tenant_cost_breakdown JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.api_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  api_name TEXT NOT NULL
    CHECK (api_name IN ('agoda_mock', 'klook_mock', 'cruise_mock', 'tenant_product')),
  product_type TEXT NOT NULL
    CHECK (product_type IN ('HOTEL', 'ACTIVITY', 'CRUISE')),
  product_category TEXT NOT NULL DEFAULT 'DYNAMIC'
    CHECK (product_category IN ('DYNAMIC', 'FIXED')),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  cost INTEGER NOT NULL,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED')),
  external_ref TEXT,
  attrs JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_seats INTEGER NOT NULL DEFAULT 0 CHECK (total_seats >= 0),
  booked_seats INTEGER NOT NULL DEFAULT 0 CHECK (booked_seats >= 0),
  available_seats INTEGER GENERATED ALWAYS AS (total_seats - booked_seats) STORED,
  price_override INTEGER,
  status TEXT DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'SOLDOUT')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (product_id, date),
  CONSTRAINT inventory_blocks_booked_lte_total CHECK (booked_seats <= total_seats)
);

CREATE TABLE IF NOT EXISTS public.margin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  base_price INTEGER NOT NULL,
  vip_margin_percent DOUBLE PRECISION DEFAULT 10,
  regular_margin_percent DOUBLE PRECISION DEFAULT 15,
  bulk_margin_percent DOUBLE PRECISION DEFAULT 20,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mileage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mileage_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('EARNED', 'USED', 'CLAWBACK')),
  margin_impact INTEGER DEFAULT 0,
  base_net_profit INTEGER DEFAULT 0,
  mileage_rate NUMERIC(5,2) DEFAULT 5.00,
  memo TEXT,
  ref_transaction_id UUID REFERENCES public.mileage_transactions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mock_api_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_name TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'success'
    CHECK (mode IN ('success', 'fail', 'timeout')),
  delay_ms INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  contact_info TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.partner_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID REFERENCES public.partners(id) ON DELETE SET NULL,
  package_pricing_id UUID REFERENCES public.package_pricings(id) ON DELETE SET NULL,
  sale_date DATE,
  sale_amount INTEGER,
  commission INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.package_score_signals (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  session_id TEXT,
  signal_type TEXT NOT NULL,
  group_key TEXT,
  rank_at_signal INTEGER,
  topsis_score_at_signal DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shared_itineraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_code TEXT NOT NULL UNIQUE,
  share_type TEXT NOT NULL CHECK (share_type IN ('DYNAMIC', 'FIXED')),
  items JSONB,
  search_query TEXT,
  product_id TEXT,
  product_name TEXT,
  review_text TEXT,
  creator_name TEXT NOT NULL DEFAULT 'anonymous',
  view_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sms_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_sms TEXT NOT NULL,
  sender_name TEXT,
  amount INTEGER,
  received_at TIMESTAMPTZ DEFAULT now(),
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  match_confidence DOUBLE PRECISION DEFAULT 0,
  source TEXT,
  status TEXT DEFAULT 'unmatched'
    CHECK (status IN ('unmatched', 'review', 'matched', 'manual')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.blog_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  scope TEXT NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'content_creatives_category_id_fkey'
      AND conrelid = 'public.content_creatives'::regclass
  ) THEN
    ALTER TABLE public.content_creatives
      ADD CONSTRAINT content_creatives_category_id_fkey
      FOREIGN KEY (category_id)
      REFERENCES public.blog_categories(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.blog_engagement_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_creative_id UUID
    REFERENCES public.content_creatives(id) ON DELETE CASCADE,
  session_id TEXT,
  user_id UUID,
  time_on_page_seconds INTEGER,
  max_scroll_depth_pct INTEGER,
  cta_clicked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.blog_search_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_creative_id UUID
    REFERENCES public.content_creatives(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  ctr DOUBLE PRECISION,
  avg_position DOUBLE PRECISION,
  top_query TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_creatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES public.ad_campaigns(id) ON DELETE SET NULL,
  landing_content_creative_id UUID
    REFERENCES public.content_creatives(id) ON DELETE SET NULL,
  creative_type TEXT NOT NULL
    CHECK (creative_type IN ('carousel', 'single_image', 'text_ad', 'short_video')),
  channel TEXT NOT NULL CHECK (channel IN ('meta', 'naver', 'google')),
  variant_index INTEGER DEFAULT 0,
  hook_type TEXT,
  tone TEXT,
  key_selling_point TEXT,
  target_segment TEXT,
  slides JSONB,
  headline TEXT,
  primary_text TEXT,
  description TEXT,
  body TEXT,
  image_url TEXT,
  keywords TEXT[],
  ad_copies JSONB,
  utm_params JSONB,
  meta_campaign_id TEXT,
  meta_adset_id TEXT,
  meta_ad_id TEXT,
  meta_creative_id TEXT,
  naver_campaign_id TEXT,
  naver_adgroup_id TEXT,
  naver_ad_id TEXT,
  google_campaign_id TEXT,
  google_adgroup_id TEXT,
  google_ad_id TEXT,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now(),
  launched_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.ad_performance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  spend_krw INTEGER DEFAULT 0,
  cpc_krw NUMERIC,
  attributed_bookings INTEGER DEFAULT 0,
  attributed_margin INTEGER DEFAULT 0,
  net_roas_pct NUMERIC,
  raw_meta_json JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (campaign_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS public.creative_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id UUID NOT NULL REFERENCES public.ad_creatives(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('meta', 'naver', 'google')),
  date DATE NOT NULL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  ctr NUMERIC(8,4),
  spend NUMERIC(10,2) DEFAULT 0,
  cpc NUMERIC(8,2),
  inquiries INTEGER DEFAULT 0,
  bookings INTEGER DEFAULT 0,
  revenue NUMERIC(12,2) DEFAULT 0,
  roas NUMERIC(8,2),
  reach INTEGER,
  frequency NUMERIC(4,2),
  video_views INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (creative_id, channel, date)
);

CREATE TABLE IF NOT EXISTS public.creative_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id UUID NOT NULL REFERENCES public.ad_creatives(id) ON DELETE CASCADE,
  slide_index INTEGER,
  field TEXT NOT NULL,
  before_value TEXT,
  after_value TEXT,
  edited_by TEXT,
  edited_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.winning_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_type TEXT,
  channel TEXT,
  target_segment TEXT,
  nights_range TEXT,
  price_range TEXT,
  hook_type TEXT,
  tone TEXT,
  key_selling_point TEXT,
  creative_type TEXT,
  avg_ctr NUMERIC(8,4),
  avg_conv_rate NUMERIC(8,4),
  avg_roas NUMERIC(8,2),
  total_spend NUMERIC(12,2),
  sample_count INTEGER DEFAULT 0,
  confidence_score NUMERIC(4,2),
  best_headline TEXT,
  best_body TEXT,
  best_hook_example TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (destination_type, channel, target_segment, hook_type, creative_type)
);

CREATE TABLE IF NOT EXISTS public.affiliate_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  channel_type VARCHAR(20) NOT NULL,
  channel_url TEXT NOT NULL,
  follower_count INTEGER,
  intro TEXT,
  business_type VARCHAR(10) NOT NULL DEFAULT 'individual'
    CHECK (business_type IN ('individual', 'business')),
  business_number VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reject_reason TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID
);

CREATE INDEX IF NOT EXISTS idx_affiliate_applications_status
  ON public.affiliate_applications(status);

CREATE INDEX IF NOT EXISTS idx_raw_documents_created_at
  ON public.raw_documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parsed_packages_raw_document_id
  ON public.parsed_packages(raw_document_id);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_platform
  ON public.ad_accounts(platform);
CREATE INDEX IF NOT EXISTS idx_keyword_performances_ad_account_id
  ON public.keyword_performances(ad_account_id);
CREATE INDEX IF NOT EXISTS idx_ai_responses_inquiry_id
  ON public.ai_responses(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_carts_session_id ON public.carts(session_id);
CREATE INDEX IF NOT EXISTS idx_api_orders_transaction_id
  ON public.api_orders(transaction_id);
CREATE INDEX IF NOT EXISTS idx_inventory_blocks_product_date
  ON public.inventory_blocks(product_id, date);
CREATE INDEX IF NOT EXISTS idx_mileage_history_customer_id
  ON public.mileage_history(customer_id);
CREATE INDEX IF NOT EXISTS idx_mileage_transactions_user_id
  ON public.mileage_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_shared_itineraries_expires_at
  ON public.shared_itineraries(expires_at);
CREATE INDEX IF NOT EXISTS idx_sms_payments_booking_id
  ON public.sms_payments(booking_id);

ALTER TABLE public.raw_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parsed_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airline_exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_pricings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surcharge_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keyword_performances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capital_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.margin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mileage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mileage_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_api_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_score_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_itineraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_engagement_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_search_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_performance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.winning_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_applications ENABLE ROW LEVEL SECURITY;
