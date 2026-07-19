BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(9);

SELECT has_function('public', 'import_band_product_atomically', ARRAY['jsonb', 'jsonb'],
  'Band import exposes one atomic product-and-audit RPC');

SELECT is(
  public.import_band_product_atomically(
    '{"internal_code":"R16-BAND-0001","display_name":"R16 Band","departure_region":"부산","supplier_code":"BAND","net_price":10000,"margin_rate":0.1,"ai_tags":["band"],"source_filename":"r16"}'::jsonb,
    '{"post_url":"https://example.com/r16-band-1","post_title":"R16 Band","raw_text":"safe excerpt"}'::jsonb
  ),
  'R16-BAND-0001',
  'atomic Band import returns the products primary key'
);
SELECT is((SELECT status::text FROM public.products WHERE internal_code = 'R16-BAND-0001'), 'draft',
  'Band products use the real lowercase status contract');
SELECT is((SELECT product_internal_code::text FROM public.band_import_log WHERE post_url = 'https://example.com/r16-band-1'), 'R16-BAND-0001',
  'the audit log references products.internal_code explicitly');
SELECT is((SELECT product_id FROM public.band_import_log WHERE post_url = 'https://example.com/r16-band-1'), NULL::uuid,
  'the travel_packages reference is not overloaded');

SELECT throws_ok(
  $$SELECT public.import_band_product_atomically(
    '{"internal_code":"R16-BAND-0001","display_name":"R16 Band","departure_region":"부산","supplier_code":"BAND","net_price":10000}'::jsonb,
    '{"post_url":"https://example.com/r16-band-1","post_title":"R16 Band"}'::jsonb
  )$$,
  '23505', 'duplicate key value violates unique constraint "products_pkey"',
  'an exact retry is rejected without duplicating product or audit rows'
);

INSERT INTO public.band_import_log (post_url, post_title, status)
VALUES ('https://example.com/r16-band-conflict', 'existing', 'skipped');
SELECT throws_ok(
  $$SELECT public.import_band_product_atomically(
    '{"internal_code":"R16-BAND-ROLLBACK","display_name":"Rollback","departure_region":"부산","supplier_code":"BAND","net_price":10000}'::jsonb,
    '{"post_url":"https://example.com/r16-band-conflict","post_title":"conflict"}'::jsonb
  )$$,
  '23505', 'duplicate key value violates unique constraint "band_import_log_post_url_key"',
  'an audit-log conflict aborts the atomic import'
);
SELECT is((SELECT count(*)::integer FROM public.products WHERE internal_code = 'R16-BAND-ROLLBACK'), 0,
  'an audit-log failure rolls back the product insert');
SELECT is((SELECT count(*)::integer FROM public.products WHERE internal_code = 'R16-BAND-0001'), 1,
  'the successful import remains exactly once');

SELECT * FROM finish();
ROLLBACK;
