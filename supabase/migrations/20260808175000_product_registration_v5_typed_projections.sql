-- Typed V5 projections derived from an immutable canonical revision.
-- They are read-only projections for validation and future customer snapshots;
-- operators must never edit them directly.

create table if not exists public.product_registration_v5_price_rules (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.product_registration_v5_revisions(id) on delete cascade,
  section_index integer not null check (section_index >= 0),
  variant_key text not null,
  component_type text not null
    check (component_type in ('base', 'adult', 'child', 'infant', 'single_supplement', 'fuel_surcharge', 'tax', 'local_fee', 'tip', 'optional_tour', 'room_upgrade', 'discount')),
  scope text not null
    check (scope in ('specific_departure', 'date_range', 'weekday', 'always')),
  specific_date date,
  effective_start date,
  effective_end date,
  weekday smallint check (weekday is null or weekday between 0 and 6),
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null check (btrim(currency) <> ''),
  charge_basis text not null default 'per_person'
    check (charge_basis in ('per_person', 'per_room', 'per_booking', 'per_night')),
  inclusion text not null default 'included'
    check (inclusion in ('included', 'excluded', 'payable_local', 'optional')),
  source_field_path text not null,
  evidence_ref jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_ref) = 'object'),
  rule_hash text not null check (rule_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check (effective_start is null or effective_end is null or effective_start <= effective_end),
  check (
    (scope = 'specific_departure' and specific_date is not null)
    or (scope = 'date_range' and effective_start is not null and effective_end is not null)
    or (scope = 'weekday' and weekday is not null)
    or (scope = 'always')
  ),
  unique (revision_id, rule_hash)
);

comment on table public.product_registration_v5_price_rules is
  'Evidence-bound typed pricing rules projected from a V5 revision; never a mutable source of truth.';

create index if not exists idx_product_registration_v5_price_rules_revision
  on public.product_registration_v5_price_rules(revision_id, section_index, variant_key);
create index if not exists idx_product_registration_v5_price_rules_date
  on public.product_registration_v5_price_rules(revision_id, specific_date, effective_start, effective_end);

create table if not exists public.product_registration_v5_itinerary_items (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.product_registration_v5_revisions(id) on delete cascade,
  section_index integer not null check (section_index >= 0),
  variant_key text not null,
  day_index integer not null check (day_index >= 1),
  sequence_no integer not null check (sequence_no >= 0),
  item_type text not null
    check (item_type in ('flight', 'ferry', 'ground_transport', 'attraction', 'meal', 'lodging', 'shopping', 'optional_tour', 'free_time', 'meeting', 'note', 'unknown')),
  start_time text,
  timezone text,
  title text not null,
  description text,
  canonical_id text,
  source_field_path text not null,
  evidence_ref jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_ref) = 'object'),
  item_hash text not null check (item_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (revision_id, item_hash)
);

comment on table public.product_registration_v5_itinerary_items is
  'Ordered typed itinerary items projected from source-backed V3 ledger facts.';

create index if not exists idx_product_registration_v5_itinerary_items_revision
  on public.product_registration_v5_itinerary_items(revision_id, section_index, variant_key, day_index, sequence_no);
create index if not exists idx_product_registration_v5_itinerary_items_type
  on public.product_registration_v5_itinerary_items(revision_id, item_type);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'product_registration_v5_price_rules',
    'product_registration_v5_itinerary_items'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_service_role', table_name);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      table_name || '_service_role',
      table_name
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
    execute format('drop trigger if exists %I on public.%I', table_name || '_immutable', table_name);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.product_registration_v5_reject_mutation()',
      table_name || '_immutable',
      table_name
    );
  end loop;
end;
$$;
