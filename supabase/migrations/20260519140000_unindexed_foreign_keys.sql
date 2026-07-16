-- ============================================================================
-- Add indexes for unindexed foreign-key-like columns when they exist.
-- ============================================================================
-- This advisor-generated migration originally assumed every production legacy
-- table and column existed in a clean replay. Keep the optimization, but make it
-- compatible with empty local/staging databases and partially retired tables.

CREATE OR REPLACE FUNCTION public.create_index_if_column_exists(
  p_index_name text,
  p_table_name text,
  p_column_name text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(format('public.%I', p_table_name)) IS NULL THEN
    RAISE NOTICE 'Skipping index %, table %.% does not exist', p_index_name, 'public', p_table_name;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table_name
      AND column_name = p_column_name
  ) THEN
    RAISE NOTICE 'Skipping index %, column %.% does not exist', p_index_name, p_table_name, p_column_name;
    RETURN;
  END IF;

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)',
    p_index_name,
    p_table_name,
    p_column_name
  );
END;
$$;

SELECT public.create_index_if_column_exists(index_name, table_name, column_name)
FROM (
  VALUES
    ('idx_abandonment_tracking_customer_id', 'abandonment_tracking', 'customer_id'),
    ('idx_ad_conversion_logs_user_id', 'ad_conversion_logs', 'user_id'),
    ('idx_ad_engagement_logs_user_id', 'ad_engagement_logs', 'user_id'),
    ('idx_ai_training_logs_corrected_by', 'ai_training_logs', 'corrected_by'),
    ('idx_airline_exclusions_parsed_package_id', 'airline_exclusions', 'parsed_package_id'),
    ('idx_api_orders_tenant_id', 'api_orders', 'tenant_id'),
    ('idx_block_purchase_plans_supplier_id', 'block_purchase_plans', 'supplier_id'),
    ('idx_blog_topic_queue_content_creative_id', 'blog_topic_queue', 'content_creative_id'),
    ('idx_blog_topic_queue_product_id', 'blog_topic_queue', 'product_id'),
    ('idx_booking_passengers_customer_id', 'booking_passengers', 'customer_id'),
    ('idx_card_news_design_archetype_id', 'card_news', 'design_archetype_id'),
    ('idx_card_news_brand_kit_id', 'card_news', 'brand_kit_id'),
    ('idx_card_news_variants_variant_card_news_id', 'card_news_variants', 'variant_card_news_id'),
    ('idx_critique_results_affiliate_id', 'critique_results', 'affiliate_id'),
    ('idx_customer_facts_conversation_id', 'customer_facts', 'conversation_id'),
    ('idx_customer_facts_customer_id', 'customer_facts', 'customer_id'),
    ('idx_customer_facts_superseded_by', 'customer_facts', 'superseded_by'),
    ('idx_daily_inventory_snapshots_departing_location_id', 'daily_inventory_snapshots', 'departing_location_id'),
    ('idx_demand_forecast_v2_departing_location_id', 'demand_forecast_v2', 'departing_location_id'),
    ('idx_document_hashes_product_id', 'document_hashes', 'product_id'),
    ('idx_during_trip_feedback_customer_id', 'during_trip_feedback', 'customer_id'),
    ('idx_error_patterns_related_package_id', 'error_patterns', 'related_package_id'),
    ('idx_external_bookings_parsed_package_id', 'external_bookings', 'parsed_package_id'),
    ('idx_extractions_corrections_package_id', 'extractions_corrections', 'package_id'),
    ('idx_group_rfqs_selected_proposal_id', 'group_rfqs', 'selected_proposal_id'),
    ('idx_jarvis_tool_logs_pending_action_id', 'jarvis_tool_logs', 'pending_action_id'),
    ('idx_jarvis_tool_logs_session_id', 'jarvis_tool_logs', 'session_id'),
    ('idx_kakao_inbound_jarvis_session_id', 'kakao_inbound', 'jarvis_session_id'),
    ('idx_keyword_performances_ad_account_id', 'keyword_performances', 'ad_account_id'),
    ('idx_margin_settings_package_id', 'margin_settings', 'package_id'),
    ('idx_mileage_history_booking_id', 'mileage_history', 'booking_id'),
    ('idx_mileage_transactions_ref_transaction_id', 'mileage_transactions', 'ref_transaction_id'),
    ('idx_mrt_package_hotel_intel_snapshot_id', 'mrt_package_hotel_intel', 'snapshot_id'),
    ('idx_normalization_rules_land_operator_id', 'normalization_rules', 'land_operator_id'),
    ('idx_package_pricings_parsed_package_id', 'package_pricings', 'parsed_package_id'),
    ('idx_page_engagement_detailed_customer_id', 'page_engagement_detailed', 'customer_id'),
    ('idx_parsed_packages_raw_document_id', 'parsed_packages', 'raw_document_id'),
    ('idx_partner_sales_package_pricing_id', 'partner_sales', 'package_pricing_id'),
    ('idx_partner_sales_partner_id', 'partner_sales', 'partner_id'),
    ('idx_payment_command_log_resolved_settlement_id', 'payment_command_log', 'resolved_settlement_id'),
    ('idx_payment_command_log_resolved_inflow_tx_id', 'payment_command_log', 'resolved_inflow_tx_id'),
    ('idx_payment_command_log_resolved_outflow_tx_id', 'payment_command_log', 'resolved_outflow_tx_id'),
    ('idx_platform_learning_events_affiliate_id', 'platform_learning_events', 'affiliate_id'),
    ('idx_post_trip_reviews_customer_id', 'post_trip_reviews', 'customer_id'),
    ('idx_product_comparison_events_customer_id', 'product_comparison_events', 'customer_id'),
    ('idx_product_comparison_events_product_a_id', 'product_comparison_events', 'product_a_id'),
    ('idx_product_comparison_events_product_b_id', 'product_comparison_events', 'product_b_id'),
    ('idx_product_comparison_events_product_c_id', 'product_comparison_events', 'product_c_id'),
    ('idx_products_departing_location_id', 'products', 'departing_location_id'),
    ('idx_products_land_operator_id', 'products', 'land_operator_id'),
    ('idx_programmatic_seo_topics_topic_queue_id', 'programmatic_seo_topics', 'topic_queue_id'),
    ('idx_promotions_campaign_id', 'promotions', 'campaign_id'),
    ('idx_qa_negative_examples_source_critique_id', 'qa_negative_examples', 'source_critique_id'),
    ('idx_qa_negative_examples_source_feedback_id', 'qa_negative_examples', 'source_feedback_id'),
    ('idx_recommendation_logs_clicked_package_id', 'recommendation_logs', 'clicked_package_id'),
    ('idx_response_corrections_scope_affiliate_id', 'response_corrections', 'scope_affiliate_id'),
    ('idx_rfq_proposals_bid_id', 'rfq_proposals', 'bid_id'),
    ('idx_search_queries_conversion_package_id', 'search_queries', 'conversion_package_id'),
    ('idx_search_queries_customer_id', 'search_queries', 'customer_id'),
    ('idx_search_sessions_detailed_conversion_package_id', 'search_sessions_detailed', 'conversion_package_id'),
    ('idx_surcharge_dates_parsed_package_id', 'surcharge_dates', 'parsed_package_id'),
    ('idx_trend_keyword_archive_topic_queue_id', 'trend_keyword_archive', 'topic_queue_id'),
    ('idx_unmatched_activities_resolved_attraction_id', 'unmatched_activities', 'resolved_attraction_id'),
    ('idx_upload_review_queue_land_operator_id', 'upload_review_queue', 'land_operator_id'),
    ('idx_vouchers_land_agency_id', 'vouchers', 'land_agency_id')
) AS planned(index_name, table_name, column_name);

DROP FUNCTION public.create_index_if_column_exists(text, text, text);
