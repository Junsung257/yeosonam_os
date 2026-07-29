-- P0 revenue rescue: explicit evidence timestamps for the one-offer gate.
-- Existing rows remain NULL and therefore cannot become publishable by migration.

ALTER TABLE public.travel_packages
  ADD COLUMN IF NOT EXISTS price_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS inventory_status text,
  ADD COLUMN IF NOT EXISTS inventory_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS expected_contribution_margin integer;

ALTER TABLE public.travel_packages
  DROP CONSTRAINT IF EXISTS travel_packages_inventory_status_check,
  DROP CONSTRAINT IF EXISTS travel_packages_expected_contribution_margin_check;

ALTER TABLE public.travel_packages
  ADD CONSTRAINT travel_packages_inventory_status_check CHECK (
    inventory_status IS NULL
    OR inventory_status IN ('available', 'reconfirm_required', 'sold_out', 'unknown')
  ),
  ADD CONSTRAINT travel_packages_expected_contribution_margin_check CHECK (
    expected_contribution_margin IS NULL OR expected_contribution_margin >= 0
  );

COMMENT ON COLUMN public.travel_packages.price_checked_at IS
  'Human-verified customer price timestamp. NULL means the price is not currently verified.';
COMMENT ON COLUMN public.travel_packages.inventory_checked_at IS
  'Human/provider inventory verification timestamp. NULL means inventory is not currently verified.';
COMMENT ON COLUMN public.travel_packages.inventory_status IS
  'Explicit availability state at inventory_checked_at; never inferred from marketing copy.';
COMMENT ON COLUMN public.travel_packages.expected_contribution_margin IS
  'Expected KRW contribution margin for operator decisioning; never exposed in the public payload.';
