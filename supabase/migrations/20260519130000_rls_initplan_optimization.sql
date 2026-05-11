-- Auto-generated: wrap auth.uid()/role()/jwt() in (SELECT ...) for InitPlan caching
-- Source: 57 policies flagged by Supabase advisor auth_rls_initplan

-- ad_accounts.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."ad_accounts";
CREATE POLICY "authenticated_access" ON public."ad_accounts"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- ad_conversion_logs.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."ad_conversion_logs";
CREATE POLICY "authenticated_access" ON public."ad_conversion_logs"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- ad_engagement_logs.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."ad_engagement_logs";
CREATE POLICY "authenticated_access" ON public."ad_engagement_logs"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- ad_search_logs.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."ad_search_logs";
CREATE POLICY "authenticated_access" ON public."ad_search_logs"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- ad_traffic_logs.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."ad_traffic_logs";
CREATE POLICY "authenticated_access" ON public."ad_traffic_logs"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- ai_responses.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."ai_responses";
CREATE POLICY "authenticated_access" ON public."ai_responses"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- airline_exclusions.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."airline_exclusions";
CREATE POLICY "authenticated_access" ON public."airline_exclusions"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- api_orders.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."api_orders";
CREATE POLICY "authenticated_access" ON public."api_orders"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- app_settings.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."app_settings";
CREATE POLICY "authenticated_access" ON public."app_settings"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- archive_docs.service_role_full_access
DROP POLICY IF EXISTS "service_role_full_access" ON public."archive_docs";
CREATE POLICY "service_role_full_access" ON public."archive_docs"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((SELECT auth.role()) = 'service_role'::text))
  WITH CHECK (((SELECT auth.role()) = 'service_role'::text));

-- bank_transactions.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."bank_transactions";
CREATE POLICY "authenticated_access" ON public."bank_transactions"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- booking_passengers.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."booking_passengers";
CREATE POLICY "authenticated_access" ON public."booking_passengers"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- bookings.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."bookings";
CREATE POLICY "authenticated_access" ON public."bookings"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- capital_entries.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."capital_entries";
CREATE POLICY "authenticated_access" ON public."capital_entries"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- carts.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."carts";
CREATE POLICY "authenticated_access" ON public."carts"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- content_factory_jobs.service_role_all
DROP POLICY IF EXISTS "service_role_all" ON public."content_factory_jobs";
CREATE POLICY "service_role_all" ON public."content_factory_jobs"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((SELECT auth.role()) = 'service_role'::text))
  WITH CHECK (((SELECT auth.role()) = 'service_role'::text));

-- customer_notes.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."customer_notes";
CREATE POLICY "authenticated_access" ON public."customer_notes"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- customers.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."customers";
CREATE POLICY "authenticated_access" ON public."customers"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- external_bookings.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."external_bookings";
CREATE POLICY "authenticated_access" ON public."external_bookings"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- group_rfqs.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."group_rfqs";
CREATE POLICY "authenticated_access" ON public."group_rfqs"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- instagram_accounts.service_role_all
DROP POLICY IF EXISTS "service_role_all" ON public."instagram_accounts";
CREATE POLICY "service_role_all" ON public."instagram_accounts"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((SELECT auth.role()) = 'service_role'::text))
  WITH CHECK (((SELECT auth.role()) = 'service_role'::text));

-- inventory_blocks.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."inventory_blocks";
CREATE POLICY "authenticated_access" ON public."inventory_blocks"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- keyword_performances.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."keyword_performances";
CREATE POLICY "authenticated_access" ON public."keyword_performances"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- margin_settings.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."margin_settings";
CREATE POLICY "authenticated_access" ON public."margin_settings"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- message_logs.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."message_logs";
CREATE POLICY "authenticated_access" ON public."message_logs"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- mileage_history.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."mileage_history";
CREATE POLICY "authenticated_access" ON public."mileage_history"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- mileage_transactions.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."mileage_transactions";
CREATE POLICY "authenticated_access" ON public."mileage_transactions"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- mock_api_configs.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."mock_api_configs";
CREATE POLICY "authenticated_access" ON public."mock_api_configs"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- mrt_package_hotel_intel.mrt_package_hotel_intel_service
DROP POLICY IF EXISTS "mrt_package_hotel_intel_service" ON public."mrt_package_hotel_intel";
CREATE POLICY "mrt_package_hotel_intel_service" ON public."mrt_package_hotel_intel"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((SELECT auth.role()) = 'service_role'::text));

-- mrt_stay_detail_snapshots.mrt_stay_detail_snapshots_service
DROP POLICY IF EXISTS "mrt_stay_detail_snapshots_service" ON public."mrt_stay_detail_snapshots";
CREATE POLICY "mrt_stay_detail_snapshots_service" ON public."mrt_stay_detail_snapshots"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((SELECT auth.role()) = 'service_role'::text));

-- normalized_intakes.service-role only
DROP POLICY IF EXISTS "service-role only" ON public."normalized_intakes";
CREATE POLICY "service-role only" ON public."normalized_intakes"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((SELECT auth.role()) = 'service_role'::text));

-- optional_tour_market_rates.otmr_service
DROP POLICY IF EXISTS "otmr_service" ON public."optional_tour_market_rates";
CREATE POLICY "otmr_service" ON public."optional_tour_market_rates"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((SELECT auth.role()) = 'service_role'::text));

-- package_pricings.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."package_pricings";
CREATE POLICY "authenticated_access" ON public."package_pricings"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- package_score_signals.pss_service
DROP POLICY IF EXISTS "pss_service" ON public."package_score_signals";
CREATE POLICY "pss_service" ON public."package_score_signals"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((SELECT auth.role()) = 'service_role'::text));

-- package_scores.package_scores_service
DROP POLICY IF EXISTS "package_scores_service" ON public."package_scores";
CREATE POLICY "package_scores_service" ON public."package_scores"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((SELECT auth.role()) = 'service_role'::text));

-- parsed_packages.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."parsed_packages";
CREATE POLICY "authenticated_access" ON public."parsed_packages"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- partner_sales.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."partner_sales";
CREATE POLICY "authenticated_access" ON public."partner_sales"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- partners.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."partners";
CREATE POLICY "authenticated_access" ON public."partners"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- products.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."products";
CREATE POLICY "authenticated_access" ON public."products"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- push_notifications.push_notifs_self_read
DROP POLICY IF EXISTS "push_notifs_self_read" ON public."push_notifications";
CREATE POLICY "push_notifs_self_read" ON public."push_notifications"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = (SELECT auth.uid())));

-- push_notifications.push_notifs_self_update
DROP POLICY IF EXISTS "push_notifs_self_update" ON public."push_notifications";
CREATE POLICY "push_notifs_self_update" ON public."push_notifications"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((user_id = (SELECT auth.uid())));

-- push_subscriptions.push_subs_self_read
DROP POLICY IF EXISTS "push_subs_self_read" ON public."push_subscriptions";
CREATE POLICY "push_subs_self_read" ON public."push_subscriptions"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = (SELECT auth.uid())));

-- push_subscriptions.push_subs_self_write
DROP POLICY IF EXISTS "push_subs_self_write" ON public."push_subscriptions";
CREATE POLICY "push_subs_self_write" ON public."push_subscriptions"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((user_id = (SELECT auth.uid())))
  WITH CHECK ((user_id = (SELECT auth.uid())));

-- qa_inquiries.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."qa_inquiries";
CREATE POLICY "authenticated_access" ON public."qa_inquiries"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- raw_documents.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."raw_documents";
CREATE POLICY "authenticated_access" ON public."raw_documents"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- rfq_bids.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."rfq_bids";
CREATE POLICY "authenticated_access" ON public."rfq_bids"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- rfq_messages.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."rfq_messages";
CREATE POLICY "authenticated_access" ON public."rfq_messages"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- rfq_proposals.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."rfq_proposals";
CREATE POLICY "authenticated_access" ON public."rfq_proposals"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- scoring_policies.scoring_policies_service
DROP POLICY IF EXISTS "scoring_policies_service" ON public."scoring_policies";
CREATE POLICY "scoring_policies_service" ON public."scoring_policies"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((SELECT auth.role()) = 'service_role'::text));

-- secure_chats.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."secure_chats";
CREATE POLICY "authenticated_access" ON public."secure_chats"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- shared_itineraries.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."shared_itineraries";
CREATE POLICY "authenticated_access" ON public."shared_itineraries"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- sms_payments.인증된 사용자만 접근
DROP POLICY IF EXISTS "인증된 사용자만 접근" ON public."sms_payments";
CREATE POLICY "인증된 사용자만 접근" ON public."sms_payments"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((SELECT auth.role()) = 'authenticated'::text));

-- surcharge_dates.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."surcharge_dates";
CREATE POLICY "authenticated_access" ON public."surcharge_dates"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- tenants.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."tenants";
CREATE POLICY "authenticated_access" ON public."tenants"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- transactions.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."transactions";
CREATE POLICY "authenticated_access" ON public."transactions"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- travel_packages.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."travel_packages";
CREATE POLICY "authenticated_access" ON public."travel_packages"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

-- vouchers.authenticated_access
DROP POLICY IF EXISTS "authenticated_access" ON public."vouchers";
CREATE POLICY "authenticated_access" ON public."vouchers"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (((SELECT auth.role()) = 'authenticated'::text))
  WITH CHECK (((SELECT auth.role()) = 'authenticated'::text));

