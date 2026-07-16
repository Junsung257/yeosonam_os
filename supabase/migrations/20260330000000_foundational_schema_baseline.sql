-- Foundational schema baseline for databases created from an empty volume.
--
-- This migration is intentionally versioned before the repository's first
-- tracked migration (20260331000000). The original schema was created through
-- legacy SQL files before Supabase migration tracking began. Only the schema
-- objects required by tracked migrations belong here; legacy demo/operating
-- rows and scheduled jobs are deliberately excluded.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  commission_rate NUMERIC(5,2) DEFAULT 18.00,
  tier TEXT NOT NULL DEFAULT 'BRONZE'
    CHECK (tier IN ('GOLD', 'SILVER', 'BRONZE')),
  reliability_score INTEGER NOT NULL DEFAULT 100,
  status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended')),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.os_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL
    CHECK (category IN (
      'pricing', 'mileage', 'booking', 'notification', 'display',
      'product', 'operations', 'marketing', 'saas'
    )),
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL DEFAULT 'condition'
    CHECK (trigger_type IN ('condition', 'schedule', 'event', 'cron', 'always')),
  trigger_config JSONB DEFAULT '{}'::jsonb,
  action_type TEXT NOT NULL,
  action_config JSONB DEFAULT '{}'::jsonb,
  target_scope JSONB DEFAULT '{}'::jsonb,
  starts_at TIMESTAMPTZ DEFAULT now(),
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 100,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_os_policies_category
  ON public.os_policies(category);
CREATE INDEX IF NOT EXISTS idx_os_policies_active
  ON public.os_policies(is_active);

CREATE TABLE IF NOT EXISTS public.land_operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  contact TEXT,
  regions TEXT[] DEFAULT '{}',
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_land_operators_name
  ON public.land_operators(name);

CREATE TABLE IF NOT EXISTS public.departing_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  agent_type TEXT NOT NULL,
  action_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT NOT NULL DEFAULT 'jarvis',
  reviewed_by TEXT,
  reject_reason TEXT,
  result_log TEXT,
  idempotency_key TEXT,
  resolved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_status_created
  ON public.agent_actions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.travel_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  destination VARCHAR(255),
  country VARCHAR(50),
  nights INTEGER,
  duration INTEGER,
  price INTEGER,
  avg_rating NUMERIC(3,2),
  review_count INTEGER NOT NULL DEFAULT 0,
  filename VARCHAR(255),
  file_type VARCHAR(20),
  raw_text TEXT,
  parsed_data JSONB,
  raw_text_hash VARCHAR(64),
  itinerary TEXT[] DEFAULT '{}',
  itinerary_data JSONB,
  price_tiers JSONB DEFAULT '[]'::jsonb,
  price_dates JSONB DEFAULT '[]'::jsonb,
  category TEXT DEFAULT 'package',
  product_type TEXT,
  trip_style TEXT,
  departure_days TEXT,
  departure_airport TEXT DEFAULT '부산(김해)',
  airline TEXT,
  min_participants INTEGER DEFAULT 4,
  ticketing_deadline DATE,
  guide_tip TEXT,
  single_supplement TEXT,
  small_group_surcharge TEXT,
  surcharges JSONB DEFAULT '[]'::jsonb,
  excluded_dates TEXT[] DEFAULT '{}',
  optional_tours JSONB DEFAULT '[]'::jsonb,
  cancellation_policy JSONB,
  category_attrs JSONB DEFAULT '{}'::jsonb,
  land_operator TEXT,
  product_tags TEXT[] DEFAULT '{}',
  product_highlights TEXT[] DEFAULT '{}',
  product_summary TEXT,
  commission_rate NUMERIC(5,2),
  marketing_copies JSONB DEFAULT '[]'::jsonb,
  internal_code VARCHAR,
  short_code VARCHAR(20) UNIQUE,
  inclusions TEXT[] DEFAULT '{}',
  excludes TEXT[] DEFAULT '{}',
  accommodations TEXT[] DEFAULT '{}',
  special_notes TEXT,
  confidence DOUBLE PRECISION DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending',
  parsed_at TIMESTAMP DEFAULT now(),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  created_by UUID,
  notes TEXT,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  departing_location_id UUID REFERENCES public.departing_locations(id) ON DELETE SET NULL,
  cost_price INTEGER DEFAULT 0,
  land_operator_id UUID REFERENCES public.land_operators(id) ON DELETE SET NULL,
  seats_held INTEGER DEFAULT 0,
  seats_confirmed INTEGER DEFAULT 0,
  seats_ticketed INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_packages_status
  ON public.travel_packages(status);
CREATE INDEX IF NOT EXISTS idx_packages_destination
  ON public.travel_packages(destination);
CREATE INDEX IF NOT EXISTS idx_packages_tenant
  ON public.travel_packages(tenant_id) WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ad_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  meta_campaign_id TEXT,
  meta_adset_id TEXT,
  meta_ad_id TEXT,
  naver_campaign_id TEXT,
  naver_adgroup_id TEXT,
  naver_ad_id TEXT,
  google_campaign_id TEXT,
  google_adgroup_id TEXT,
  google_ad_id TEXT,
  name TEXT NOT NULL,
  channel TEXT DEFAULT 'meta'
    CHECK (channel IN ('meta', 'naver', 'google')),
  status TEXT DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')),
  objective TEXT DEFAULT 'LINK_CLICKS'
    CHECK (objective IN ('LINK_CLICKS', 'CONVERSIONS', 'REACH', 'BRAND_AWARENESS')),
  daily_budget_krw INTEGER DEFAULT 0,
  total_spend_krw INTEGER DEFAULT 0,
  started_at DATE,
  ended_at DATE,
  auto_pause_reason TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_package
  ON public.ad_campaigns(package_id);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_status
  ON public.ad_campaigns(status);

CREATE TABLE IF NOT EXISTS public.card_news (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  package_id UUID REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES public.ad_campaigns(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'CONFIRMED', 'LAUNCHED', 'ARCHIVED')),
  slides JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta_creative_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_card_news_package
  ON public.card_news(package_id);
CREATE INDEX IF NOT EXISTS idx_card_news_status
  ON public.card_news(status);

CREATE TABLE IF NOT EXISTS public.attractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  short_desc TEXT,
  country TEXT,
  region TEXT,
  category TEXT DEFAULT 'sightseeing'
    CHECK (category IN (
      'sightseeing', 'temple', 'market', 'museum', 'nature', 'palace',
      'shopping', 'entertainment', 'park', 'beach', 'cultural'
    )),
  emoji TEXT,
  mention_count INTEGER DEFAULT 1,
  is_special BOOLEAN DEFAULT false,
  aliases TEXT[] DEFAULT '{}',
  photos JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attractions_name
  ON public.attractions(name);
CREATE INDEX IF NOT EXISTS idx_attractions_country
  ON public.attractions(country);

CREATE TABLE IF NOT EXISTS public.unmatched_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity TEXT NOT NULL,
  package_id UUID,
  package_title TEXT,
  day_number INTEGER,
  country TEXT,
  region TEXT,
  occurrence_count INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'ignored', 'added')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unmatched_activity
  ON public.unmatched_activities(activity);
CREATE INDEX IF NOT EXISTS idx_unmatched_status
  ON public.unmatched_activities(status);

CREATE TABLE IF NOT EXISTS public.content_creatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  product_id UUID REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  title TEXT,
  description TEXT,
  angle_type TEXT NOT NULL DEFAULT 'emotional'
    CHECK (angle_type IN ('value', 'emotional', 'filial', 'luxury', 'urgency', 'activity', 'food')),
  target_audience TEXT,
  channel TEXT NOT NULL DEFAULT 'instagram_card'
    CHECK (channel IN (
      'instagram_card', 'instagram_reel', 'naver_blog',
      'google_search', 'youtube_short', 'kakao'
    )),
  image_ratio TEXT DEFAULT '1:1'
    CHECK (image_ratio IN ('1:1', '4:5', '9:16', '16:9')),
  slides JSONB DEFAULT '[]'::jsonb,
  blog_html TEXT,
  seo_title TEXT,
  seo_description TEXT,
  og_image_url TEXT,
  slug TEXT,
  destination TEXT,
  category TEXT,
  category_id UUID,
  content_type TEXT,
  sub_keyword TEXT,
  target_ad_keywords TEXT[],
  featured BOOLEAN NOT NULL DEFAULT false,
  featured_order INTEGER,
  landing_enabled BOOLEAN NOT NULL DEFAULT false,
  landing_headline TEXT,
  landing_subtitle TEXT,
  pillar_for TEXT,
  ad_copy JSONB,
  tracking_id TEXT UNIQUE,
  tone TEXT DEFAULT 'professional',
  extra_prompt TEXT,
  status TEXT DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'published', 'archived', 'failed', 'skipped')),
  publish_scheduled_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  quality_gate JSONB DEFAULT '{}'::jsonb,
  readability_score NUMERIC,
  readability_issues JSONB,
  prompt_version TEXT DEFAULT 'v1.0',
  ai_model TEXT,
  ai_temperature NUMERIC,
  generation_params JSONB,
  topic_source TEXT,
  generation_meta JSONB DEFAULT '{}'::jsonb,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cc_product
  ON public.content_creatives(product_id);
CREATE INDEX IF NOT EXISTS idx_cc_channel
  ON public.content_creatives(channel);
CREATE INDEX IF NOT EXISTS idx_cc_status
  ON public.content_creatives(status);

CREATE TABLE IF NOT EXISTS public.content_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id UUID REFERENCES public.content_creatives(id) ON DELETE CASCADE,
  tenant_id UUID,
  date DATE NOT NULL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  ctr NUMERIC(6,2) DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  spend INTEGER DEFAULT 0,
  cpa INTEGER DEFAULT 0,
  roas NUMERIC(8,2) DEFAULT 0,
  platform_raw JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (creative_id, date)
);

CREATE TABLE IF NOT EXISTS public.content_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  destination TEXT NOT NULL,
  angle_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  target_audience TEXT,
  avg_ctr NUMERIC(6,2) DEFAULT 0,
  avg_conversions NUMERIC(8,2) DEFAULT 0,
  avg_cpa NUMERIC(10,2) DEFAULT 0,
  sample_count INTEGER DEFAULT 0,
  confidence_score NUMERIC(4,2) DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_unique
  ON public.content_insights(destination, angle_type, channel, COALESCE(target_audience, ''));

CREATE TABLE IF NOT EXISTS public.blog_topic_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  source TEXT NOT NULL
    CHECK (source IN ('seasonal', 'coverage_gap', 'user_seed', 'product')),
  priority INTEGER NOT NULL DEFAULT 50,
  destination TEXT,
  angle_type TEXT,
  product_id UUID REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  category TEXT,
  target_publish_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'generating', 'published', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  content_creative_id UUID REFERENCES public.content_creatives(id) ON DELETE SET NULL,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_btq_status
  ON public.blog_topic_queue(status);
CREATE INDEX IF NOT EXISTS idx_btq_target
  ON public.blog_topic_queue(target_publish_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_btq_priority
  ON public.blog_topic_queue(priority DESC);

CREATE TABLE IF NOT EXISTS public.prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  version TEXT NOT NULL,
  content TEXT NOT NULL,
  change_notes TEXT,
  source TEXT DEFAULT 'manual',
  source_action_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT false,
  activated_at TIMESTAMPTZ,
  performance_baseline JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (domain, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pv_one_active_per_domain
  ON public.prompt_versions(domain) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.blog_seasonal_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month TEXT NOT NULL,
  topic TEXT NOT NULL,
  keywords TEXT[] DEFAULT '{}'::text[],
  destination TEXT,
  season_tag TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used BOOLEAN NOT NULL DEFAULT false,
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.free_travel_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination TEXT NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  departure TEXT NOT NULL DEFAULT '부산',
  pax_adults INTEGER NOT NULL DEFAULT 2,
  pax_children INTEGER NOT NULL DEFAULT 0,
  customer_name TEXT,
  customer_phone TEXT,
  source TEXT NOT NULL DEFAULT 'web',
  plan_json JSONB,
  plan_expires_at TIMESTAMPTZ,
  converted_to_package_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  passport_no TEXT,
  passport_expiry DATE,
  birth_date DATE,
  mileage INTEGER DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  memo TEXT,
  total_spent INTEGER DEFAULT 0,
  booking_count INTEGER DEFAULT 0,
  grade TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  channel VARCHAR DEFAULT 'phone',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_notes_customer
  ON public.customer_notes(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_no TEXT UNIQUE NOT NULL DEFAULT '',
  package_id UUID REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  package_title TEXT,
  lead_customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  adult_count INTEGER DEFAULT 1,
  child_count INTEGER DEFAULT 0,
  adult_cost INTEGER DEFAULT 0,
  adult_price INTEGER DEFAULT 0,
  child_cost INTEGER DEFAULT 0,
  child_price INTEGER DEFAULT 0,
  child_n_count INTEGER DEFAULT 0,
  child_n_cost INTEGER DEFAULT 0,
  child_n_price INTEGER DEFAULT 0,
  child_e_count INTEGER DEFAULT 0,
  child_e_cost INTEGER DEFAULT 0,
  child_e_price INTEGER DEFAULT 0,
  infant_count INTEGER DEFAULT 0,
  infant_cost INTEGER DEFAULT 0,
  infant_price INTEGER DEFAULT 0,
  fuel_surcharge INTEGER DEFAULT 0,
  -- Persisted snapshots: booking creation writes totals that include all
  -- passenger bands, single charges, discounts, and later adjustments.
  total_cost INTEGER DEFAULT 0,
  total_price INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'confirmed', 'completed', 'cancelled',
      'waiting_deposit', 'deposit_paid', 'waiting_balance', 'fully_paid'
    )),
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  departure_date DATE,
  notes TEXT,
  payment_date TIMESTAMPTZ,
  booking_type TEXT DEFAULT 'DIRECT'
    CHECK (booking_type IN ('DIRECT', 'AFFILIATE')),
  affiliate_id UUID,
  cost_snapshot_krw INTEGER DEFAULT 0,
  applied_total_commission_rate NUMERIC(5,3) DEFAULT 0,
  influencer_commission INTEGER DEFAULT 0,
  margin INTEGER DEFAULT 0,
  return_date DATE,
  booking_date DATE DEFAULT CURRENT_DATE,
  departure_region TEXT,
  land_operator TEXT,
  local_expenses JSONB DEFAULT '{}'::jsonb,
  single_charge INTEGER DEFAULT 0,
  single_charge_count INTEGER DEFAULT 0,
  flight_out TEXT,
  flight_out_time TEXT,
  flight_in TEXT,
  flight_in_time TEXT,
  is_ticketed BOOLEAN DEFAULT false,
  is_manifest_sent BOOLEAN DEFAULT false,
  is_guide_notified BOOLEAN DEFAULT false,
  paid_amount INTEGER DEFAULT 0,
  total_paid_out INTEGER DEFAULT 0,
  payment_status TEXT DEFAULT '미입금',
  actual_payer_name TEXT,
  land_operator_id UUID REFERENCES public.land_operators(id) ON DELETE SET NULL,
  departing_location_id UUID REFERENCES public.departing_locations(id) ON DELETE SET NULL,
  manager_name TEXT,
  has_sent_docs BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_attributed_campaign_id UUID
    REFERENCES public.ad_campaigns(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_package_id
  ON public.bookings(package_id);
CREATE INDEX IF NOT EXISTS idx_bookings_lead_customer_id
  ON public.bookings(lead_customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_affiliate_id
  ON public.bookings(affiliate_id);

CREATE TABLE IF NOT EXISTS public.group_rfqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_code TEXT UNIQUE NOT NULL,
  customer_id UUID REFERENCES public.customers(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  destination TEXT NOT NULL,
  departure_date_from DATE,
  departure_date_to DATE,
  duration_nights INTEGER,
  adult_count INTEGER NOT NULL DEFAULT 1,
  child_count INTEGER NOT NULL DEFAULT 0,
  budget_per_person INTEGER,
  total_budget INTEGER,
  hotel_grade TEXT,
  meal_plan TEXT,
  transportation TEXT,
  special_requests TEXT,
  custom_requirements JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'published', 'bidding', 'analyzing',
      'awaiting_selection', 'contracted', 'completed', 'cancelled'
    )),
  published_at TIMESTAMPTZ,
  gold_unlock_at TIMESTAMPTZ,
  silver_unlock_at TIMESTAMPTZ,
  bronze_unlock_at TIMESTAMPTZ,
  bid_deadline TIMESTAMPTZ,
  max_proposals INTEGER NOT NULL DEFAULT 5,
  selected_proposal_id UUID,
  ai_interview_log JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfqs_status ON public.group_rfqs(status);
CREATE INDEX IF NOT EXISTS idx_rfqs_customer ON public.group_rfqs(customer_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_published
  ON public.group_rfqs(published_at) WHERE status != 'draft';

CREATE TABLE IF NOT EXISTS public.rfq_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES public.group_rfqs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  status TEXT NOT NULL DEFAULT 'locked'
    CHECK (status IN ('locked', 'submitted', 'selected', 'rejected', 'timeout', 'withdrawn')),
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submit_deadline TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  is_penalized BOOLEAN NOT NULL DEFAULT false,
  penalty_reason TEXT,
  UNIQUE (rfq_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_bids_rfq ON public.rfq_bids(rfq_id);
CREATE INDEX IF NOT EXISTS idx_bids_tenant ON public.rfq_bids(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bids_deadline
  ON public.rfq_bids(submit_deadline) WHERE status = 'locked';

CREATE TABLE IF NOT EXISTS public.rfq_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES public.group_rfqs(id) ON DELETE CASCADE,
  bid_id UUID NOT NULL REFERENCES public.rfq_bids(id),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  proposal_title TEXT,
  itinerary_summary TEXT,
  total_cost INTEGER NOT NULL,
  total_selling_price INTEGER NOT NULL,
  hidden_cost_estimate INTEGER NOT NULL DEFAULT 0,
  real_total_price INTEGER,
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  checklist_completed BOOLEAN NOT NULL DEFAULT false,
  ai_review JSONB,
  ai_reviewed_at TIMESTAMPTZ,
  rank INTEGER,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'reviewing', 'approved', 'selected', 'rejected')),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposals_rfq ON public.rfq_proposals(rfq_id);
CREATE INDEX IF NOT EXISTS idx_proposals_tenant ON public.rfq_proposals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_proposals_rank
  ON public.rfq_proposals(rfq_id, rank) WHERE rank IS NOT NULL;

ALTER TABLE public.group_rfqs
  ADD CONSTRAINT fk_rfqs_selected_proposal
  FOREIGN KEY (selected_proposal_id)
  REFERENCES public.rfq_proposals(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS public.rfq_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES public.group_rfqs(id) ON DELETE CASCADE,
  proposal_id UUID REFERENCES public.rfq_proposals(id),
  sender_type TEXT NOT NULL
    CHECK (sender_type IN ('customer', 'tenant', 'ai', 'system')),
  sender_id TEXT,
  raw_content TEXT NOT NULL,
  processed_content TEXT,
  pii_detected BOOLEAN NOT NULL DEFAULT false,
  pii_blocked BOOLEAN NOT NULL DEFAULT false,
  recipient_type TEXT NOT NULL
    CHECK (recipient_type IN ('customer', 'tenant', 'admin')),
  is_visible_to_customer BOOLEAN NOT NULL DEFAULT true,
  is_visible_to_tenant BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfq_messages_rfq ON public.rfq_messages(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_messages_proposal
  ON public.rfq_messages(proposal_id) WHERE proposal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.secure_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  rfq_id UUID REFERENCES public.group_rfqs(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL
    CHECK (sender_type IN ('customer', 'land_agency', 'system')),
  sender_id TEXT NOT NULL,
  receiver_type TEXT NOT NULL
    CHECK (receiver_type IN ('customer', 'land_agency', 'admin')),
  raw_message TEXT NOT NULL,
  masked_message TEXT NOT NULL,
  is_filtered BOOLEAN NOT NULL DEFAULT false,
  filter_detail TEXT,
  is_unmasked BOOLEAN NOT NULL DEFAULT false,
  unmasked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_secure_chat_booking
  ON public.secure_chats(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_secure_chat_rfq
  ON public.secure_chats(rfq_id) WHERE rfq_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_secure_chat_sender ON public.secure_chats(sender_id);

CREATE TABLE IF NOT EXISTS public.vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  rfq_id UUID REFERENCES public.group_rfqs(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  land_agency_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  parsed_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  upsell_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  pdf_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'sent', 'cancelled')),
  issued_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  end_date DATE,
  review_notified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voucher_booking
  ON public.vouchers(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voucher_rfq
  ON public.vouchers(rfq_id) WHERE rfq_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voucher_customer
  ON public.vouchers(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voucher_status ON public.vouchers(status);
CREATE INDEX IF NOT EXISTS idx_voucher_end_date
  ON public.vouchers(end_date) WHERE review_notified = false;

CREATE TABLE IF NOT EXISTS public.booking_passengers (
  booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  passenger_type TEXT DEFAULT 'adult'
    CHECK (passenger_type IN ('adult', 'child_n', 'child_e', 'infant')),
  seat_number TEXT,
  ticket_number TEXT,
  PRIMARY KEY (booking_id, customer_id)
);

CREATE TABLE IF NOT EXISTS public.message_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  log_type TEXT NOT NULL
    CHECK (log_type IN ('system', 'kakao', 'mock', 'scheduler', 'manual')),
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  is_mock BOOLEAN DEFAULT false,
  created_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_logs_booking
  ON public.message_logs(booking_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ad_traffic_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  user_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  source TEXT,
  medium TEXT,
  campaign_name TEXT,
  keyword TEXT,
  gclid TEXT,
  fbclid TEXT,
  n_keyword TEXT,
  current_cpc INTEGER,
  consent_agreed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_traffic_session
  ON public.ad_traffic_logs(session_id);

CREATE TABLE IF NOT EXISTS public.ad_search_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  user_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  search_query TEXT,
  search_category TEXT,
  result_count INTEGER DEFAULT 0,
  lead_time_days INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_session
  ON public.ad_search_logs(session_id);

CREATE TABLE IF NOT EXISTS public.ad_engagement_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  user_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  product_id TEXT,
  product_name TEXT,
  cart_added BOOLEAN NOT NULL DEFAULT false,
  page_url TEXT,
  lead_time_days INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_session
  ON public.ad_engagement_logs(session_id);

CREATE TABLE IF NOT EXISTS public.ad_conversion_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  user_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  final_booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  final_sales_price INTEGER NOT NULL DEFAULT 0,
  base_cost INTEGER NOT NULL DEFAULT 0,
  allocated_ad_spend INTEGER NOT NULL DEFAULT 0,
  net_profit INTEGER GENERATED ALWAYS AS (
    final_sales_price - base_cost - allocated_ad_spend
  ) STORED,
  attributed_source TEXT,
  attributed_gclid TEXT,
  attributed_fbclid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversion_session
  ON public.ad_conversion_logs(session_id);

CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_event_id TEXT UNIQUE NOT NULL,
  raw_message TEXT NOT NULL,
  transaction_type TEXT NOT NULL
    CHECK (transaction_type IN ('입금', '출금')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  counterparty_name TEXT,
  memo TEXT DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  is_refund BOOLEAN DEFAULT false,
  is_fee BOOLEAN DEFAULT false,
  fee_amount INTEGER DEFAULT 0,
  match_status TEXT DEFAULT 'unmatched'
    CHECK (match_status IN ('auto', 'review', 'unmatched', 'manual')),
  match_confidence DOUBLE PRECISION DEFAULT 0,
  matched_by TEXT,
  matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_tx_status
  ON public.bank_transactions(match_status);
CREATE INDEX IF NOT EXISTS idx_bank_tx_booking
  ON public.bank_transactions(booking_id);
CREATE INDEX IF NOT EXISTS idx_bank_tx_received
  ON public.bank_transactions(received_at DESC);

CREATE OR REPLACE FUNCTION public.update_bank_tx_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.affiliates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  referral_code TEXT UNIQUE NOT NULL,
  grade INTEGER DEFAULT 1 CHECK (grade BETWEEN 1 AND 5),
  bonus_rate NUMERIC(5,3) DEFAULT 0,
  payout_type TEXT DEFAULT 'PERSONAL'
    CHECK (payout_type IN ('PERSONAL', 'BUSINESS')),
  encrypted_bank_info TEXT,
  booking_count INTEGER DEFAULT 0,
  total_commission NUMERIC(12,0) DEFAULT 0,
  commission_rate NUMERIC(5,4) NOT NULL DEFAULT 0.09,
  business_number VARCHAR(20),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_conversion_at TIMESTAMPTZ,
  pin TEXT,
  logo_url TEXT,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliates_referral_code
  ON public.affiliates(referral_code);
CREATE INDEX IF NOT EXISTS idx_affiliates_grade
  ON public.affiliates(grade);

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_affiliate_id_fkey
  FOREIGN KEY (affiliate_id) REFERENCES public.affiliates(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.influencer_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES public.affiliates(id),
  referral_code TEXT NOT NULL,
  package_id UUID NOT NULL,
  package_title TEXT,
  short_url TEXT,
  click_count INTEGER DEFAULT 0,
  conversion_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inf_links_affiliate
  ON public.influencer_links(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_inf_links_referral
  ON public.influencer_links(referral_code);
CREATE INDEX IF NOT EXISTS idx_inf_links_package
  ON public.influencer_links(package_id);

CREATE TABLE IF NOT EXISTS public.settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  settlement_period TEXT NOT NULL,
  qualified_booking_count INTEGER DEFAULT 0,
  total_amount INTEGER DEFAULT 0,
  carryover_balance INTEGER DEFAULT 0,
  final_total INTEGER DEFAULT 0,
  tax_deduction INTEGER DEFAULT 0,
  final_payout INTEGER DEFAULT 0,
  status TEXT DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'READY', 'COMPLETED', 'VOID')),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (affiliate_id, settlement_period)
);

CREATE INDEX IF NOT EXISTS idx_settlements_affiliate
  ON public.settlements(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_settlements_period
  ON public.settlements(settlement_period);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  description TEXT,
  before_value JSONB,
  after_value JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_target
  ON public.audit_logs(target_type, target_id);

CREATE TABLE IF NOT EXISTS public.products (
  internal_code VARCHAR PRIMARY KEY,
  display_name VARCHAR NOT NULL,
  departure_region VARCHAR NOT NULL DEFAULT '부산',
  supplier_code VARCHAR(10) NOT NULL,
  departing_location_id UUID REFERENCES public.departing_locations(id) ON DELETE SET NULL,
  departure_date TIMESTAMPTZ,
  net_price INTEGER NOT NULL CHECK (net_price > 0),
  margin_rate NUMERIC(6,4) NOT NULL DEFAULT 0.10
    CHECK (margin_rate >= 0 AND margin_rate <= 1),
  discount_amount INTEGER NOT NULL DEFAULT 0
    CHECK (discount_amount >= 0),
  selling_price INTEGER GENERATED ALWAYS AS (
    (round(net_price * (1 + margin_rate)) - discount_amount)::INTEGER
  ) STORED,
  ai_tags TEXT[] NOT NULL DEFAULT '{}',
  status VARCHAR NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'expired', 'cancelled')),
  internal_memo TEXT,
  source_filename TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_status
  ON public.products(status);
CREATE INDEX IF NOT EXISTS idx_products_departure_date
  ON public.products(departure_date);
CREATE INDEX IF NOT EXISTS idx_products_supplier_code
  ON public.products(supplier_code);
CREATE INDEX IF NOT EXISTS idx_products_internal_code_prefix
  ON public.products(internal_code text_pattern_ops);

CREATE TABLE IF NOT EXISTS public.jarvis_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  messages JSONB DEFAULT '[]'::jsonb,
  context JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jarvis_sessions_user
  ON public.jarvis_sessions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.jarvis_pending_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.jarvis_sessions(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_args JSONB NOT NULL,
  description TEXT NOT NULL,
  risk_level TEXT DEFAULT 'medium'
    CHECK (risk_level IN ('low', 'medium', 'high')),
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jarvis_pending_session
  ON public.jarvis_pending_actions(session_id, status);

CREATE TABLE IF NOT EXISTS public.kakao_inbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kakao_user_id TEXT NOT NULL,
  customer_id UUID,
  message TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  attachments JSONB DEFAULT '[]'::jsonb,
  is_processed BOOLEAN DEFAULT false,
  jarvis_session_id UUID REFERENCES public.jarvis_sessions(id),
  received_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kakao_inbound_unprocessed
  ON public.kakao_inbound(is_processed, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_kakao_inbound_user
  ON public.kakao_inbound(kakao_user_id, received_at DESC);

CREATE TABLE IF NOT EXISTS public.jarvis_tool_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.jarvis_sessions(id),
  agent_type TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_args JSONB,
  result JSONB,
  is_hitl BOOLEAN DEFAULT false,
  pending_action_id UUID REFERENCES public.jarvis_pending_actions(id),
  executed_at TIMESTAMPTZ DEFAULT now(),
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS public.normalization_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  typo_pattern TEXT NOT NULL,
  correct_text TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  land_operator_id UUID REFERENCES public.land_operators(id),
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_normalization_rules_active
  ON public.normalization_rules(is_active, priority DESC);

CREATE TABLE IF NOT EXISTS public.exclusion_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  match_keywords TEXT[] NOT NULL,
  severity TEXT DEFAULT 'warning'
    CHECK (severity IN ('warning', 'error')),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exclusion_rules_category
  ON public.exclusion_rules(category, is_active);

CREATE TABLE IF NOT EXISTS public.ai_training_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id VARCHAR REFERENCES public.products(internal_code) ON DELETE CASCADE,
  original_raw_text TEXT,
  ai_parsed_json JSONB,
  human_corrected_json JSONB,
  correction_diff JSONB,
  corrected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ai_model_used VARCHAR,
  confidence_before INTEGER,
  confidence_after INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_training_logs_product_id
  ON public.ai_training_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_ai_training_logs_created_at
  ON public.ai_training_logs(created_at DESC);

ALTER TABLE public.ai_training_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_training_logs: service role only"
  ON public.ai_training_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "ai_training_logs: authenticated read only"
  ON public.ai_training_logs FOR SELECT TO authenticated
  USING (true);

CREATE TABLE IF NOT EXISTS public.extractions_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  land_operator_id UUID REFERENCES public.land_operators(id) ON DELETE SET NULL,
  destination TEXT,
  category TEXT,
  field_path TEXT NOT NULL,
  before_value JSONB,
  after_value JSONB,
  raw_text_excerpt TEXT,
  reflection TEXT,
  severity TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  applied_count INTEGER NOT NULL DEFAULT 0,
  last_applied_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.travel_packages
  ADD CONSTRAINT travel_packages_internal_code_fkey
  FOREIGN KEY (internal_code) REFERENCES public.products(internal_code) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.document_hashes (
  file_hash TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  product_id VARCHAR REFERENCES public.products(internal_code) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
