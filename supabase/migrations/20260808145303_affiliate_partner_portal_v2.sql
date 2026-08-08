-- Partner portal onboarding and saved-product contract.
BEGIN;

ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS payout_profile_status text NOT NULL DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN IF NOT EXISTS tax_profile_status text NOT NULL DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN IF NOT EXISTS onboarding_progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS suspended_reason text NULL,
  ADD COLUMN IF NOT EXISTS terminated_reason text NULL;

ALTER TABLE public.affiliates
  DROP CONSTRAINT IF EXISTS affiliates_payout_profile_status_chk,
  ADD CONSTRAINT affiliates_payout_profile_status_chk CHECK (
    payout_profile_status IN ('NOT_SUBMITTED', 'PENDING_REVIEW', 'VERIFIED', 'CHANGES_REQUIRED', 'LOCKED')
  ) NOT VALID,
  DROP CONSTRAINT IF EXISTS affiliates_tax_profile_status_chk,
  ADD CONSTRAINT affiliates_tax_profile_status_chk CHECK (
    tax_profile_status IN ('NOT_SUBMITTED', 'PENDING_REVIEW', 'VERIFIED', 'CHANGES_REQUIRED', 'LOCKED')
  ) NOT VALID;

ALTER TABLE public.affiliates VALIDATE CONSTRAINT affiliates_payout_profile_status_chk;
ALTER TABLE public.affiliates VALIDATE CONSTRAINT affiliates_tax_profile_status_chk;

-- The boolean application flag remains a compatibility/reporting field. The
-- durable relationship is filled once the approval transaction creates the
-- one-time invitation row.
ALTER TABLE public.affiliate_applications
  ADD COLUMN IF NOT EXISTS invitation_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'affiliate_applications_invitation_id_fkey'
      AND conrelid = 'public.affiliate_applications'::regclass
  ) THEN
    ALTER TABLE public.affiliate_applications
      ADD CONSTRAINT affiliate_applications_invitation_id_fkey
      FOREIGN KEY (invitation_id) REFERENCES public.affiliate_invitations(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_affiliate_application_invitation_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.affiliate_applications
  SET invitation_id = NEW.id
  WHERE id = NEW.application_id AND invitation_id IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS affiliate_invitation_application_link_v2 ON public.affiliate_invitations;
CREATE TRIGGER affiliate_invitation_application_link_v2
AFTER INSERT ON public.affiliate_invitations
FOR EACH ROW EXECUTE FUNCTION public.link_affiliate_application_invitation_v2();
REVOKE ALL ON FUNCTION public.link_affiliate_application_invitation_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_affiliate_application_invitation_v2() TO service_role;

ALTER TABLE public.affiliate_channels
  ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.affiliate_domains
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_channels_idempotency_uq
  ON public.affiliate_channels(affiliate_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_domains_idempotency_uq
  ON public.affiliate_domains(affiliate_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.affiliate_terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE RESTRICT,
  document_type text NOT NULL,
  document_version text NOT NULL,
  document_hash text NOT NULL,
  accepted_by text NOT NULL,
  ip_hash text NULL,
  user_agent_hash text NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_terms_type_chk CHECK (
    document_type IN ('AFFILIATE_AGREEMENT', 'PRIVACY', 'AD_DISCLOSURE', 'PAYOUT_POLICY')
  ),
  CONSTRAINT affiliate_terms_hash_chk CHECK (document_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE (affiliate_id, document_type, document_version)
);

CREATE TABLE IF NOT EXISTS public.affiliate_saved_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  note text NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (affiliate_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.affiliate_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_collections_name_chk CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT affiliate_collections_status_chk CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  UNIQUE (affiliate_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.affiliate_collection_products (
  collection_id uuid NOT NULL REFERENCES public.affiliate_collections(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, product_id),
  CONSTRAINT affiliate_collection_products_position_chk CHECK (position >= 0)
);

CREATE TABLE IF NOT EXISTS public.affiliate_funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  affiliate_id uuid NULL REFERENCES public.affiliates(id) ON DELETE SET NULL,
  publication_id uuid NULL REFERENCES public.affiliate_publications(id) ON DELETE SET NULL,
  product_id uuid NULL REFERENCES public.travel_packages(id) ON DELETE SET NULL,
  booking_id uuid NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
  settlement_run_id uuid NULL REFERENCES public.settlement_runs(id) ON DELETE SET NULL,
  policy_version text NULL,
  actor_type text NOT NULL DEFAULT 'system',
  trace_id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_schema_version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NULL,
  CONSTRAINT affiliate_funnel_event_name_chk CHECK (event_name IN (
    'affiliate_application_started', 'affiliate_application_submitted',
    'affiliate_application_needs_info', 'affiliate_application_approved',
    'affiliate_invitation_sent', 'affiliate_invitation_opened',
    'affiliate_session_created', 'affiliate_onboarding_step_completed',
    'affiliate_product_viewed', 'affiliate_product_saved',
    'affiliate_publication_created', 'affiliate_publication_test_passed',
    'affiliate_publication_published', 'affiliate_touchpoint_received',
    'affiliate_touchpoint_validated', 'affiliate_attribution_decided',
    'affiliate_booking_attributed', 'commission_ledger_entry_created',
    'settlement_run_created', 'settlement_held', 'settlement_ready',
    'payout_completed', 'affiliate_dispute_opened', 'affiliate_dispute_resolved'
  )),
  CONSTRAINT affiliate_funnel_actor_chk CHECK (actor_type IN ('affiliate', 'admin', 'system', 'customer', 'cron')),
  CONSTRAINT affiliate_funnel_schema_chk CHECK (event_schema_version > 0)
);

CREATE INDEX IF NOT EXISTS affiliate_funnel_events_affiliate_idx
  ON public.affiliate_funnel_events(affiliate_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_funnel_events_name_idx
  ON public.affiliate_funnel_events(event_name, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_funnel_events_idempotency_uq
  ON public.affiliate_funnel_events(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS affiliate_saved_products_owner_idx
  ON public.affiliate_saved_products(affiliate_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_collections_owner_idx
  ON public.affiliate_collections(affiliate_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_terms_acceptance_mutation_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'TERMS_ACCEPTANCE_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS affiliate_terms_acceptances_immutable_v2 ON public.affiliate_terms_acceptances;
CREATE TRIGGER affiliate_terms_acceptances_immutable_v2
BEFORE UPDATE OR DELETE ON public.affiliate_terms_acceptances
FOR EACH ROW EXECUTE FUNCTION public.prevent_terms_acceptance_mutation_v2();

ALTER TABLE public.affiliate_terms_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_saved_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_collection_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_funnel_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.affiliate_terms_acceptances, public.affiliate_saved_products,
  public.affiliate_collections, public.affiliate_collection_products, public.affiliate_funnel_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.affiliate_terms_acceptances, public.affiliate_saved_products,
  public.affiliate_collections, public.affiliate_collection_products, public.affiliate_funnel_events TO service_role;

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'affiliate_terms_acceptances', 'affiliate_saved_products',
    'affiliate_collections', 'affiliate_collection_products', 'affiliate_funnel_events'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_service_role_all ON public.%I', v_table, v_table);
    EXECUTE format(
      'CREATE POLICY %I_service_role_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      v_table, v_table
    );
  END LOOP;
END;
$$;

COMMENT ON TABLE public.affiliate_terms_acceptances IS
  'Immutable, versioned evidence for each legally distinct partner document.';
COMMENT ON TABLE public.affiliate_saved_products IS
  'Partner shortlist used before creating a publication.';
COMMENT ON TABLE public.affiliate_funnel_events IS
  'PII-free affiliate funnel events. Analytics consumers must use this table instead of client-side identity joins.';

-- Commission ledger writes are the authoritative booking-to-earnings boundary.
-- The trigger is best-effort so analytics storage cannot block a financial write.
CREATE OR REPLACE FUNCTION public.record_affiliate_ledger_funnel_event_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.affiliate_funnel_events (
    event_name, affiliate_id, booking_id, policy_version, actor_type,
    trace_id, payload, idempotency_key
  ) VALUES (
    'commission_ledger_entry_created', NEW.affiliate_id, NEW.booking_id,
    NEW.policy_set_version, 'system',
    COALESCE(NEW.calculation_trace_id, gen_random_uuid()),
    jsonb_build_object(
      'entry_type', NEW.entry_type,
      'amount_krw', NEW.amount_krw,
      'commission_base_krw', NEW.commission_base_krw,
      'commission_rate', NEW.commission_rate,
      'hold_reason', NEW.hold_reason
    ),
    'ledger-entry-created:' || NEW.id::text
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commission_ledger_funnel_event_v2 ON public.commission_ledger_entries;
CREATE TRIGGER commission_ledger_funnel_event_v2
AFTER INSERT ON public.commission_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.record_affiliate_ledger_funnel_event_v2();

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Reversible rollback (before portal V2 rows are used):
-- BEGIN;
-- DROP TRIGGER IF EXISTS affiliate_invitation_application_link_v2 ON public.affiliate_invitations;
-- DROP FUNCTION IF EXISTS public.link_affiliate_application_invitation_v2();
-- ALTER TABLE public.affiliate_applications DROP CONSTRAINT IF EXISTS affiliate_applications_invitation_id_fkey;
-- ALTER TABLE public.affiliate_applications DROP COLUMN IF EXISTS invitation_id;
-- DROP TABLE IF EXISTS public.affiliate_funnel_events;
-- DROP TABLE IF EXISTS public.affiliate_collection_products, public.affiliate_collections,
--   public.affiliate_saved_products, public.affiliate_terms_acceptances;
-- ALTER TABLE public.affiliates DROP COLUMN IF EXISTS terminated_reason,
--   DROP COLUMN IF EXISTS suspended_reason, DROP COLUMN IF EXISTS onboarding_progress,
--   DROP COLUMN IF EXISTS tax_profile_status, DROP COLUMN IF EXISTS payout_profile_status;
-- COMMIT;
