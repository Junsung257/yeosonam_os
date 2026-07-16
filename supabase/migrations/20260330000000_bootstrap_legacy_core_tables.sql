-- Legacy bootstrap baseline for clean Supabase resets.
--
-- The earliest checked-in migration (20260331000000) was written after the
-- original SQL Editor bootstrap had already created the core CRM/package ERP
-- tables. Production already has these objects, so this migration is additive
-- and idempotent there. Empty local/staging databases need it so the historical
-- migration chain can be replayed from zero without assuming manual state.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS cron;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'cron'
      AND p.proname = 'schedule'
      AND pg_get_function_identity_arguments(p.oid) = 'job_name text, schedule text, command text'
  ) THEN
    CREATE FUNCTION cron.schedule(job_name text, schedule text, command text)
    RETURNS bigint
    LANGUAGE plpgsql
    AS $cron_schedule$
    BEGIN
      RAISE NOTICE 'pg_cron unavailable; skipped local schedule job: %', job_name;
      RETURN NULL;
    END;
    $cron_schedule$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'cron'
      AND p.proname = 'unschedule'
      AND pg_get_function_identity_arguments(p.oid) = 'job_name text'
  ) THEN
    CREATE FUNCTION cron.unschedule(job_name text)
    RETURNS boolean
    LANGUAGE plpgsql
    AS $cron_unschedule$
    BEGIN
      RAISE NOTICE 'pg_cron unavailable; skipped local unschedule job: %', job_name;
      RETURN false;
    END;
    $cron_unschedule$;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.travel_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(255) NOT NULL,
  internal_code text,
  short_code text,
  destination varchar(255),
  land_operator text,
  country text,
  nights integer,
  duration integer,
  price integer,
  price_dates jsonb,
  avg_rating numeric,
  review_count integer NOT NULL DEFAULT 0,
  filename varchar(255),
  file_type varchar(20),
  raw_text text,
  itinerary text[] DEFAULT '{}',
  inclusions text[] DEFAULT '{}',
  excludes text[] DEFAULT '{}',
  accommodations text[] DEFAULT '{}',
  special_notes text,
  confidence double precision DEFAULT 0,
  status varchar(50) DEFAULT 'pending',
  parsed_at timestamp DEFAULT now(),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  created_by uuid,
  notes text
);

ALTER TABLE public.travel_packages
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(1536),
  ADD COLUMN IF NOT EXISTS affiliate_commission_rate numeric NOT NULL DEFAULT 0.09,
  ADD COLUMN IF NOT EXISTS agent_audit_report jsonb,
  ADD COLUMN IF NOT EXISTS airline text,
  ADD COLUMN IF NOT EXISTS audit_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS audit_report jsonb,
  ADD COLUMN IF NOT EXISTS audit_status text,
  ADD COLUMN IF NOT EXISTS baseline_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS baseline_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_policy jsonb,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS category_attrs jsonb,
  ADD COLUMN IF NOT EXISTS commission_currency text,
  ADD COLUMN IF NOT EXISTS commission_fixed_amount numeric,
  ADD COLUMN IF NOT EXISTS commission_rate numeric,
  ADD COLUMN IF NOT EXISTS confirmed_dates jsonb,
  ADD COLUMN IF NOT EXISTS cost_price numeric,
  ADD COLUMN IF NOT EXISTS customer_notes text,
  ADD COLUMN IF NOT EXISTS data_completeness integer,
  ADD COLUMN IF NOT EXISTS departing_location_id uuid,
  ADD COLUMN IF NOT EXISTS departure_airport text,
  ADD COLUMN IF NOT EXISTS departure_days text,
  ADD COLUMN IF NOT EXISTS display_title text,
  ADD COLUMN IF NOT EXISTS dp_reason text,
  ADD COLUMN IF NOT EXISTS dp_triggered_at timestamptz,
  ADD COLUMN IF NOT EXISTS excluded_dates text[],
  ADD COLUMN IF NOT EXISTS field_confidences jsonb,
  ADD COLUMN IF NOT EXISTS guide_tip text,
  ADD COLUMN IF NOT EXISTS hard_block_quota integer,
  ADD COLUMN IF NOT EXISTS hero_tagline text,
  ADD COLUMN IF NOT EXISTS highlights_md text,
  ADD COLUMN IF NOT EXISTS inquiry_count integer,
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS is_airtel boolean,
  ADD COLUMN IF NOT EXISTS is_stub boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS itinerary_data jsonb,
  ADD COLUMN IF NOT EXISTS itinerary_md text,
  ADD COLUMN IF NOT EXISTS land_operator_id uuid,
  ADD COLUMN IF NOT EXISTS marketing_copies jsonb,
  ADD COLUMN IF NOT EXISTS min_participants integer,
  ADD COLUMN IF NOT EXISTS normalized_surcharges jsonb,
  ADD COLUMN IF NOT EXISTS notices_parsed jsonb,
  ADD COLUMN IF NOT EXISTS optional_tours jsonb,
  ADD COLUMN IF NOT EXISTS parsed_data jsonb,
  ADD COLUMN IF NOT EXISTS parser_version text,
  ADD COLUMN IF NOT EXISTS price_list jsonb,
  ADD COLUMN IF NOT EXISTS price_markup_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_tiers jsonb,
  ADD COLUMN IF NOT EXISTS product_highlights text[],
  ADD COLUMN IF NOT EXISTS product_summary text,
  ADD COLUMN IF NOT EXISTS product_tags text[],
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS raw_text_hash text,
  ADD COLUMN IF NOT EXISTS review_reject_category text,
  ADD COLUMN IF NOT EXISTS review_reject_subnote text,
  ADD COLUMN IF NOT EXISTS seats_confirmed integer,
  ADD COLUMN IF NOT EXISTS seats_held integer,
  ADD COLUMN IF NOT EXISTS seats_ticketed integer,
  ADD COLUMN IF NOT EXISTS single_supplement text,
  ADD COLUMN IF NOT EXISTS small_group_surcharge text,
  ADD COLUMN IF NOT EXISTS structured_features jsonb,
  ADD COLUMN IF NOT EXISTS stub_source text,
  ADD COLUMN IF NOT EXISTS surcharges jsonb,
  ADD COLUMN IF NOT EXISTS terms_md text,
  ADD COLUMN IF NOT EXISTS ticketing_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS trip_style text,
  ADD COLUMN IF NOT EXISTS usd_cost numeric,
  ADD COLUMN IF NOT EXISTS view_count integer,
  ADD COLUMN IF NOT EXISTS view_count_snap_at timestamptz,
  ADD COLUMN IF NOT EXISTS view_count_weekly_snap integer;

CREATE TABLE IF NOT EXISTS public.qa_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  inquiry_type varchar(50),
  related_packages uuid[] DEFAULT '{}',
  customer_name varchar(255),
  customer_email varchar(255),
  customer_phone varchar(20),
  status varchar(50) DEFAULT 'pending',
  created_at timestamp DEFAULT now(),
  answered_at timestamp DEFAULT NULL,
  answered_by uuid
);

CREATE TABLE IF NOT EXISTS public.product_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  rating integer,
  content text,
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid REFERENCES public.qa_inquiries(id) ON DELETE CASCADE,
  response_text text NOT NULL,
  ai_model varchar(50),
  confidence double precision DEFAULT 0,
  used_packages uuid[] DEFAULT '{}',
  created_at timestamp DEFAULT now(),
  admin_feedback text,
  approved boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.margin_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  base_price integer NOT NULL,
  vip_margin_percent double precision DEFAULT 10,
  regular_margin_percent double precision DEFAULT 15,
  bulk_margin_percent double precision DEFAULT 20,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  category varchar(100),
  api_endpoint varchar(500),
  api_key varchar(500),
  is_active boolean DEFAULT true,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_traffic_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id uuid,
  source text,
  medium text,
  campaign_name text,
  keyword text,
  n_keyword text,
  landing_page text,
  gclid text,
  fbclid text,
  current_cpc numeric,
  content_creative_id uuid,
  ad_landing_mapping_id uuid,
  consent_agreed boolean NOT NULL DEFAULT false,
  visitor_uid text,
  is_returning boolean,
  device_type text,
  device_os text,
  browser_name text,
  viewport_w integer,
  viewport_h integer,
  time_on_page_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_engagement_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id uuid,
  event_type text NOT NULL,
  event_source text,
  destination text,
  product_id uuid,
  product_name text,
  page_url text,
  lead_time_days integer,
  cart_added boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  visitor_uid text,
  time_on_page_ms integer,
  max_scroll_pct smallint,
  interaction_count smallint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_search_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id uuid,
  search_query text,
  search_category text,
  result_count integer,
  lead_time_days integer,
  visitor_uid text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.land_operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  contact text,
  regions text[] DEFAULT '{}',
  memo text,
  aliases text[] DEFAULT '{}',
  is_active boolean DEFAULT true,
  total_bookings integer DEFAULT 0,
  cancelled_count integer DEFAULT 0,
  dispute_count integer DEFAULT 0,
  refund_total numeric DEFAULT 0,
  reliability_score numeric,
  reliability_computed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_name text,
  contact_phone text,
  contact_email text,
  commission_rate numeric(5,2) DEFAULT 18.00,
  status text DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  tier text NOT NULL DEFAULT 'standard',
  reliability_score integer NOT NULL DEFAULT 0,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.departing_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  email text,
  passport_no text,
  passport_expiry date,
  birth_date date,
  mileage integer DEFAULT 0,
  tags text[] DEFAULT '{}',
  memo text,
  total_spent integer DEFAULT 0,
  booking_count integer DEFAULT 0,
  grade text,
  status text DEFAULT 'active',
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  content text NOT NULL,
  channel text,
  note_category text,
  outcome text,
  sentiment smallint,
  duration_sec integer,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  agent_type text NOT NULL,
  action_type text NOT NULL,
  summary text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  priority text NOT NULL DEFAULT 'normal',
  requested_by text NOT NULL DEFAULT 'system',
  reviewed_by text,
  resolved_at timestamptz,
  reject_reason text,
  result_log text,
  expires_at timestamptz,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'cs_agent',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_no text UNIQUE NOT NULL DEFAULT '',
  package_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  package_title text,
  lead_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  adult_count integer DEFAULT 1,
  child_count integer DEFAULT 0,
  child_n_count integer DEFAULT 0,
  child_e_count integer DEFAULT 0,
  infant_count integer DEFAULT 0,
  single_charge_count integer DEFAULT 0,
  adult_cost integer DEFAULT 0,
  adult_price integer DEFAULT 0,
  child_cost integer DEFAULT 0,
  child_price integer DEFAULT 0,
  child_n_cost integer DEFAULT 0,
  child_n_price integer DEFAULT 0,
  child_e_cost integer DEFAULT 0,
  child_e_price integer DEFAULT 0,
  infant_cost integer DEFAULT 0,
  infant_price integer DEFAULT 0,
  single_charge integer DEFAULT 0,
  fuel_surcharge integer DEFAULT 0,
  total_cost integer GENERATED ALWAYS AS (
    (adult_count * adult_cost) + (child_count * child_cost) + fuel_surcharge
  ) STORED,
  total_price integer GENERATED ALWAYS AS (
    (adult_count * adult_price) + (child_count * child_price) + fuel_surcharge
  ) STORED,
  status text DEFAULT 'pending' CHECK (status IN ('pending','confirmed','completed','cancelled')),
  departure_date date,
  departure_region text,
  cancelled_at timestamptz,
  notes text,
  payment_date timestamptz,
  booking_type text DEFAULT 'DIRECT' CHECK (booking_type IN ('DIRECT','AFFILIATE')),
  affiliate_id uuid,
  land_operator_id uuid REFERENCES public.land_operators(id) ON DELETE SET NULL,
  settlement_mode text,
  utm_source text,
  utm_campaign text,
  cost_snapshot_krw integer DEFAULT 0,
  applied_total_commission_rate numeric(5,3) DEFAULT 0,
  influencer_commission integer DEFAULT 0,
  margin integer DEFAULT 0,
  return_date date,
  is_deleted boolean DEFAULT false,
  paid_amount integer DEFAULT 0,
  total_paid_out integer DEFAULT 0,
  payment_status text DEFAULT '미입금',
  actual_payer_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.secure_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  rfq_id uuid,
  sender_id uuid NOT NULL,
  sender_type text NOT NULL,
  receiver_type text NOT NULL,
  raw_message text NOT NULL,
  masked_message text NOT NULL,
  is_filtered boolean NOT NULL DEFAULT false,
  filter_detail text,
  is_unmasked boolean NOT NULL DEFAULT false,
  unmasked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_event_id text UNIQUE NOT NULL,
  raw_message text NOT NULL,
  transaction_type text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  counterparty_name text,
  memo text DEFAULT '',
  received_at timestamptz NOT NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  is_refund boolean DEFAULT false,
  is_fee boolean DEFAULT false,
  fee_amount integer DEFAULT 0,
  match_status text DEFAULT 'unmatched',
  match_confidence double precision DEFAULT 0,
  matched_by text,
  matched_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.booking_passengers (
  booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  PRIMARY KEY (booking_id, customer_id)
);

CREATE TABLE IF NOT EXISTS public.mileage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  amount integer NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}',
  description text,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.attractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  short_desc text,
  long_desc text,
  country text,
  region text,
  category text DEFAULT 'sightseeing',
  emoji text,
  mention_count integer DEFAULT 1,
  is_special boolean DEFAULT false,
  aliases text[] DEFAULT '{}',
  photos jsonb DEFAULT '[]'::jsonb,
  badge_type text,
  coordinates jsonb,
  price_info jsonb,
  external_url text,
  source text,
  source_packages jsonb,
  raw_descriptions jsonb,
  confidence_score numeric,
  typical_duration_hours numeric,
  is_active boolean NOT NULL DEFAULT true,
  is_manual_override boolean NOT NULL DEFAULT false,
  ai_processed_at timestamptz,
  last_owner_edited_at timestamptz,
  seeded_at timestamptz,
  wikidata_qid text,
  wikidata_synced_at timestamptz,
  mrt_gid text,
  mrt_category text,
  mrt_image_url text,
  mrt_min_price integer,
  mrt_provider_url text,
  mrt_rating numeric,
  mrt_raw_desc text,
  mrt_review_count integer,
  mrt_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.unmatched_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity text NOT NULL,
  package_id uuid,
  package_title text,
  day_number integer,
  country text,
  region text,
  occurrence_count integer DEFAULT 1,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.os_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('pricing','mileage','booking','notification','display','product','operations','marketing','saas')),
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL DEFAULT 'always',
  trigger_config jsonb DEFAULT '{}'::jsonb,
  action_type text NOT NULL,
  action_config jsonb DEFAULT '{}'::jsonb,
  target_scope jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  priority integer DEFAULT 100,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  angle_type text NOT NULL DEFAULT 'emotional',
  target_audience text,
  channel text NOT NULL DEFAULT 'instagram_card',
  image_ratio text DEFAULT '1:1',
  slides jsonb DEFAULT '[]'::jsonb,
  blog_html text,
  ad_copy jsonb,
  tracking_id text UNIQUE,
  tone text DEFAULT 'professional',
  extra_prompt text,
  status text DEFAULT 'draft',
  published_at timestamptz,
  slug text,
  seo_title text,
  seo_description text,
  category text,
  category_id uuid,
  content_type text,
  destination text,
  primary_keyword text,
  sub_keyword text,
  og_image_url text,
  pillar_for text,
  cta_text text,
  generation_meta jsonb,
  generation_params jsonb,
  quality_gate jsonb,
  readability_score integer,
  readability_issues jsonb,
  review_status text,
  prompt_version text,
  source text,
  topic_source text,
  publish_scheduled_at timestamptz,
  featured boolean NOT NULL DEFAULT false,
  featured_order integer,
  landing_enabled boolean NOT NULL DEFAULT false,
  landing_headline text,
  landing_subtitle text,
  target_ad_keywords text[],
  ai_model text,
  ai_temperature numeric,
  band_post_url text,
  view_count integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  name text NOT NULL,
  channel text,
  objective text,
  status text DEFAULT 'draft',
  daily_budget_krw integer,
  total_spend_krw integer,
  started_at timestamptz,
  ended_at timestamptz,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text,
  google_campaign_id text,
  google_adgroup_id text,
  google_ad_id text,
  naver_campaign_id text,
  naver_adgroup_id text,
  naver_ad_id text,
  auto_pause_reason text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.ad_campaigns(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  landing_content_creative_id uuid REFERENCES public.content_creatives(id) ON DELETE SET NULL,
  channel text NOT NULL,
  creative_type text NOT NULL,
  status text DEFAULT 'draft',
  headline text,
  body text,
  primary_text text,
  description text,
  image_url text,
  slides jsonb,
  ad_copies jsonb,
  keywords text[],
  hook_type text,
  key_selling_point text,
  target_segment text,
  tone text,
  variant_index integer,
  utm_params jsonb,
  launched_at timestamptz,
  ended_at timestamptz,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text,
  meta_creative_id text,
  google_campaign_id text,
  google_adgroup_id text,
  google_ad_id text,
  naver_campaign_id text,
  naver_adgroup_id text,
  naver_ad_id text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_performance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  impressions integer,
  clicks integer,
  spend_krw integer,
  cpc_krw numeric,
  attributed_bookings integer,
  attributed_margin integer,
  net_roas_pct numeric,
  raw_meta_json jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.creative_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id uuid NOT NULL REFERENCES public.ad_creatives(id) ON DELETE CASCADE,
  field text NOT NULL,
  before_value text,
  after_value text,
  slide_index integer,
  edited_by text,
  edited_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.creative_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id uuid NOT NULL REFERENCES public.ad_creatives(id) ON DELETE CASCADE,
  channel text NOT NULL,
  date date NOT NULL,
  impressions integer,
  reach integer,
  clicks integer,
  spend numeric,
  revenue numeric,
  bookings integer,
  inquiries integer,
  ctr numeric,
  cpc numeric,
  roas numeric,
  frequency numeric,
  video_views integer,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.winning_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text,
  creative_type text,
  hook_type text,
  destination_type text,
  nights_range text,
  price_range text,
  key_selling_point text,
  target_segment text,
  tone text,
  best_headline text,
  best_body text,
  best_hook_example text,
  avg_ctr numeric,
  avg_conv_rate numeric,
  avg_roas numeric,
  total_spend numeric,
  sample_count integer,
  confidence_score numeric,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.card_news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  campaign_id uuid,
  title text NOT NULL,
  status text DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CONFIRMED','LAUNCHED','ARCHIVED')),
  publish_status text,
  slides jsonb NOT NULL DEFAULT '[]'::jsonb,
  meta_creative_id text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.blog_topic_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 50,
  product_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  card_news_id uuid REFERENCES public.card_news(id) ON DELETE SET NULL,
  content_creative_id uuid REFERENCES public.content_creatives(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  destination text,
  angle_type text,
  category text,
  primary_keyword text,
  keyword_tier text,
  monthly_search_volume integer,
  competition_level text,
  trend_score integer,
  target_publish_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text UNIQUE,
  content text,
  excerpt text,
  destination text,
  category text,
  primary_keyword text,
  serp_rank integer,
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.blog_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.blog_engagement_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid,
  slug text,
  event_type text NOT NULL DEFAULT 'view',
  visitor_uid text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.blog_search_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text,
  slug text,
  result_count integer,
  visitor_uid text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_landing_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_creative_id uuid NOT NULL REFERENCES public.content_creatives(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.ad_campaigns(id) ON DELETE SET NULL,
  platform text NOT NULL,
  keyword text NOT NULL,
  match_type text,
  landing_url text NOT NULL,
  utm_source text NOT NULL,
  utm_medium text NOT NULL DEFAULT 'cpc',
  utm_campaign text NOT NULL,
  utm_content text,
  utm_term text,
  dki_headline text,
  dki_subtitle text,
  active boolean NOT NULL DEFAULT true,
  clicks integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.free_travel_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  session_id uuid,
  destination text,
  plan_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_deleted boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.b2b_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  package_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  title text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.unmatched_attractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_name text NOT NULL,
  package_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  destination text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  amount integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  account_id text,
  name text,
  status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_conversion_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  customer_id uuid,
  booking_id uuid,
  event_name text,
  value numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.airline_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airline_code text,
  reason text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.api_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  customer_id uuid,
  booking_id uuid,
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.archive_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  title text,
  content text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.capital_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  amount numeric NOT NULL DEFAULT 0,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  entry_type text,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL DEFAULT '',
  user_id uuid,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.external_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  booking_id uuid,
  external_id text,
  status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.group_rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  customer_id uuid,
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  package_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.keyword_performances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id uuid REFERENCES public.ad_accounts(id) ON DELETE SET NULL,
  keyword text NOT NULL,
  platform text NOT NULL DEFAULT 'unknown',
  destination text,
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  total_spend numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  total_revenue numeric NOT NULL DEFAULT 0,
  net_profit numeric,
  roas_pct numeric,
  current_bid numeric,
  is_longtail boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  discovered_at timestamptz,
  period_start date,
  period_end date,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mileage_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  ref_transaction_id uuid,
  amount integer NOT NULL DEFAULT 0,
  type text NOT NULL DEFAULT 'EARNED',
  reason text,
  memo text,
  margin_impact numeric,
  base_net_profit numeric,
  mileage_rate numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mock_api_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.package_pricings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  price numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KRW',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.package_score_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  signal_type text,
  score numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.parsed_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  raw_text_hash text,
  parsed_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.partner_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  amount numeric NOT NULL DEFAULT 0,
  status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.raw_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_hash text,
  raw_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rfq_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid,
  tenant_id uuid,
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rfq_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid,
  sender_id uuid,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rfq_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid,
  tenant_id uuid,
  status text NOT NULL DEFAULT 'draft',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shared_itineraries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  share_token text UNIQUE,
  itinerary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sms_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  raw_sms text NOT NULL DEFAULT '',
  amount integer,
  sender_name text,
  source text,
  status text,
  match_confidence numeric,
  received_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.surcharge_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  surcharge_date date,
  amount numeric NOT NULL DEFAULT 0,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL DEFAULT gen_random_uuid()::text,
  status text NOT NULL DEFAULT 'pending',
  customer_name text,
  customer_phone text,
  customer_email text,
  total_cost numeric NOT NULL DEFAULT 0,
  total_price numeric NOT NULL DEFAULT 0,
  net_margin numeric,
  tenant_cost_breakdown jsonb,
  vouchers jsonb,
  saga_log jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  rfq_id uuid,
  land_agency_id uuid,
  status text NOT NULL DEFAULT 'draft',
  parsed_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  upsell_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_url text,
  issued_at timestamptz,
  sent_at timestamptz,
  end_date date,
  review_notified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_settings (key, value) VALUES
  ('commission_rate', '{"rate": 9}'::jsonb),
  ('vacation_mode', '{"enabled": false, "start": null, "end": null, "message": ""}'::jsonb),
  ('mileage_event', '{"enabled": false, "name": "", "start": null, "end": null, "bonus_rate": 0}'::jsonb),
  ('mileage_base_rate', '{"rate": 1}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  internal_code varchar PRIMARY KEY,
  display_name varchar NOT NULL,
  departure_region varchar NOT NULL DEFAULT '부산',
  supplier_code varchar(10) NOT NULL,
  departure_date timestamptz,
  net_price integer NOT NULL CHECK (net_price > 0),
  margin_rate numeric(6,4) NOT NULL DEFAULT 0.10 CHECK (margin_rate >= 0 AND margin_rate <= 1),
  discount_amount integer NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  selling_price integer GENERATED ALWAYS AS (
    (round(net_price * (1 + margin_rate)) - discount_amount)::integer
  ) STORED,
  ai_tags text[] NOT NULL DEFAULT '{}',
  status varchar NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'expired', 'cancelled')),
  internal_memo text,
  source_filename text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS products_id_key ON public.products(id);

CREATE TABLE IF NOT EXISTS public.product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id varchar NOT NULL REFERENCES public.products(internal_code) ON DELETE CASCADE,
  target_date date,
  day_of_week text,
  net_price numeric NOT NULL,
  adult_selling_price numeric,
  child_price numeric,
  note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_prices_product_id
  ON public.product_prices(product_id);

CREATE INDEX IF NOT EXISTS idx_product_prices_target_date
  ON public.product_prices(target_date)
  WHERE target_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.document_hashes (
  file_hash text PRIMARY KEY,
  product_id varchar REFERENCES public.products(internal_code) ON DELETE SET NULL,
  file_name text NOT NULL,
  normalized_hash text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.affiliates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  email text,
  referral_code text UNIQUE NOT NULL,
  grade integer DEFAULT 1 CHECK (grade BETWEEN 1 AND 5),
  commission_rate numeric(5,3) DEFAULT 0.09,
  bonus_rate numeric(5,3) DEFAULT 0,
  is_active boolean DEFAULT true,
  payout_type text DEFAULT 'PERSONAL' CHECK (payout_type IN ('PERSONAL','BUSINESS')),
  encrypted_bank_info text,
  booking_count integer DEFAULT 0,
  total_commission numeric(12,0) DEFAULT 0,
  memo text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pin_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  attempted_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.affiliate_content_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  card_news_id uuid REFERENCES public.card_news(id) ON DELETE SET NULL,
  insight_type text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  source_data jsonb,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.affiliate_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  business_type text NOT NULL DEFAULT 'individual',
  business_number text,
  channel_type text NOT NULL DEFAULT 'other',
  channel_url text NOT NULL DEFAULT '',
  follower_count integer,
  intro text,
  status text NOT NULL DEFAULT 'pending',
  reject_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  has_invite_code boolean NOT NULL DEFAULT false,
  application_risk_score integer NOT NULL DEFAULT 0,
  application_risk_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.influencer_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  package_id uuid NOT NULL REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  package_title text,
  short_url text NOT NULL,
  click_count integer NOT NULL DEFAULT 0,
  conversion_count integer NOT NULL DEFAULT 0,
  unique_visitor_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (affiliate_id, package_id, short_url)
);

CREATE TABLE IF NOT EXISTS public.message_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  log_type text NOT NULL DEFAULT 'system',
  event_type text,
  title text,
  content text,
  payload jsonb DEFAULT '{}'::jsonb,
  status text,
  is_mock boolean NOT NULL DEFAULT false,
  created_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  affiliate_id uuid REFERENCES public.affiliates(id) ON DELETE SET NULL,
  land_operator_id uuid REFERENCES public.land_operators(id) ON DELETE SET NULL,
  settlement_period text NOT NULL,
  status text DEFAULT 'pending',
  total_amount numeric(14,0) DEFAULT 0,
  final_payout numeric(14,0) DEFAULT 0,
  final_total numeric(14,0) DEFAULT 0,
  tax_deduction numeric(14,0) DEFAULT 0,
  qualified_booking_count integer DEFAULT 0,
  carryover_balance numeric(14,0) DEFAULT 0,
  pdf_url text,
  hold_reason text,
  held_at timestamptz,
  released_at timestamptz,
  settled_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.free_travel_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination text NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  departure text NOT NULL DEFAULT '부산',
  pax_adults integer NOT NULL DEFAULT 2,
  pax_children integer NOT NULL DEFAULT 0,
  customer_name text,
  customer_phone text,
  source text NOT NULL DEFAULT 'web',
  plan_json jsonb,
  plan_expires_at timestamptz,
  converted_to_package_id uuid REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_packages_status ON public.travel_packages(status);
CREATE INDEX IF NOT EXISTS idx_packages_destination ON public.travel_packages(destination);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON public.qa_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_created_at ON public.qa_inquiries(created_at);
CREATE INDEX IF NOT EXISTS idx_responses_inquiry_id ON public.ai_responses(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_responses_created_at ON public.ai_responses(created_at);
CREATE INDEX IF NOT EXISTS idx_bank_tx_status ON public.bank_transactions(match_status);
CREATE INDEX IF NOT EXISTS idx_bank_tx_booking ON public.bank_transactions(booking_id);
CREATE INDEX IF NOT EXISTS idx_bank_tx_type ON public.bank_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_bank_tx_received ON public.bank_transactions(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_tx_name ON public.bank_transactions(counterparty_name);
CREATE INDEX IF NOT EXISTS idx_bank_tx_event ON public.bank_transactions(slack_event_id);
CREATE INDEX IF NOT EXISTS idx_attractions_name ON public.attractions(name);
CREATE INDEX IF NOT EXISTS idx_attractions_country ON public.attractions(country);
CREATE INDEX IF NOT EXISTS idx_attractions_mention ON public.attractions(mention_count DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unmatched_activity ON public.unmatched_activities(activity);
CREATE INDEX IF NOT EXISTS idx_unmatched_status ON public.unmatched_activities(status);
CREATE INDEX IF NOT EXISTS idx_os_policies_category ON public.os_policies(category);
CREATE INDEX IF NOT EXISTS idx_os_policies_active ON public.os_policies(is_active);
CREATE INDEX IF NOT EXISTS idx_os_policies_dates ON public.os_policies(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_os_policies_trigger ON public.os_policies USING gin(trigger_config);
CREATE INDEX IF NOT EXISTS idx_os_policies_scope ON public.os_policies USING gin(target_scope);
CREATE INDEX IF NOT EXISTS idx_cc_product ON public.content_creatives(product_id);
CREATE INDEX IF NOT EXISTS idx_cc_angle ON public.content_creatives(angle_type);
CREATE INDEX IF NOT EXISTS idx_cc_channel ON public.content_creatives(channel);
CREATE INDEX IF NOT EXISTS idx_cc_status ON public.content_creatives(status);
CREATE INDEX IF NOT EXISTS idx_cc_tracking ON public.content_creatives(tracking_id);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_package ON public.ad_campaigns(package_id);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_status ON public.ad_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_channel ON public.ad_campaigns(channel);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_campaign ON public.ad_creatives(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_product ON public.ad_creatives(product_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_landing_content ON public.ad_creatives(landing_content_creative_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_status ON public.ad_creatives(status);
CREATE INDEX IF NOT EXISTS idx_ad_perf_campaign_date ON public.ad_performance_snapshots(campaign_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_creative_edits_creative ON public.creative_edits(creative_id);
CREATE INDEX IF NOT EXISTS idx_creative_perf_creative_date ON public.creative_performance(creative_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_winning_patterns_lookup ON public.winning_patterns(channel, creative_type, hook_type);
CREATE INDEX IF NOT EXISTS idx_blog_topic_queue_status ON public.blog_topic_queue(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_blog_topic_queue_product ON public.blog_topic_queue(product_id);
CREATE INDEX IF NOT EXISTS idx_blog_topic_queue_card_news ON public.blog_topic_queue(card_news_id);
CREATE INDEX IF NOT EXISTS idx_blog_topic_queue_content_creative ON public.blog_topic_queue(content_creative_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON public.products(status);
CREATE INDEX IF NOT EXISTS idx_products_departure_date ON public.products(departure_date);
CREATE INDEX IF NOT EXISTS idx_products_supplier_code ON public.products(supplier_code);
CREATE INDEX IF NOT EXISTS idx_products_internal_code_prefix ON public.products(internal_code text_pattern_ops);
CREATE UNIQUE INDEX IF NOT EXISTS document_hashes_normalized_hash_key
  ON public.document_hashes(normalized_hash)
  WHERE normalized_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_actions_status_created
  ON public.agent_actions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_land_operators_name ON public.land_operators(name);
CREATE INDEX IF NOT EXISTS idx_land_operators_aliases_gin ON public.land_operators USING gin(aliases);
CREATE INDEX IF NOT EXISTS idx_card_news_package ON public.card_news(package_id);
CREATE INDEX IF NOT EXISTS idx_card_news_status ON public.card_news(status);
CREATE INDEX IF NOT EXISTS idx_inf_links_affiliate ON public.influencer_links(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_inf_links_referral ON public.influencer_links(referral_code);
CREATE INDEX IF NOT EXISTS idx_inf_links_package ON public.influencer_links(package_id);

CREATE OR REPLACE FUNCTION public.update_products_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_products_updated_at();

DROP TRIGGER IF EXISTS trg_land_operators_updated_at ON public.land_operators;
CREATE TRIGGER trg_land_operators_updated_at
  BEFORE UPDATE ON public.land_operators
  FOR EACH ROW EXECUTE FUNCTION public.update_products_updated_at();

CREATE OR REPLACE FUNCTION public.update_bank_tx_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_tx_updated_at ON public.bank_transactions;
CREATE TRIGGER trg_bank_tx_updated_at
  BEFORE UPDATE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_bank_tx_timestamp();

CREATE OR REPLACE FUNCTION public.update_attractions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attractions_updated_at ON public.attractions;
CREATE TRIGGER trg_attractions_updated_at
  BEFORE UPDATE ON public.attractions
  FOR EACH ROW EXECUTE FUNCTION public.update_attractions_updated_at();

CREATE OR REPLACE FUNCTION public.update_os_policies_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_os_policies_updated_at ON public.os_policies;
CREATE TRIGGER trg_os_policies_updated_at
  BEFORE UPDATE ON public.os_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_os_policies_updated_at();

CREATE OR REPLACE FUNCTION public.update_content_creatives_ts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cc_updated ON public.content_creatives;
CREATE TRIGGER trg_cc_updated
  BEFORE UPDATE ON public.content_creatives
  FOR EACH ROW EXECUTE FUNCTION public.update_content_creatives_ts();

CREATE OR REPLACE FUNCTION public.update_blog_topic_queue_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_blog_topic_queue_updated_at ON public.blog_topic_queue;
CREATE TRIGGER trg_blog_topic_queue_updated_at
  BEFORE UPDATE ON public.blog_topic_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_blog_topic_queue_updated_at();

CREATE OR REPLACE FUNCTION public.generate_booking_no()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  next_no integer;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(booking_no FROM 4) AS integer)), 0) + 1
  INTO next_no
  FROM public.bookings
  WHERE booking_no ~ '^BK-[0-9]+$';

  NEW.booking_no := 'BK-' || LPAD(next_no::text, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_booking_no ON public.bookings;
CREATE TRIGGER set_booking_no
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  WHEN (NEW.booking_no IS NULL OR NEW.booking_no = '')
  EXECUTE FUNCTION public.generate_booking_no();
