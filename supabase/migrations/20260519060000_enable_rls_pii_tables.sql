-- Enable RLS on 8 PII tables (Security Sprint 1 Action #13)
-- Blocks unauthorized access at database level
-- Policies: admins see all, users see only their own data

-- 1. customers table RLS
ALTER TABLE IF EXISTS public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customers_admin_all ON public.customers;
DROP POLICY IF EXISTS customers_owner_select ON public.customers;

CREATE POLICY customers_admin_all ON public.customers
  AS PERMISSIVE FOR ALL
  USING (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  WITH CHECK (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

CREATE POLICY customers_owner_select ON public.customers
  AS PERMISSIVE FOR SELECT
  USING (auth.jwt() ->> 'role' = 'authenticated' AND (id = (auth.jwt() ->> 'sub')));

-- 2. bookings table RLS
ALTER TABLE IF EXISTS public.bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bookings_admin_all ON public.bookings;
DROP POLICY IF EXISTS bookings_customer_select ON public.bookings;

CREATE POLICY bookings_admin_all ON public.bookings
  AS PERMISSIVE FOR ALL
  USING (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  WITH CHECK (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

CREATE POLICY bookings_customer_select ON public.bookings
  AS PERMISSIVE FOR SELECT
  USING (auth.jwt() ->> 'role' = 'authenticated' AND (lead_customer_id = (auth.jwt() ->> 'sub')));

-- 3. settlements table RLS
ALTER TABLE IF EXISTS public.settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlements_admin_all ON public.settlements;

CREATE POLICY settlements_admin_all ON public.settlements
  AS PERMISSIVE FOR ALL
  USING (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  WITH CHECK (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- 4. customer_notes table RLS
ALTER TABLE IF EXISTS public.customer_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_notes_admin_all ON public.customer_notes;
DROP POLICY IF EXISTS customer_notes_owner_select ON public.customer_notes;

CREATE POLICY customer_notes_admin_all ON public.customer_notes
  AS PERMISSIVE FOR ALL
  USING (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  WITH CHECK (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

CREATE POLICY customer_notes_owner_select ON public.customer_notes
  AS PERMISSIVE FOR SELECT
  USING (auth.jwt() ->> 'role' = 'authenticated' AND
         EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_notes.customer_id AND c.id = (auth.jwt() ->> 'sub')));

-- 5. booking_companions table RLS
ALTER TABLE IF EXISTS public.booking_companions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_companions_admin_all ON public.booking_companions;
DROP POLICY IF EXISTS booking_companions_customer_select ON public.booking_companions;

CREATE POLICY booking_companions_admin_all ON public.booking_companions
  AS PERMISSIVE FOR ALL
  USING (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  WITH CHECK (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

CREATE POLICY booking_companions_customer_select ON public.booking_companions
  AS PERMISSIVE FOR SELECT
  USING (auth.jwt() ->> 'role' = 'authenticated' AND
         EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_companions.booking_id AND b.lead_customer_id = (auth.jwt() ->> 'sub')));

-- 6. affiliates table RLS
ALTER TABLE IF EXISTS public.affiliates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS affiliates_admin_all ON public.affiliates;

CREATE POLICY affiliates_admin_all ON public.affiliates
  AS PERMISSIVE FOR ALL
  USING (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  WITH CHECK (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- 7. conversations table RLS
ALTER TABLE IF EXISTS public.conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversations_admin_all ON public.conversations;
DROP POLICY IF EXISTS conversations_participant_select ON public.conversations;

CREATE POLICY conversations_admin_all ON public.conversations
  AS PERMISSIVE FOR ALL
  USING (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  WITH CHECK (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

CREATE POLICY conversations_participant_select ON public.conversations
  AS PERMISSIVE FOR SELECT
  USING (auth.jwt() ->> 'role' = 'authenticated' AND
         (participant_1_id = (auth.jwt() ->> 'sub') OR participant_2_id = (auth.jwt() ->> 'sub')));

-- 8. secure_chats table RLS
ALTER TABLE IF EXISTS public.secure_chats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS secure_chats_admin_all ON public.secure_chats;
DROP POLICY IF EXISTS secure_chats_participant_select ON public.secure_chats;

CREATE POLICY secure_chats_admin_all ON public.secure_chats
  AS PERMISSIVE FOR ALL
  USING (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  WITH CHECK (auth.jwt() ->> 'role' = 'authenticated' AND (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

CREATE POLICY secure_chats_participant_select ON public.secure_chats
  AS PERMISSIVE FOR SELECT
  USING (auth.jwt() ->> 'role' = 'authenticated' AND
         (sender_id = (auth.jwt() ->> 'sub') OR
          EXISTS (SELECT 1 FROM bookings b WHERE b.id = secure_chats.booking_id AND b.lead_customer_id = (auth.jwt() ->> 'sub'))));
