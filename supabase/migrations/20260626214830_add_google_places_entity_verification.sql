-- Add Google Places as an identity evidence source for entity master verification.
-- This only affects internal evidence/candidate automation. Customer exposure still
-- requires explicit publishable gates or admin approval.

alter table public.entity_verification_attempts
  drop constraint if exists entity_verification_attempts_source_check;

alter table public.entity_verification_attempts
  add constraint entity_verification_attempts_source_check
  check (
    source in (
      'naver_search',
      'naver_searchad',
      'google_places',
      'wikidata',
      'osm_nominatim',
      'internal',
      'manual'
    )
  );

insert into public.entity_source_reliability(source, weight, notes)
values
  ('google_places', 0.86, 'identity source for place id, address, type, and maps URL; customer publishing remains gated')
on conflict (source) do update
set weight = excluded.weight,
    notes = excluded.notes,
    updated_at = now();
