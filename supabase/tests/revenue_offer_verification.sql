BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(3);

SELECT ok(
  (
    SELECT COUNT(*) = 4
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'travel_packages'
      AND column_name IN (
        'price_checked_at',
        'inventory_status',
        'inventory_checked_at',
        'expected_contribution_margin'
      )
  ),
  'travel_packages has explicit price, inventory, and margin evidence fields'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.travel_packages'::regclass
      AND conname = 'travel_packages_inventory_status_check'
  ),
  'inventory state is constrained'
);

SELECT ok(
  (
    SELECT COUNT(*) = 4
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'travel_packages'
      AND column_name IN (
        'price_checked_at',
        'inventory_status',
        'inventory_checked_at',
        'expected_contribution_margin'
      )
      AND column_default IS NULL
  ),
  'verification fields have no fabricated default evidence'
);

SELECT * FROM finish();
ROLLBACK;
