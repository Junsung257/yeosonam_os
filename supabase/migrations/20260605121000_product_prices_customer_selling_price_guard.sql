-- Ensure customer-facing product price rows can always render on mobile/A4.
-- The app stores net_price for ledger math, but package detail pages only expose
-- adult_selling_price to customers. A positive net_price must therefore always
-- have a customer-safe selling price.

create or replace function public.fill_product_prices_adult_selling_price()
returns trigger
language plpgsql
as $$
begin
  if new.adult_selling_price is null and new.net_price is not null and new.net_price > 0 then
    new.adult_selling_price := new.net_price;
  end if;

  return new;
end;
$$;

DO $$
BEGIN
  -- product_prices belongs to the separately managed product snapshot schema.
  -- Apply the guard only where that schema is already installed.
  IF to_regclass('public.product_prices') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_fill_product_prices_adult_selling_price
      ON public.product_prices;

    CREATE TRIGGER trg_fill_product_prices_adult_selling_price
      BEFORE INSERT OR UPDATE OF net_price, adult_selling_price
      ON public.product_prices
      FOR EACH ROW
      EXECUTE FUNCTION public.fill_product_prices_adult_selling_price();

    UPDATE public.product_prices
       SET adult_selling_price = net_price
     WHERE adult_selling_price IS NULL
       AND net_price IS NOT NULL
       AND net_price > 0;

    ALTER TABLE public.product_prices
      DROP CONSTRAINT IF EXISTS product_prices_adult_selling_price_present;

    ALTER TABLE public.product_prices
      ADD CONSTRAINT product_prices_adult_selling_price_present
      CHECK (net_price IS NULL OR net_price <= 0 OR adult_selling_price IS NOT NULL)
      NOT VALID;

    ALTER TABLE public.product_prices
      VALIDATE CONSTRAINT product_prices_adult_selling_price_present;
  END IF;
END
$$;
