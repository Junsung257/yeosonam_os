-- Supabase advisor 0007: policies do not protect a table until RLS is enabled.
-- Each table below already has explicit policies; enabling RLS activates the
-- intended access contract and remains idempotent on environments already fixed.
ALTER TABLE public.booking_passengers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departing_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfq_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfq_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
