-- Keep append-only trigger functions independent from caller-controlled schemas.
-- These functions intentionally reference no application relations.

create or replace function internal_product_registration.reject_benchmark_case_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'REGISTRATION_BENCHMARK_APPEND_ONLY';
end;
$$;

create or replace function internal_product_registration.reject_source_bundle_immutable_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'PRODUCT_REGISTRATION_SOURCE_BUNDLE_APPEND_ONLY';
end;
$$;
