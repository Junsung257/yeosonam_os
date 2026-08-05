-- Aggregate reconciliation. Investigate mismatches by internal id only in a protected session.
select
  count(*) filter (where coalesce(is_deleted, false) is false) as active_bookings,
  count(*) filter (where coalesce(is_deleted, false) is false and coalesce(paid_amount, 0) > 0) as paid_bookings,
  coalesce(sum(paid_amount) filter (where coalesce(is_deleted, false) is false), 0) as booking_paid_total,
  coalesce(sum(total_price) filter (where coalesce(is_deleted, false) is false), 0) as booking_sales_total,
  coalesce(sum(margin) filter (where coalesce(is_deleted, false) is false), 0) as recorded_margin_total
from public.bookings;

select
  (select count(*) from public.transactions) as payment_transactions,
  (select count(*) from public.bank_transactions) as bank_transactions,
  (select count(*) from public.ledger_entries) as ledger_entries,
  (select count(*) from public.settlements) as settlements;

select
  b.id as booking_id,
  b.status,
  b.total_price,
  b.paid_amount,
  b.margin,
  count(le.id) as ledger_entry_count
from public.bookings b
left join public.ledger_entries le on le.booking_id = b.id
where coalesce(b.is_deleted, false) is false
group by b.id, b.status, b.total_price, b.paid_amount, b.margin
having coalesce(b.paid_amount, 0) > 0 and count(le.id) = 0
order by b.created_at desc;
