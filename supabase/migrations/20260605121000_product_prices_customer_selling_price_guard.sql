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

drop trigger if exists trg_fill_product_prices_adult_selling_price on public.product_prices;

create trigger trg_fill_product_prices_adult_selling_price
before insert or update of net_price, adult_selling_price on public.product_prices
for each row
execute function public.fill_product_prices_adult_selling_price();

update public.product_prices
   set adult_selling_price = net_price
 where adult_selling_price is null
   and net_price is not null
   and net_price > 0;

alter table public.product_prices
  drop constraint if exists product_prices_adult_selling_price_present;

alter table public.product_prices
  add constraint product_prices_adult_selling_price_present
  check (net_price is null or net_price <= 0 or adult_selling_price is not null)
  not valid;

alter table public.product_prices
  validate constraint product_prices_adult_selling_price_present;
