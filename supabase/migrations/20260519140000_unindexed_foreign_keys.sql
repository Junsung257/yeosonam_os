-- ============================================================================
-- Add indexes for 65 unindexed foreign keys (performance advisor)
-- ============================================================================
-- Speeds up:
--   - DELETE/UPDATE cascades (avoids full-table scan on referencing table)
--   - JOINs across the FK relationship
--   - Lookups by the FK column (common admin queries)
--
-- All indexes are btree (default), single-column, NULL-allowed.
-- Note: CREATE INDEX (without CONCURRENTLY) acquires SHARE lock briefly.
-- Applied via Supabase migration transaction.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_abandonment_tracking_customer_id ON public.abandonment_tracking (customer_id);
CREATE INDEX IF NOT EXISTS idx_ad_conversion_logs_user_id ON public.ad_conversion_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_ad_engagement_logs_user_id ON public.ad_engagement_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_training_logs_corrected_by ON public.ai_training_logs (corrected_by);
CREATE INDEX IF NOT EXISTS idx_airline_exclusions_parsed_package_id ON public.airline_exclusions (parsed_package_id);
CREATE INDEX IF NOT EXISTS idx_api_orders_tenant_id ON public.api_orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_block_purchase_plans_supplier_id ON public.block_purchase_plans (supplier_id);
CREATE INDEX IF NOT EXISTS idx_blog_topic_queue_content_creative_id ON public.blog_topic_queue (content_creative_id);
CREATE INDEX IF NOT EXISTS idx_blog_topic_queue_product_id ON public.blog_topic_queue (product_id);
CREATE INDEX IF NOT EXISTS idx_booking_passengers_customer_id ON public.booking_passengers (customer_id);
CREATE INDEX IF NOT EXISTS idx_card_news_design_archetype_id ON public.card_news (design_archetype_id);
CREATE INDEX IF NOT EXISTS idx_card_news_brand_kit_id ON public.card_news (brand_kit_id);
CREATE INDEX IF NOT EXISTS idx_card_news_variants_variant_card_news_id ON public.card_news_variants (variant_card_news_id);
CREATE INDEX IF NOT EXISTS idx_critique_results_affiliate_id ON public.critique_results (affiliate_id);
CREATE INDEX IF NOT EXISTS idx_customer_facts_conversation_id ON public.customer_facts (conversation_id);
CREATE INDEX IF NOT EXISTS idx_customer_facts_customer_id ON public.customer_facts (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_facts_superseded_by ON public.customer_facts (superseded_by);
CREATE INDEX IF NOT EXISTS idx_daily_inventory_snapshots_departing_location_id ON public.daily_inventory_snapshots (departing_location_id);
CREATE INDEX IF NOT EXISTS idx_demand_forecast_v2_departing_location_id ON public.demand_forecast_v2 (departing_location_id);
CREATE INDEX IF NOT EXISTS idx_document_hashes_product_id ON public.document_hashes (product_id);
CREATE INDEX IF NOT EXISTS idx_during_trip_feedback_customer_id ON public.during_trip_feedback (customer_id);
CREATE INDEX IF NOT EXISTS idx_error_patterns_related_package_id ON public.error_patterns (related_package_id);
CREATE INDEX IF NOT EXISTS idx_external_bookings_parsed_package_id ON public.external_bookings (parsed_package_id);
CREATE INDEX IF NOT EXISTS idx_extractions_corrections_package_id ON public.extractions_corrections (package_id);
CREATE INDEX IF NOT EXISTS idx_group_rfqs_selected_proposal_id ON public.group_rfqs (selected_proposal_id);
CREATE INDEX IF NOT EXISTS idx_jarvis_tool_logs_pending_action_id ON public.jarvis_tool_logs (pending_action_id);
CREATE INDEX IF NOT EXISTS idx_jarvis_tool_logs_session_id ON public.jarvis_tool_logs (session_id);
CREATE INDEX IF NOT EXISTS idx_kakao_inbound_jarvis_session_id ON public.kakao_inbound (jarvis_session_id);
CREATE INDEX IF NOT EXISTS idx_keyword_performances_ad_account_id ON public.keyword_performances (ad_account_id);
CREATE INDEX IF NOT EXISTS idx_margin_settings_package_id ON public.margin_settings (package_id);
CREATE INDEX IF NOT EXISTS idx_mileage_history_booking_id ON public.mileage_history (booking_id);
CREATE INDEX IF NOT EXISTS idx_mileage_transactions_ref_transaction_id ON public.mileage_transactions (ref_transaction_id);
CREATE INDEX IF NOT EXISTS idx_mrt_package_hotel_intel_snapshot_id ON public.mrt_package_hotel_intel (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_normalization_rules_land_operator_id ON public.normalization_rules (land_operator_id);
CREATE INDEX IF NOT EXISTS idx_package_pricings_parsed_package_id ON public.package_pricings (parsed_package_id);
CREATE INDEX IF NOT EXISTS idx_page_engagement_detailed_customer_id ON public.page_engagement_detailed (customer_id);
CREATE INDEX IF NOT EXISTS idx_parsed_packages_raw_document_id ON public.parsed_packages (raw_document_id);
CREATE INDEX IF NOT EXISTS idx_partner_sales_package_pricing_id ON public.partner_sales (package_pricing_id);
CREATE INDEX IF NOT EXISTS idx_partner_sales_partner_id ON public.partner_sales (partner_id);
CREATE INDEX IF NOT EXISTS idx_payment_command_log_resolved_settlement_id ON public.payment_command_log (resolved_settlement_id);
CREATE INDEX IF NOT EXISTS idx_payment_command_log_resolved_inflow_tx_id ON public.payment_command_log (resolved_inflow_tx_id);
CREATE INDEX IF NOT EXISTS idx_payment_command_log_resolved_outflow_tx_id ON public.payment_command_log (resolved_outflow_tx_id);
CREATE INDEX IF NOT EXISTS idx_platform_learning_events_affiliate_id ON public.platform_learning_events (affiliate_id);
CREATE INDEX IF NOT EXISTS idx_post_trip_reviews_customer_id ON public.post_trip_reviews (customer_id);
CREATE INDEX IF NOT EXISTS idx_product_comparison_events_customer_id ON public.product_comparison_events (customer_id);
CREATE INDEX IF NOT EXISTS idx_product_comparison_events_product_a_id ON public.product_comparison_events (product_a_id);
CREATE INDEX IF NOT EXISTS idx_product_comparison_events_product_b_id ON public.product_comparison_events (product_b_id);
CREATE INDEX IF NOT EXISTS idx_product_comparison_events_product_c_id ON public.product_comparison_events (product_c_id);
CREATE INDEX IF NOT EXISTS idx_products_departing_location_id ON public.products (departing_location_id);
CREATE INDEX IF NOT EXISTS idx_products_land_operator_id ON public.products (land_operator_id);
CREATE INDEX IF NOT EXISTS idx_programmatic_seo_topics_topic_queue_id ON public.programmatic_seo_topics (topic_queue_id);
CREATE INDEX IF NOT EXISTS idx_promotions_campaign_id ON public.promotions (campaign_id);
CREATE INDEX IF NOT EXISTS idx_qa_negative_examples_source_critique_id ON public.qa_negative_examples (source_critique_id);
CREATE INDEX IF NOT EXISTS idx_qa_negative_examples_source_feedback_id ON public.qa_negative_examples (source_feedback_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_logs_clicked_package_id ON public.recommendation_logs (clicked_package_id);
CREATE INDEX IF NOT EXISTS idx_response_corrections_scope_affiliate_id ON public.response_corrections (scope_affiliate_id);
CREATE INDEX IF NOT EXISTS idx_rfq_proposals_bid_id ON public.rfq_proposals (bid_id);
CREATE INDEX IF NOT EXISTS idx_search_queries_conversion_package_id ON public.search_queries (conversion_package_id);
CREATE INDEX IF NOT EXISTS idx_search_queries_customer_id ON public.search_queries (customer_id);
CREATE INDEX IF NOT EXISTS idx_search_sessions_detailed_conversion_package_id ON public.search_sessions_detailed (conversion_package_id);
CREATE INDEX IF NOT EXISTS idx_surcharge_dates_parsed_package_id ON public.surcharge_dates (parsed_package_id);
CREATE INDEX IF NOT EXISTS idx_trend_keyword_archive_topic_queue_id ON public.trend_keyword_archive (topic_queue_id);
CREATE INDEX IF NOT EXISTS idx_unmatched_activities_resolved_attraction_id ON public.unmatched_activities (resolved_attraction_id);
CREATE INDEX IF NOT EXISTS idx_upload_review_queue_land_operator_id ON public.upload_review_queue (land_operator_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_land_agency_id ON public.vouchers (land_agency_id);
