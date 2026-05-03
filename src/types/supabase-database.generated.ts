/* eslint-disable */
/** Supabase MCP generate_typescript_types — project ixaxnvbmhzjvupissmly. 갱신: MCP 또는 npx supabase gen types */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      abandonment_tracking: {
        Row: {
          abandonment_stage: string | null
          abandonment_type: string | null
          clicks_before_exit: number | null
          context: Json | null
          created_at: string | null
          customer_id: string | null
          form_completion_percent: number | null
          id: string
          package_id: string | null
          page_url: string
          scroll_depth_percent: number | null
          session_id: string | null
          time_on_page_seconds: number | null
        }
        Insert: {
          abandonment_stage?: string | null
          abandonment_type?: string | null
          clicks_before_exit?: number | null
          context?: Json | null
          created_at?: string | null
          customer_id?: string | null
          form_completion_percent?: number | null
          id?: string
          package_id?: string | null
          page_url: string
          scroll_depth_percent?: number | null
          session_id?: string | null
          time_on_page_seconds?: number | null
        }
        Update: {
          abandonment_stage?: string | null
          abandonment_type?: string | null
          clicks_before_exit?: number | null
          context?: Json | null
          created_at?: string | null
          customer_id?: string | null
          form_completion_percent?: number | null
          id?: string
          package_id?: string | null
          page_url?: string
          scroll_depth_percent?: number | null
          session_id?: string | null
          time_on_page_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "abandonment_tracking_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abandonment_tracking_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abandonment_tracking_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abandonment_tracking_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abandonment_tracking_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_accounts: {
        Row: {
          account_name: string
          created_at: string
          current_balance: number
          daily_budget: number
          id: string
          is_active: boolean
          last_synced_at: string | null
          low_balance_threshold: number
          platform: string
          updated_at: string
        }
        Insert: {
          account_name?: string
          created_at?: string
          current_balance?: number
          daily_budget?: number
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          low_balance_threshold?: number
          platform: string
          updated_at?: string
        }
        Update: {
          account_name?: string
          created_at?: string
          current_balance?: number
          daily_budget?: number
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          low_balance_threshold?: number
          platform?: string
          updated_at?: string
        }
        Relationships: []
      }
      ad_campaigns: {
        Row: {
          auto_pause_reason: string | null
          channel: string | null
          created_at: string | null
          created_by: string | null
          daily_budget_krw: number | null
          ended_at: string | null
          google_ad_id: string | null
          google_adgroup_id: string | null
          google_campaign_id: string | null
          id: string
          meta_ad_id: string | null
          meta_adset_id: string | null
          meta_campaign_id: string | null
          name: string
          naver_ad_id: string | null
          naver_adgroup_id: string | null
          naver_campaign_id: string | null
          objective: string | null
          package_id: string | null
          started_at: string | null
          status: string | null
          total_spend_krw: number | null
          updated_at: string | null
        }
        Insert: {
          auto_pause_reason?: string | null
          channel?: string | null
          created_at?: string | null
          created_by?: string | null
          daily_budget_krw?: number | null
          ended_at?: string | null
          google_ad_id?: string | null
          google_adgroup_id?: string | null
          google_campaign_id?: string | null
          id?: string
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          name: string
          naver_ad_id?: string | null
          naver_adgroup_id?: string | null
          naver_campaign_id?: string | null
          objective?: string | null
          package_id?: string | null
          started_at?: string | null
          status?: string | null
          total_spend_krw?: number | null
          updated_at?: string | null
        }
        Update: {
          auto_pause_reason?: string | null
          channel?: string | null
          created_at?: string | null
          created_by?: string | null
          daily_budget_krw?: number | null
          ended_at?: string | null
          google_ad_id?: string | null
          google_adgroup_id?: string | null
          google_campaign_id?: string | null
          id?: string
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          name?: string
          naver_ad_id?: string | null
          naver_adgroup_id?: string | null
          naver_campaign_id?: string | null
          objective?: string | null
          package_id?: string | null
          started_at?: string | null
          status?: string | null
          total_spend_krw?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaigns_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_conversion_logs: {
        Row: {
          allocated_ad_spend: number
          attributed_fbclid: string | null
          attributed_gclid: string | null
          attributed_source: string | null
          base_cost: number
          content_creative_id: string | null
          created_at: string
          final_booking_id: string | null
          final_sales_price: number
          first_touch_at: string | null
          first_touch_creative_id: string | null
          first_touch_keyword: string | null
          first_touch_landing_page: string | null
          first_touch_source: string | null
          id: string
          net_profit: number | null
          session_id: string
          user_id: string | null
        }
        Insert: {
          allocated_ad_spend?: number
          attributed_fbclid?: string | null
          attributed_gclid?: string | null
          attributed_source?: string | null
          base_cost?: number
          content_creative_id?: string | null
          created_at?: string
          final_booking_id?: string | null
          final_sales_price?: number
          first_touch_at?: string | null
          first_touch_creative_id?: string | null
          first_touch_keyword?: string | null
          first_touch_landing_page?: string | null
          first_touch_source?: string | null
          id?: string
          net_profit?: number | null
          session_id: string
          user_id?: string | null
        }
        Update: {
          allocated_ad_spend?: number
          attributed_fbclid?: string | null
          attributed_gclid?: string | null
          attributed_source?: string | null
          base_cost?: number
          content_creative_id?: string | null
          created_at?: string
          final_booking_id?: string | null
          final_sales_price?: number
          first_touch_at?: string | null
          first_touch_creative_id?: string | null
          first_touch_keyword?: string | null
          first_touch_landing_page?: string | null
          first_touch_source?: string | null
          id?: string
          net_profit?: number | null
          session_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_conversion_logs_final_booking_id_fkey"
            columns: ["final_booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_conversion_logs_final_booking_id_fkey"
            columns: ["final_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_conversion_logs_final_booking_id_fkey"
            columns: ["final_booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_conversion_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_conversion_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_conversion_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_creatives: {
        Row: {
          ad_copies: Json | null
          body: string | null
          campaign_id: string | null
          channel: string
          created_at: string | null
          creative_type: string
          description: string | null
          ended_at: string | null
          google_ad_id: string | null
          google_adgroup_id: string | null
          google_campaign_id: string | null
          headline: string | null
          hook_type: string | null
          id: string
          image_url: string | null
          key_selling_point: string | null
          keywords: string[] | null
          landing_content_creative_id: string | null
          launched_at: string | null
          meta_ad_id: string | null
          meta_adset_id: string | null
          meta_campaign_id: string | null
          meta_creative_id: string | null
          naver_ad_id: string | null
          naver_adgroup_id: string | null
          naver_campaign_id: string | null
          primary_text: string | null
          product_id: string | null
          slides: Json | null
          status: string | null
          target_segment: string | null
          tone: string | null
          utm_params: Json | null
          variant_index: number | null
        }
        Insert: {
          ad_copies?: Json | null
          body?: string | null
          campaign_id?: string | null
          channel: string
          created_at?: string | null
          creative_type: string
          description?: string | null
          ended_at?: string | null
          google_ad_id?: string | null
          google_adgroup_id?: string | null
          google_campaign_id?: string | null
          headline?: string | null
          hook_type?: string | null
          id?: string
          image_url?: string | null
          key_selling_point?: string | null
          keywords?: string[] | null
          landing_content_creative_id?: string | null
          launched_at?: string | null
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          meta_creative_id?: string | null
          naver_ad_id?: string | null
          naver_adgroup_id?: string | null
          naver_campaign_id?: string | null
          primary_text?: string | null
          product_id?: string | null
          slides?: Json | null
          status?: string | null
          target_segment?: string | null
          tone?: string | null
          utm_params?: Json | null
          variant_index?: number | null
        }
        Update: {
          ad_copies?: Json | null
          body?: string | null
          campaign_id?: string | null
          channel?: string
          created_at?: string | null
          creative_type?: string
          description?: string | null
          ended_at?: string | null
          google_ad_id?: string | null
          google_adgroup_id?: string | null
          google_campaign_id?: string | null
          headline?: string | null
          hook_type?: string | null
          id?: string
          image_url?: string | null
          key_selling_point?: string | null
          keywords?: string[] | null
          landing_content_creative_id?: string | null
          launched_at?: string | null
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          meta_creative_id?: string | null
          naver_ad_id?: string | null
          naver_adgroup_id?: string | null
          naver_campaign_id?: string | null
          primary_text?: string | null
          product_id?: string | null
          slides?: Json | null
          status?: string | null
          target_segment?: string | null
          tone?: string | null
          utm_params?: Json | null
          variant_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_creatives_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_creatives_landing_content_creative_id_fkey"
            columns: ["landing_content_creative_id"]
            isOneToOne: false
            referencedRelation: "blog_performance_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_creatives_landing_content_creative_id_fkey"
            columns: ["landing_content_creative_id"]
            isOneToOne: false
            referencedRelation: "content_creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_creatives_landing_content_creative_id_fkey"
            columns: ["landing_content_creative_id"]
            isOneToOne: false
            referencedRelation: "content_roas_summary"
            referencedColumns: ["creative_id"]
          },
          {
            foreignKeyName: "ad_creatives_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_creatives_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_engagement_logs: {
        Row: {
          cart_added: boolean
          created_at: string
          event_type: string
          id: string
          lead_time_days: number | null
          page_url: string | null
          product_id: string | null
          product_name: string | null
          session_id: string
          user_id: string | null
        }
        Insert: {
          cart_added?: boolean
          created_at?: string
          event_type: string
          id?: string
          lead_time_days?: number | null
          page_url?: string | null
          product_id?: string | null
          product_name?: string | null
          session_id: string
          user_id?: string | null
        }
        Update: {
          cart_added?: boolean
          created_at?: string
          event_type?: string
          id?: string
          lead_time_days?: number | null
          page_url?: string | null
          product_id?: string | null
          product_name?: string | null
          session_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_engagement_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_engagement_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_engagement_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_landing_mappings: {
        Row: {
          active: boolean
          campaign_id: string | null
          clicks: number
          content_creative_id: string
          conversions: number
          created_at: string
          dki_headline: string | null
          dki_subtitle: string | null
          id: string
          keyword: string
          landing_url: string
          match_type: string | null
          platform: string
          updated_at: string
          utm_campaign: string
          utm_content: string | null
          utm_medium: string
          utm_source: string
          utm_term: string | null
        }
        Insert: {
          active?: boolean
          campaign_id?: string | null
          clicks?: number
          content_creative_id: string
          conversions?: number
          created_at?: string
          dki_headline?: string | null
          dki_subtitle?: string | null
          id?: string
          keyword: string
          landing_url: string
          match_type?: string | null
          platform: string
          updated_at?: string
          utm_campaign: string
          utm_content?: string | null
          utm_medium?: string
          utm_source: string
          utm_term?: string | null
        }
        Update: {
          active?: boolean
          campaign_id?: string | null
          clicks?: number
          content_creative_id?: string
          conversions?: number
          created_at?: string
          dki_headline?: string | null
          dki_subtitle?: string | null
          id?: string
          keyword?: string
          landing_url?: string
          match_type?: string | null
          platform?: string
          updated_at?: string
          utm_campaign?: string
          utm_content?: string | null
          utm_medium?: string
          utm_source?: string
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_landing_mappings_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_landing_mappings_content_creative_id_fkey"
            columns: ["content_creative_id"]
            isOneToOne: false
            referencedRelation: "blog_performance_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_landing_mappings_content_creative_id_fkey"
            columns: ["content_creative_id"]
            isOneToOne: false
            referencedRelation: "content_creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_landing_mappings_content_creative_id_fkey"
            columns: ["content_creative_id"]
            isOneToOne: false
            referencedRelation: "content_roas_summary"
            referencedColumns: ["creative_id"]
          },
        ]
      }
      ad_performance_snapshots: {
        Row: {
          attributed_bookings: number | null
          attributed_margin: number | null
          campaign_id: string
          clicks: number | null
          cpc_krw: number | null
          created_at: string | null
          id: string
          impressions: number | null
          net_roas_pct: number | null
          raw_meta_json: Json | null
          snapshot_date: string
          spend_krw: number | null
        }
        Insert: {
          attributed_bookings?: number | null
          attributed_margin?: number | null
          campaign_id: string
          clicks?: number | null
          cpc_krw?: number | null
          created_at?: string | null
          id?: string
          impressions?: number | null
          net_roas_pct?: number | null
          raw_meta_json?: Json | null
          snapshot_date: string
          spend_krw?: number | null
        }
        Update: {
          attributed_bookings?: number | null
          attributed_margin?: number | null
          campaign_id?: string
          clicks?: number | null
          cpc_krw?: number | null
          created_at?: string | null
          id?: string
          impressions?: number | null
          net_roas_pct?: number | null
          raw_meta_json?: Json | null
          snapshot_date?: string
          spend_krw?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_performance_snapshots_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_search_logs: {
        Row: {
          created_at: string
          id: string
          lead_time_days: number | null
          result_count: number | null
          search_category: string | null
          search_query: string | null
          session_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lead_time_days?: number | null
          result_count?: number | null
          search_category?: string | null
          search_query?: string | null
          session_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lead_time_days?: number | null
          result_count?: number | null
          search_category?: string | null
          search_query?: string | null
          session_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_search_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_search_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_search_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_traffic_logs: {
        Row: {
          ad_landing_mapping_id: string | null
          campaign_name: string | null
          consent_agreed: boolean
          content_creative_id: string | null
          created_at: string
          current_cpc: number | null
          fbclid: string | null
          gclid: string | null
          id: string
          keyword: string | null
          landing_page: string | null
          medium: string | null
          n_keyword: string | null
          session_id: string
          source: string | null
          user_id: string | null
        }
        Insert: {
          ad_landing_mapping_id?: string | null
          campaign_name?: string | null
          consent_agreed?: boolean
          content_creative_id?: string | null
          created_at?: string
          current_cpc?: number | null
          fbclid?: string | null
          gclid?: string | null
          id?: string
          keyword?: string | null
          landing_page?: string | null
          medium?: string | null
          n_keyword?: string | null
          session_id: string
          source?: string | null
          user_id?: string | null
        }
        Update: {
          ad_landing_mapping_id?: string | null
          campaign_name?: string | null
          consent_agreed?: boolean
          content_creative_id?: string | null
          created_at?: string
          current_cpc?: number | null
          fbclid?: string | null
          gclid?: string | null
          id?: string
          keyword?: string | null
          landing_page?: string | null
          medium?: string | null
          n_keyword?: string | null
          session_id?: string
          source?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_traffic_logs_ad_landing_mapping_id_fkey"
            columns: ["ad_landing_mapping_id"]
            isOneToOne: false
            referencedRelation: "ad_landing_mappings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_traffic_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_traffic_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_traffic_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_alerts: {
        Row: {
          acknowledged_at: string | null
          category: string
          created_at: string
          id: number
          message: string | null
          meta: Json | null
          ref_id: string | null
          ref_type: string | null
          resolved_at: string | null
          severity: string
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          category: string
          created_at?: string
          id?: number
          message?: string | null
          meta?: Json | null
          ref_id?: string | null
          ref_type?: string | null
          resolved_at?: string | null
          severity?: string
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          category?: string
          created_at?: string
          id?: number
          message?: string | null
          meta?: Json | null
          ref_id?: string | null
          ref_type?: string | null
          resolved_at?: string | null
          severity?: string
          title?: string
        }
        Relationships: []
      }
      affiliate_applications: {
        Row: {
          applied_at: string
          business_number: string | null
          business_type: string
          channel_type: string
          channel_url: string
          follower_count: number | null
          id: string
          intro: string | null
          name: string
          phone: string
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          applied_at?: string
          business_number?: string | null
          business_type?: string
          channel_type: string
          channel_url: string
          follower_count?: number | null
          id?: string
          intro?: string | null
          name: string
          phone: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          applied_at?: string
          business_number?: string | null
          business_type?: string
          channel_type?: string
          channel_url?: string
          follower_count?: number | null
          id?: string
          intro?: string | null
          name?: string
          phone?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: []
      }
      affiliates: {
        Row: {
          bonus_rate: number | null
          booking_count: number | null
          business_number: string | null
          commission_rate: number
          created_at: string | null
          email: string | null
          encrypted_bank_info: string | null
          grade: number | null
          id: string
          is_active: boolean
          landing_intro: string | null
          landing_pick_package_ids: string[]
          landing_video_url: string | null
          last_conversion_at: string | null
          memo: string | null
          name: string
          payout_type: string | null
          phone: string | null
          referral_code: string
          total_commission: number | null
          updated_at: string | null
        }
        Insert: {
          bonus_rate?: number | null
          booking_count?: number | null
          business_number?: string | null
          commission_rate?: number
          created_at?: string | null
          email?: string | null
          encrypted_bank_info?: string | null
          grade?: number | null
          id?: string
          is_active?: boolean
          landing_intro?: string | null
          landing_pick_package_ids?: string[]
          landing_video_url?: string | null
          last_conversion_at?: string | null
          memo?: string | null
          name: string
          payout_type?: string | null
          phone?: string | null
          referral_code: string
          total_commission?: number | null
          updated_at?: string | null
        }
        Update: {
          bonus_rate?: number | null
          booking_count?: number | null
          business_number?: string | null
          commission_rate?: number
          created_at?: string | null
          email?: string | null
          encrypted_bank_info?: string | null
          grade?: number | null
          id?: string
          is_active?: boolean
          landing_intro?: string | null
          landing_pick_package_ids?: string[]
          landing_video_url?: string | null
          last_conversion_at?: string | null
          memo?: string | null
          name?: string
          payout_type?: string | null
          phone?: string | null
          referral_code?: string
          total_commission?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      agent_actions: {
        Row: {
          action_type: string
          agent_type: string
          created_at: string
          expires_at: string | null
          id: string
          payload: Json
          priority: string
          reject_reason: string | null
          requested_by: string
          resolved_at: string | null
          result_log: string | null
          reviewed_by: string | null
          status: string
          summary: string
          tenant_id: string | null
        }
        Insert: {
          action_type: string
          agent_type: string
          created_at?: string
          expires_at?: string | null
          id?: string
          payload?: Json
          priority?: string
          reject_reason?: string | null
          requested_by?: string
          resolved_at?: string | null
          result_log?: string | null
          reviewed_by?: string | null
          status?: string
          summary: string
          tenant_id?: string | null
        }
        Update: {
          action_type?: string
          agent_type?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          payload?: Json
          priority?: string
          reject_reason?: string | null
          requested_by?: string
          resolved_at?: string | null
          result_log?: string | null
          reviewed_by?: string | null
          status?: string
          summary?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_responses: {
        Row: {
          admin_feedback: string | null
          ai_model: string | null
          approved: boolean | null
          confidence: number | null
          created_at: string | null
          id: string
          inquiry_id: string | null
          response_text: string
          used_packages: string[] | null
        }
        Insert: {
          admin_feedback?: string | null
          ai_model?: string | null
          approved?: boolean | null
          confidence?: number | null
          created_at?: string | null
          id?: string
          inquiry_id?: string | null
          response_text: string
          used_packages?: string[] | null
        }
        Update: {
          admin_feedback?: string | null
          ai_model?: string | null
          approved?: boolean | null
          confidence?: number | null
          created_at?: string | null
          id?: string
          inquiry_id?: string | null
          response_text?: string
          used_packages?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_responses_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "qa_inquiries"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_training_logs: {
        Row: {
          ai_model_used: string | null
          ai_parsed_json: Json | null
          confidence_after: number | null
          confidence_before: number | null
          corrected_by: string | null
          correction_diff: Json | null
          created_at: string | null
          human_corrected_json: Json | null
          id: string
          original_raw_text: string | null
          product_id: string | null
        }
        Insert: {
          ai_model_used?: string | null
          ai_parsed_json?: Json | null
          confidence_after?: number | null
          confidence_before?: number | null
          corrected_by?: string | null
          correction_diff?: Json | null
          created_at?: string | null
          human_corrected_json?: Json | null
          id?: string
          original_raw_text?: string | null
          product_id?: string | null
        }
        Update: {
          ai_model_used?: string | null
          ai_parsed_json?: Json | null
          confidence_after?: number | null
          confidence_before?: number | null
          corrected_by?: string | null
          correction_diff?: Json | null
          created_at?: string | null
          human_corrected_json?: Json | null
          id?: string
          original_raw_text?: string | null
          product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_training_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["internal_code"]
          },
        ]
      }
      airline_exclusions: {
        Row: {
          exclusion_date: string
          id: string
          note: string | null
          parsed_package_id: string | null
        }
        Insert: {
          exclusion_date: string
          id?: string
          note?: string | null
          parsed_package_id?: string | null
        }
        Update: {
          exclusion_date?: string
          id?: string
          note?: string | null
          parsed_package_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "airline_exclusions_parsed_package_id_fkey"
            columns: ["parsed_package_id"]
            isOneToOne: false
            referencedRelation: "parsed_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      api_orders: {
        Row: {
          api_name: string
          attrs: Json | null
          cost: number
          created_at: string | null
          external_ref: string | null
          id: string
          price: number
          product_category: string
          product_id: string
          product_name: string
          product_type: string
          quantity: number
          status: string
          tenant_id: string | null
          transaction_id: string
        }
        Insert: {
          api_name: string
          attrs?: Json | null
          cost: number
          created_at?: string | null
          external_ref?: string | null
          id?: string
          price: number
          product_category?: string
          product_id: string
          product_name: string
          product_type: string
          quantity?: number
          status?: string
          tenant_id?: string | null
          transaction_id: string
        }
        Update: {
          api_name?: string
          attrs?: Json | null
          cost?: number
          created_at?: string | null
          external_ref?: string | null
          id?: string
          price?: number
          product_category?: string
          product_id?: string
          product_name?: string
          product_type?: string
          quantity?: number
          status?: string
          tenant_id?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_orders_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      archive_docs: {
        Row: {
          created_at: string | null
          file_hash: string
          id: string
          metadata: Json | null
          original_file_name: string
          original_file_path: string
          parsed_chunks: Json | null
          parser_version: string | null
          raw_content: string | null
          sku_code: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          file_hash: string
          id?: string
          metadata?: Json | null
          original_file_name: string
          original_file_path: string
          parsed_chunks?: Json | null
          parser_version?: string | null
          raw_content?: string | null
          sku_code?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          file_hash?: string
          id?: string
          metadata?: Json | null
          original_file_name?: string
          original_file_path?: string
          parsed_chunks?: Json | null
          parser_version?: string | null
          raw_content?: string | null
          sku_code?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      attractions: {
        Row: {
          ai_processed_at: string | null
          aliases: string[] | null
          badge_type: string | null
          category: string | null
          coordinates: Json | null
          country: string | null
          created_at: string | null
          emoji: string | null
          id: string
          is_active: boolean
          is_special: boolean | null
          long_desc: string | null
          mention_count: number | null
          mrt_category: string | null
          mrt_gid: string | null
          mrt_image_url: string | null
          mrt_min_price: number | null
          mrt_rating: number | null
          mrt_raw_desc: string | null
          mrt_review_count: number | null
          mrt_synced_at: string | null
          name: string
          photos: Json | null
          price_info: Json | null
          region: string | null
          short_desc: string | null
          source_packages: Json | null
          typical_duration_hours: number | null
          updated_at: string | null
          wikidata_qid: string | null
          wikidata_synced_at: string | null
        }
        Insert: {
          ai_processed_at?: string | null
          aliases?: string[] | null
          badge_type?: string | null
          category?: string | null
          coordinates?: Json | null
          country?: string | null
          created_at?: string | null
          emoji?: string | null
          id?: string
          is_active?: boolean
          is_special?: boolean | null
          long_desc?: string | null
          mention_count?: number | null
          mrt_category?: string | null
          mrt_gid?: string | null
          mrt_image_url?: string | null
          mrt_min_price?: number | null
          mrt_rating?: number | null
          mrt_raw_desc?: string | null
          mrt_review_count?: number | null
          mrt_synced_at?: string | null
          name: string
          photos?: Json | null
          price_info?: Json | null
          region?: string | null
          short_desc?: string | null
          source_packages?: Json | null
          typical_duration_hours?: number | null
          updated_at?: string | null
          wikidata_qid?: string | null
          wikidata_synced_at?: string | null
        }
        Update: {
          ai_processed_at?: string | null
          aliases?: string[] | null
          badge_type?: string | null
          category?: string | null
          coordinates?: Json | null
          country?: string | null
          created_at?: string | null
          emoji?: string | null
          id?: string
          is_active?: boolean
          is_special?: boolean | null
          long_desc?: string | null
          mention_count?: number | null
          mrt_category?: string | null
          mrt_gid?: string | null
          mrt_image_url?: string | null
          mrt_min_price?: number | null
          mrt_rating?: number | null
          mrt_raw_desc?: string | null
          mrt_review_count?: number | null
          mrt_synced_at?: string | null
          name?: string
          photos?: Json | null
          price_info?: Json | null
          region?: string | null
          short_desc?: string | null
          source_packages?: Json | null
          typical_duration_hours?: number | null
          updated_at?: string | null
          wikidata_qid?: string | null
          wikidata_synced_at?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          after_value: Json | null
          before_value: Json | null
          created_at: string | null
          description: string | null
          id: string
          target_id: string | null
          target_type: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      automated_settlements: {
        Row: {
          adjustment_amount: number | null
          approved_at: string | null
          approved_by: string | null
          bank_account: string | null
          commission_amount: number | null
          commission_rate: number | null
          generated_at: string | null
          generated_by: string | null
          gross_amount: number | null
          id: string
          invoice_url: string | null
          net_amount: number | null
          paid_at: string | null
          partner_id: string | null
          partner_name: string | null
          partner_type: string
          payment_method: string | null
          payment_reference: string | null
          receipt_url: string | null
          settlement_period_end: string
          settlement_period_start: string
          status: string | null
          tax_amount: number | null
          tax_rate: number | null
          total_transactions: number | null
        }
        Insert: {
          adjustment_amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          bank_account?: string | null
          commission_amount?: number | null
          commission_rate?: number | null
          generated_at?: string | null
          generated_by?: string | null
          gross_amount?: number | null
          id?: string
          invoice_url?: string | null
          net_amount?: number | null
          paid_at?: string | null
          partner_id?: string | null
          partner_name?: string | null
          partner_type: string
          payment_method?: string | null
          payment_reference?: string | null
          receipt_url?: string | null
          settlement_period_end: string
          settlement_period_start: string
          status?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
          total_transactions?: number | null
        }
        Update: {
          adjustment_amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          bank_account?: string | null
          commission_amount?: number | null
          commission_rate?: number | null
          generated_at?: string | null
          generated_by?: string | null
          gross_amount?: number | null
          id?: string
          invoice_url?: string | null
          net_amount?: number | null
          paid_at?: string | null
          partner_id?: string | null
          partner_name?: string | null
          partner_type?: string
          payment_method?: string | null
          payment_reference?: string | null
          receipt_url?: string | null
          settlement_period_end?: string
          settlement_period_start?: string
          status?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
          total_transactions?: number | null
        }
        Relationships: []
      }
      bank_transactions: {
        Row: {
          amount: number
          booking_id: string | null
          counterparty_name: string | null
          created_at: string | null
          deleted_at: string | null
          fee_amount: number | null
          id: string
          is_fee: boolean | null
          is_refund: boolean | null
          match_confidence: number | null
          match_status: string | null
          matched_at: string | null
          matched_by: string | null
          memo: string | null
          raw_event_id: string | null
          raw_message: string
          received_at: string
          slack_event_id: string
          source: string
          status: string
          tenant_id: string | null
          transaction_type: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          booking_id?: string | null
          counterparty_name?: string | null
          created_at?: string | null
          deleted_at?: string | null
          fee_amount?: number | null
          id?: string
          is_fee?: boolean | null
          is_refund?: boolean | null
          match_confidence?: number | null
          match_status?: string | null
          matched_at?: string | null
          matched_by?: string | null
          memo?: string | null
          raw_event_id?: string | null
          raw_message: string
          received_at: string
          slack_event_id: string
          source?: string
          status?: string
          tenant_id?: string | null
          transaction_type: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          booking_id?: string | null
          counterparty_name?: string | null
          created_at?: string | null
          deleted_at?: string | null
          fee_amount?: number | null
          id?: string
          is_fee?: boolean | null
          is_refund?: boolean | null
          match_confidence?: number | null
          match_status?: string | null
          matched_at?: string | null
          matched_by?: string | null
          memo?: string | null
          raw_event_id?: string | null
          raw_message?: string
          received_at?: string
          slack_event_id?: string
          source?: string
          status?: string
          tenant_id?: string | null
          transaction_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_raw_event_id_fkey"
            columns: ["raw_event_id"]
            isOneToOne: false
            referencedRelation: "slack_raw_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      block_purchase_plans: {
        Row: {
          actual_demand: number | null
          actual_margin_percent: number | null
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          breakeven_sales_quantity: number | null
          confidence_level: number | null
          created_at: string | null
          created_by: string | null
          departure_date_range: unknown
          destination: string
          duration_nights: number | null
          expected_roi: number | null
          forecast_accuracy: number | null
          hedge_strategy: string | null
          id: string
          package_type: string | null
          planned_quantity: number | null
          predicted_demand: number | null
          prediction_model: string | null
          purchase_cost_per_unit: number | null
          purchase_date: string | null
          purchase_deadline: string | null
          purchased_at: string | null
          purchased_quantity: number | null
          remaining_quantity: number | null
          risk_factors: string[] | null
          risk_level: string | null
          roi: number | null
          sale_end_date: string | null
          sale_start_date: string | null
          season: string | null
          service_end_date: string | null
          service_start_date: string | null
          sold_quantity: number | null
          status: string | null
          supplier_id: string | null
          target_margin_percent: number | null
          target_sell_price: number | null
        }
        Insert: {
          actual_demand?: number | null
          actual_margin_percent?: number | null
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          breakeven_sales_quantity?: number | null
          confidence_level?: number | null
          created_at?: string | null
          created_by?: string | null
          departure_date_range?: unknown
          destination: string
          duration_nights?: number | null
          expected_roi?: number | null
          forecast_accuracy?: number | null
          hedge_strategy?: string | null
          id?: string
          package_type?: string | null
          planned_quantity?: number | null
          predicted_demand?: number | null
          prediction_model?: string | null
          purchase_cost_per_unit?: number | null
          purchase_date?: string | null
          purchase_deadline?: string | null
          purchased_at?: string | null
          purchased_quantity?: number | null
          remaining_quantity?: number | null
          risk_factors?: string[] | null
          risk_level?: string | null
          roi?: number | null
          sale_end_date?: string | null
          sale_start_date?: string | null
          season?: string | null
          service_end_date?: string | null
          service_start_date?: string | null
          sold_quantity?: number | null
          status?: string | null
          supplier_id?: string | null
          target_margin_percent?: number | null
          target_sell_price?: number | null
        }
        Update: {
          actual_demand?: number | null
          actual_margin_percent?: number | null
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          breakeven_sales_quantity?: number | null
          confidence_level?: number | null
          created_at?: string | null
          created_by?: string | null
          departure_date_range?: unknown
          destination?: string
          duration_nights?: number | null
          expected_roi?: number | null
          forecast_accuracy?: number | null
          hedge_strategy?: string | null
          id?: string
          package_type?: string | null
          planned_quantity?: number | null
          predicted_demand?: number | null
          prediction_model?: string | null
          purchase_cost_per_unit?: number | null
          purchase_date?: string | null
          purchase_deadline?: string | null
          purchased_at?: string | null
          purchased_quantity?: number | null
          remaining_quantity?: number | null
          risk_factors?: string[] | null
          risk_level?: string | null
          roi?: number | null
          sale_end_date?: string | null
          sale_start_date?: string | null
          season?: string | null
          service_end_date?: string | null
          service_start_date?: string | null
          sold_quantity?: number | null
          status?: string | null
          supplier_id?: string | null
          target_margin_percent?: number | null
          target_sell_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "block_purchase_plans_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier_rankings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "block_purchase_plans_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_categories: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          key: string
          label: string
          scope: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          key: string
          label: string
          scope?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          key?: string
          label?: string
          scope?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      blog_engagement_logs: {
        Row: {
          content_creative_id: string | null
          created_at: string | null
          cta_clicked: boolean | null
          id: string
          max_scroll_depth_pct: number | null
          session_id: string | null
          time_on_page_seconds: number | null
          user_id: string | null
        }
        Insert: {
          content_creative_id?: string | null
          created_at?: string | null
          cta_clicked?: boolean | null
          id?: string
          max_scroll_depth_pct?: number | null
          session_id?: string | null
          time_on_page_seconds?: number | null
          user_id?: string | null
        }
        Update: {
          content_creative_id?: string | null
          created_at?: string | null
          cta_clicked?: boolean | null
          id?: string
          max_scroll_depth_pct?: number | null
          session_id?: string | null
          time_on_page_seconds?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blog_engagement_logs_content_creative_id_fkey"
            columns: ["content_creative_id"]
            isOneToOne: false
            referencedRelation: "blog_performance_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_engagement_logs_content_creative_id_fkey"
            columns: ["content_creative_id"]
            isOneToOne: false
            referencedRelation: "content_creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_engagement_logs_content_creative_id_fkey"
            columns: ["content_creative_id"]
            isOneToOne: false
            referencedRelation: "content_roas_summary"
            referencedColumns: ["creative_id"]
          },
        ]
      }
      blog_search_metrics: {
        Row: {
          avg_position: number | null
          clicks: number | null
          content_creative_id: string | null
          created_at: string | null
          ctr: number | null
          date: string
          id: string
          impressions: number | null
          top_query: string | null
        }
        Insert: {
          avg_position?: number | null
          clicks?: number | null
          content_creative_id?: string | null
          created_at?: string | null
          ctr?: number | null
          date: string
          id?: string
          impressions?: number | null
          top_query?: string | null
        }
        Update: {
          avg_position?: number | null
          clicks?: number | null
          content_creative_id?: string | null
          created_at?: string | null
          ctr?: number | null
          date?: string
          id?: string
          impressions?: number | null
          top_query?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blog_search_metrics_content_creative_id_fkey"
            columns: ["content_creative_id"]
            isOneToOne: false
            referencedRelation: "blog_performance_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_search_metrics_content_creative_id_fkey"
            columns: ["content_creative_id"]
            isOneToOne: false
            referencedRelation: "content_creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_search_metrics_content_creative_id_fkey"
            columns: ["content_creative_id"]
            isOneToOne: false
            referencedRelation: "content_roas_summary"
            referencedColumns: ["creative_id"]
          },
        ]
      }
      blog_seasonal_calendar: {
        Row: {
          destination: string | null
          generated_at: string
          id: string
          keywords: string[] | null
          season_tag: string | null
          topic: string
          used: boolean
          used_at: string | null
          year_month: string
        }
        Insert: {
          destination?: string | null
          generated_at?: string
          id?: string
          keywords?: string[] | null
          season_tag?: string | null
          topic: string
          used?: boolean
          used_at?: string | null
          year_month: string
        }
        Update: {
          destination?: string | null
          generated_at?: string
          id?: string
          keywords?: string[] | null
          season_tag?: string | null
          topic?: string
          used?: boolean
          used_at?: string | null
          year_month?: string
        }
        Relationships: []
      }
      blog_topic_queue: {
        Row: {
          angle_type: string | null
          attempts: number
          card_news_id: string | null
          category: string | null
          competition_level: string | null
          content_creative_id: string | null
          created_at: string
          destination: string | null
          id: string
          keyword_tier: string | null
          last_error: string | null
          meta: Json | null
          monthly_search_volume: number | null
          primary_keyword: string | null
          priority: number
          product_id: string | null
          source: string
          status: string
          target_publish_at: string | null
          tenant_id: string | null
          topic: string
          trend_score: number | null
          updated_at: string
        }
        Insert: {
          angle_type?: string | null
          attempts?: number
          card_news_id?: string | null
          category?: string | null
          competition_level?: string | null
          content_creative_id?: string | null
          created_at?: string
          destination?: string | null
          id?: string
          keyword_tier?: string | null
          last_error?: string | null
          meta?: Json | null
          monthly_search_volume?: number | null
          primary_keyword?: string | null
          priority?: number
          product_id?: string | null
          source: string
          status?: string
          target_publish_at?: string | null
          tenant_id?: string | null
          topic: string
          trend_score?: number | null
          updated_at?: string
        }
        Update: {
          angle_type?: string | null
          attempts?: number
          card_news_id?: string | null
          category?: string | null
          competition_level?: string | null
          content_creative_id?: string | null
          created_at?: string
          destination?: string | null
          id?: string
          keyword_tier?: string | null
          last_error?: string | null
          meta?: Json | null
          monthly_search_volume?: number | null
          primary_keyword?: string | null
          priority?: number
          product_id?: string | null
          source?: string
          status?: string
          target_publish_at?: string | null
          tenant_id?: string | null
          topic?: string
          trend_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_topic_queue_card_news_id_fkey"
            columns: ["card_news_id"]
            isOneToOne: false
            referencedRelation: "card_news"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_topic_queue_content_creative_id_fkey"
            columns: ["content_creative_id"]
            isOneToOne: false
            referencedRelation: "blog_performance_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_topic_queue_content_creative_id_fkey"
            columns: ["content_creative_id"]
            isOneToOne: false
            referencedRelation: "content_creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_topic_queue_content_creative_id_fkey"
            columns: ["content_creative_id"]
            isOneToOne: false
            referencedRelation: "content_roas_summary"
            referencedColumns: ["creative_id"]
          },
          {
            foreignKeyName: "blog_topic_queue_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_topic_queue_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_topic_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_guest_tokens: {
        Row: {
          booking_id: string
          created_at: string
          expires_at: string
          id: string
          last_used_at: string | null
          purpose: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          expires_at: string
          id?: string
          last_used_at?: string | null
          purpose?: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_used_at?: string | null
          purpose?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_guest_tokens_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_guest_tokens_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_guest_tokens_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_passengers: {
        Row: {
          booking_id: string
          customer_id: string
          passenger_type: string | null
          seat_number: string | null
          ticket_number: string | null
        }
        Insert: {
          booking_id: string
          customer_id: string
          passenger_type?: string | null
          seat_number?: string | null
          ticket_number?: string | null
        }
        Update: {
          booking_id?: string
          customer_id?: string
          passenger_type?: string | null
          seat_number?: string | null
          ticket_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_passengers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_passengers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_passengers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_passengers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_passengers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_passengers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_segments: {
        Row: {
          booking_id: string
          confirmation_code: string | null
          cost_price: number | null
          created_at: string | null
          description: string | null
          details: Json | null
          duration_minutes: number | null
          id: string
          margin: number | null
          margin_percent: number | null
          pax_count: number | null
          segment_type: string
          sell_price: number | null
          sequence_no: number
          service_date: string | null
          service_time: string | null
          status: string | null
          supplier: string | null
          supplier_reference: string | null
          updated_at: string | null
        }
        Insert: {
          booking_id: string
          confirmation_code?: string | null
          cost_price?: number | null
          created_at?: string | null
          description?: string | null
          details?: Json | null
          duration_minutes?: number | null
          id?: string
          margin?: number | null
          margin_percent?: number | null
          pax_count?: number | null
          segment_type: string
          sell_price?: number | null
          sequence_no?: number
          service_date?: string | null
          service_time?: string | null
          status?: string | null
          supplier?: string | null
          supplier_reference?: string | null
          updated_at?: string | null
        }
        Update: {
          booking_id?: string
          confirmation_code?: string | null
          cost_price?: number | null
          created_at?: string | null
          description?: string | null
          details?: Json | null
          duration_minutes?: number | null
          id?: string
          margin?: number | null
          margin_percent?: number | null
          pax_count?: number | null
          segment_type?: string
          sell_price?: number | null
          sequence_no?: number
          service_date?: string | null
          service_time?: string | null
          status?: string | null
          supplier?: string | null
          supplier_reference?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_segments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_segments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_segments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_tasks: {
        Row: {
          assigned_to: string | null
          auto_resolve_reason: string | null
          booking_id: string
          context: Json
          created_at: string
          created_by: string
          fingerprint: string
          id: string
          priority: number
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          snoozed_until: string | null
          status: string
          task_type: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          auto_resolve_reason?: string | null
          booking_id: string
          context?: Json
          created_at?: string
          created_by: string
          fingerprint: string
          id?: string
          priority?: number
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          snoozed_until?: string | null
          status?: string
          task_type: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          auto_resolve_reason?: string | null
          booking_id?: string
          context?: Json
          created_at?: string
          created_by?: string
          fingerprint?: string
          id?: string
          priority?: number
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          snoozed_until?: string | null
          status?: string
          task_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_tasks_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_tasks_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_tasks_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          actual_payer_name: string | null
          adult_cost: number | null
          adult_count: number | null
          adult_price: number | null
          affiliate_id: string | null
          ancillary_spend: number | null
          applied_total_commission_rate: number | null
          booking_date: string | null
          booking_no: string
          booking_type: string | null
          cancel_reason: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          channel_source: string | null
          child_cost: number | null
          child_count: number | null
          child_e_cost: number | null
          child_e_count: number | null
          child_e_price: number | null
          child_n_cost: number | null
          child_n_count: number | null
          child_n_price: number | null
          child_price: number | null
          commission_amount: number | null
          commission_breakdown: Json | null
          commission_clawed_back: boolean
          commission_rate: number | null
          content_creative_id: string | null
          conversation_id: string | null
          cost_snapshot_krw: number | null
          created_at: string | null
          departing_location_id: string | null
          departure_date: string | null
          departure_region: string | null
          deposit_notice_blocked: boolean
          discount_used: number | null
          dispute_flag: boolean
          dispute_note: string | null
          flight_in: string | null
          flight_in_time: string | null
          flight_out: string | null
          flight_out_time: string | null
          fuel_surcharge: number | null
          has_sent_docs: boolean | null
          id: string
          idempotency_key: string | null
          infant_cost: number | null
          infant_count: number | null
          infant_price: number | null
          influencer_commission: number | null
          installment_months: number | null
          is_deleted: boolean | null
          is_guide_notified: boolean | null
          is_manifest_sent: boolean | null
          is_manual_cost: boolean
          is_ticketed: boolean | null
          land_operator: string | null
          land_operator_id: string | null
          lead_customer_id: string | null
          lead_time: number | null
          local_expenses: Json | null
          manager_name: string | null
          margin: number | null
          metadata: Json | null
          net_cashflow: number | null
          notes: string | null
          package_id: string | null
          package_title: string | null
          paid_amount: number | null
          payment_date: string | null
          payment_method: string | null
          payment_status: string | null
          penalty_fee: number | null
          price_sensitivity_score: number | null
          product_id: string | null
          quick_created: boolean
          quick_created_tx_id: string | null
          referral_code: string | null
          refund_amount: number | null
          refund_rate: number | null
          refund_settled_at: string | null
          refunded_at: string | null
          return_date: string | null
          settlement_confirmed_at: string | null
          settlement_confirmed_by: string | null
          settlement_mode: string | null
          single_charge: number | null
          single_charge_count: number | null
          status: string | null
          surcharge_breakdown: Json | null
          tenant_id: string | null
          terms_agreed_at: string | null
          terms_snapshot: Json | null
          terms_snapshot_hash: string | null
          total_cost: number | null
          total_paid_out: number | null
          total_price: number | null
          updated_at: string | null
          utm_attributed_campaign_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          void_reason: string | null
          voided_at: string | null
          wallet_share_estimate: number | null
        }
        Insert: {
          actual_payer_name?: string | null
          adult_cost?: number | null
          adult_count?: number | null
          adult_price?: number | null
          affiliate_id?: string | null
          ancillary_spend?: number | null
          applied_total_commission_rate?: number | null
          booking_date?: string | null
          booking_no: string
          booking_type?: string | null
          cancel_reason?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          channel_source?: string | null
          child_cost?: number | null
          child_count?: number | null
          child_e_cost?: number | null
          child_e_count?: number | null
          child_e_price?: number | null
          child_n_cost?: number | null
          child_n_count?: number | null
          child_n_price?: number | null
          child_price?: number | null
          commission_amount?: number | null
          commission_breakdown?: Json | null
          commission_clawed_back?: boolean
          commission_rate?: number | null
          content_creative_id?: string | null
          conversation_id?: string | null
          cost_snapshot_krw?: number | null
          created_at?: string | null
          departing_location_id?: string | null
          departure_date?: string | null
          departure_region?: string | null
          deposit_notice_blocked?: boolean
          discount_used?: number | null
          dispute_flag?: boolean
          dispute_note?: string | null
          flight_in?: string | null
          flight_in_time?: string | null
          flight_out?: string | null
          flight_out_time?: string | null
          fuel_surcharge?: number | null
          has_sent_docs?: boolean | null
          id?: string
          idempotency_key?: string | null
          infant_cost?: number | null
          infant_count?: number | null
          infant_price?: number | null
          influencer_commission?: number | null
          installment_months?: number | null
          is_deleted?: boolean | null
          is_guide_notified?: boolean | null
          is_manifest_sent?: boolean | null
          is_manual_cost?: boolean
          is_ticketed?: boolean | null
          land_operator?: string | null
          land_operator_id?: string | null
          lead_customer_id?: string | null
          lead_time?: number | null
          local_expenses?: Json | null
          manager_name?: string | null
          margin?: number | null
          metadata?: Json | null
          net_cashflow?: number | null
          notes?: string | null
          package_id?: string | null
          package_title?: string | null
          paid_amount?: number | null
          payment_date?: string | null
          payment_method?: string | null
          payment_status?: string | null
          penalty_fee?: number | null
          price_sensitivity_score?: number | null
          product_id?: string | null
          quick_created?: boolean
          quick_created_tx_id?: string | null
          referral_code?: string | null
          refund_amount?: number | null
          refund_rate?: number | null
          refund_settled_at?: string | null
          refunded_at?: string | null
          return_date?: string | null
          settlement_confirmed_at?: string | null
          settlement_confirmed_by?: string | null
          settlement_mode?: string | null
          single_charge?: number | null
          single_charge_count?: number | null
          status?: string | null
          surcharge_breakdown?: Json | null
          tenant_id?: string | null
          terms_agreed_at?: string | null
          terms_snapshot?: Json | null
          terms_snapshot_hash?: string | null
          total_cost?: number | null
          total_paid_out?: number | null
          total_price?: number | null
          updated_at?: string | null
          utm_attributed_campaign_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          void_reason?: string | null
          voided_at?: string | null
          wallet_share_estimate?: number | null
        }
        Update: {
          actual_payer_name?: string | null
          adult_cost?: number | null
          adult_count?: number | null
          adult_price?: number | null
          affiliate_id?: string | null
          ancillary_spend?: number | null
          applied_total_commission_rate?: number | null
          booking_date?: string | null
          booking_no?: string
          booking_type?: string | null
          cancel_reason?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          channel_source?: string | null
          child_cost?: number | null
          child_count?: number | null
          child_e_cost?: number | null
          child_e_count?: number | null
          child_e_price?: number | null
          child_n_cost?: number | null
          child_n_count?: number | null
          child_n_price?: number | null
          child_price?: number | null
          commission_amount?: number | null
          commission_breakdown?: Json | null
          commission_clawed_back?: boolean
          commission_rate?: number | null
          content_creative_id?: string | null
          conversation_id?: string | null
          cost_snapshot_krw?: number | null
          created_at?: string | null
          departing_location_id?: string | null
          departure_date?: string | null
          departure_region?: string | null
          deposit_notice_blocked?: boolean
          discount_used?: number | null
          dispute_flag?: boolean
          dispute_note?: string | null
          flight_in?: string | null
          flight_in_time?: string | null
          flight_out?: string | null
          flight_out_time?: string | null
          fuel_surcharge?: number | null
          has_sent_docs?: boolean | null
          id?: string
          idempotency_key?: string | null
          infant_cost?: number | null
          infant_count?: number | null
          infant_price?: number | null
          influencer_commission?: number | null
          installment_months?: number | null
          is_deleted?: boolean | null
          is_guide_notified?: boolean | null
          is_manifest_sent?: boolean | null
          is_manual_cost?: boolean
          is_ticketed?: boolean | null
          land_operator?: string | null
          land_operator_id?: string | null
          lead_customer_id?: string | null
          lead_time?: number | null
          local_expenses?: Json | null
          manager_name?: string | null
          margin?: number | null
          metadata?: Json | null
          net_cashflow?: number | null
          notes?: string | null
          package_id?: string | null
          package_title?: string | null
          paid_amount?: number | null
          payment_date?: string | null
          payment_method?: string | null
          payment_status?: string | null
          penalty_fee?: number | null
          price_sensitivity_score?: number | null
          product_id?: string | null
          quick_created?: boolean
          quick_created_tx_id?: string | null
          referral_code?: string | null
          refund_amount?: number | null
          refund_rate?: number | null
          refund_settled_at?: string | null
          refunded_at?: string | null
          return_date?: string | null
          settlement_confirmed_at?: string | null
          settlement_confirmed_by?: string | null
          settlement_mode?: string | null
          single_charge?: number | null
          single_charge_count?: number | null
          status?: string | null
          surcharge_breakdown?: Json | null
          tenant_id?: string | null
          terms_agreed_at?: string | null
          terms_snapshot?: Json | null
          terms_snapshot_hash?: string | null
          total_cost?: number | null
          total_paid_out?: number | null
          total_price?: number | null
          updated_at?: string | null
          utm_attributed_campaign_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          void_reason?: string | null
          voided_at?: string | null
          wallet_share_estimate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "influencer_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_departing_location_id_fkey"
            columns: ["departing_location_id"]
            isOneToOne: false
            referencedRelation: "departing_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_land_operator_id_fkey"
            columns: ["land_operator_id"]
            isOneToOne: false
            referencedRelation: "land_operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_lead_customer_id_fkey"
            columns: ["lead_customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_lead_customer_id_fkey"
            columns: ["lead_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_lead_customer_id_fkey"
            columns: ["lead_customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["internal_code"]
          },
          {
            foreignKeyName: "bookings_quick_created_tx_id_fkey"
            columns: ["quick_created_tx_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_utm_attributed_campaign_id_fkey"
            columns: ["utm_attributed_campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_kits: {
        Row: {
          code: string
          colors: Json
          created_at: string | null
          domain: string | null
          fonts: Json
          id: string
          is_active: boolean
          logo_text: string | null
          logo_url: string | null
          name: string
          updated_at: string | null
          voice_guide: string | null
          voice_samples: Json | null
        }
        Insert: {
          code: string
          colors?: Json
          created_at?: string | null
          domain?: string | null
          fonts?: Json
          id?: string
          is_active?: boolean
          logo_text?: string | null
          logo_url?: string | null
          name: string
          updated_at?: string | null
          voice_guide?: string | null
          voice_samples?: Json | null
        }
        Update: {
          code?: string
          colors?: Json
          created_at?: string | null
          domain?: string | null
          fonts?: Json
          id?: string
          is_active?: boolean
          logo_text?: string | null
          logo_url?: string | null
          name?: string
          updated_at?: string | null
          voice_guide?: string | null
          voice_samples?: Json | null
        }
        Relationships: []
      }
      bronze_chat_events: {
        Row: {
          consent_for_pool: boolean
          conversation_id: string | null
          extracted_at: string | null
          extraction_error: string | null
          extraction_status: string
          id: string
          ingested_at: string
          jarvis_draft: string | null
          message_count: number
          metadata: Json
          owner_response: string | null
          raw_payload: Json
          redacted_text: string | null
          redaction_report: Json | null
          related_booking_id: string | null
          source: string
          tenant_id: string | null
          triple_count: number
        }
        Insert: {
          consent_for_pool?: boolean
          conversation_id?: string | null
          extracted_at?: string | null
          extraction_error?: string | null
          extraction_status?: string
          id?: string
          ingested_at?: string
          jarvis_draft?: string | null
          message_count?: number
          metadata?: Json
          owner_response?: string | null
          raw_payload: Json
          redacted_text?: string | null
          redaction_report?: Json | null
          related_booking_id?: string | null
          source: string
          tenant_id?: string | null
          triple_count?: number
        }
        Update: {
          consent_for_pool?: boolean
          conversation_id?: string | null
          extracted_at?: string | null
          extraction_error?: string | null
          extraction_status?: string
          id?: string
          ingested_at?: string
          jarvis_draft?: string | null
          message_count?: number
          metadata?: Json
          owner_response?: string | null
          raw_payload?: Json
          redacted_text?: string | null
          redaction_report?: Json | null
          related_booking_id?: string | null
          source?: string
          tenant_id?: string | null
          triple_count?: number
        }
        Relationships: []
      }
      campaign_engagements: {
        Row: {
          attribution_model: string | null
          attribution_weight: number | null
          browser: string | null
          campaign_id: string
          clicked: boolean | null
          clicked_at: string | null
          conversion_package_id: string | null
          conversion_value: number | null
          converted: boolean | null
          converted_at: string | null
          created_at: string | null
          creative_variant: string | null
          customer_id: string | null
          device_type: string | null
          engagement_channel: string | null
          engagement_type: string | null
          id: string
          location: string | null
          session_id: string | null
          shown_at: string | null
        }
        Insert: {
          attribution_model?: string | null
          attribution_weight?: number | null
          browser?: string | null
          campaign_id: string
          clicked?: boolean | null
          clicked_at?: string | null
          conversion_package_id?: string | null
          conversion_value?: number | null
          converted?: boolean | null
          converted_at?: string | null
          created_at?: string | null
          creative_variant?: string | null
          customer_id?: string | null
          device_type?: string | null
          engagement_channel?: string | null
          engagement_type?: string | null
          id?: string
          location?: string | null
          session_id?: string | null
          shown_at?: string | null
        }
        Update: {
          attribution_model?: string | null
          attribution_weight?: number | null
          browser?: string | null
          campaign_id?: string
          clicked?: boolean | null
          clicked_at?: string | null
          conversion_package_id?: string | null
          conversion_value?: number | null
          converted?: boolean | null
          converted_at?: string | null
          created_at?: string | null
          creative_variant?: string | null
          customer_id?: string | null
          device_type?: string | null
          engagement_channel?: string | null
          engagement_type?: string | null
          id?: string
          location?: string | null
          session_id?: string | null
          shown_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_engagements_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_roi_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_engagements_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_engagements_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_engagements_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_engagements_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      capital_entries: {
        Row: {
          amount: number
          created_at: string
          entry_date: string
          id: string
          note: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          entry_date?: string
          id?: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          entry_date?: string
          id?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      card_news: {
        Row: {
          brand_kit_id: string | null
          campaign_id: string | null
          card_news_type: string | null
          category_id: string | null
          created_at: string | null
          created_by: string | null
          ctr: number | null
          engagement_measured_at: string | null
          engagement_score: number | null
          generation_config: Json | null
          html_generated: string | null
          html_raw: string | null
          html_thinking: string | null
          html_usage: Json | null
          id: string
          ig_caption: string | null
          ig_error: string | null
          ig_post_id: string | null
          ig_publish_status: string | null
          ig_published_at: string | null
          ig_scheduled_for: string | null
          ig_slide_urls: string[] | null
          is_winner: boolean | null
          linked_blog_id: string | null
          meta_creative_id: string | null
          package_id: string | null
          slide_image_urls: Json | null
          slides: Json
          status: string | null
          template_family: string | null
          template_version: string | null
          threads_error: string | null
          threads_media_urls: string[] | null
          threads_post_id: string | null
          threads_publish_status: string | null
          threads_published_at: string | null
          threads_scheduled_for: string | null
          threads_text: string | null
          title: string
          topic: string | null
          updated_at: string | null
          variant_angle: string | null
          variant_group_id: string | null
          variant_score: number | null
          variant_score_detail: Json | null
          views: number | null
          winner_decided_at: string | null
        }
        Insert: {
          brand_kit_id?: string | null
          campaign_id?: string | null
          card_news_type?: string | null
          category_id?: string | null
          created_at?: string | null
          created_by?: string | null
          ctr?: number | null
          engagement_measured_at?: string | null
          engagement_score?: number | null
          generation_config?: Json | null
          html_generated?: string | null
          html_raw?: string | null
          html_thinking?: string | null
          html_usage?: Json | null
          id?: string
          ig_caption?: string | null
          ig_error?: string | null
          ig_post_id?: string | null
          ig_publish_status?: string | null
          ig_published_at?: string | null
          ig_scheduled_for?: string | null
          ig_slide_urls?: string[] | null
          is_winner?: boolean | null
          linked_blog_id?: string | null
          meta_creative_id?: string | null
          package_id?: string | null
          slide_image_urls?: Json | null
          slides?: Json
          status?: string | null
          template_family?: string | null
          template_version?: string | null
          threads_error?: string | null
          threads_media_urls?: string[] | null
          threads_post_id?: string | null
          threads_publish_status?: string | null
          threads_published_at?: string | null
          threads_scheduled_for?: string | null
          threads_text?: string | null
          title: string
          topic?: string | null
          updated_at?: string | null
          variant_angle?: string | null
          variant_group_id?: string | null
          variant_score?: number | null
          variant_score_detail?: Json | null
          views?: number | null
          winner_decided_at?: string | null
        }
        Update: {
          brand_kit_id?: string | null
          campaign_id?: string | null
          card_news_type?: string | null
          category_id?: string | null
          created_at?: string | null
          created_by?: string | null
          ctr?: number | null
          engagement_measured_at?: string | null
          engagement_score?: number | null
          generation_config?: Json | null
          html_generated?: string | null
          html_raw?: string | null
          html_thinking?: string | null
          html_usage?: Json | null
          id?: string
          ig_caption?: string | null
          ig_error?: string | null
          ig_post_id?: string | null
          ig_publish_status?: string | null
          ig_published_at?: string | null
          ig_scheduled_for?: string | null
          ig_slide_urls?: string[] | null
          is_winner?: boolean | null
          linked_blog_id?: string | null
          meta_creative_id?: string | null
          package_id?: string | null
          slide_image_urls?: Json | null
          slides?: Json
          status?: string | null
          template_family?: string | null
          template_version?: string | null
          threads_error?: string | null
          threads_media_urls?: string[] | null
          threads_post_id?: string | null
          threads_publish_status?: string | null
          threads_published_at?: string | null
          threads_scheduled_for?: string | null
          threads_text?: string | null
          title?: string
          topic?: string | null
          updated_at?: string | null
          variant_angle?: string | null
          variant_group_id?: string | null
          variant_score?: number | null
          variant_score_detail?: Json | null
          views?: number | null
          winner_decided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "card_news_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "blog_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_news_linked_blog_id_fkey"
            columns: ["linked_blog_id"]
            isOneToOne: false
            referencedRelation: "blog_performance_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_news_linked_blog_id_fkey"
            columns: ["linked_blog_id"]
            isOneToOne: false
            referencedRelation: "content_creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_news_linked_blog_id_fkey"
            columns: ["linked_blog_id"]
            isOneToOne: false
            referencedRelation: "content_roas_summary"
            referencedColumns: ["creative_id"]
          },
          {
            foreignKeyName: "fk_card_news_brand_kit"
            columns: ["brand_kit_id"]
            isOneToOne: false
            referencedRelation: "brand_kits"
            referencedColumns: ["id"]
          },
        ]
      }
      card_news_renders: {
        Row: {
          card_news_id: string
          format: string
          id: string
          rendered_at: string | null
          slide_id: string | null
          slide_index: number
          storage_path: string | null
          template_family: string | null
          template_version: string | null
          url: string
          used_on: Json | null
        }
        Insert: {
          card_news_id: string
          format: string
          id?: string
          rendered_at?: string | null
          slide_id?: string | null
          slide_index: number
          storage_path?: string | null
          template_family?: string | null
          template_version?: string | null
          url: string
          used_on?: Json | null
        }
        Update: {
          card_news_id?: string
          format?: string
          id?: string
          rendered_at?: string | null
          slide_id?: string | null
          slide_index?: number
          storage_path?: string | null
          template_family?: string | null
          template_version?: string | null
          url?: string
          used_on?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "card_news_renders_card_news_id_fkey"
            columns: ["card_news_id"]
            isOneToOne: false
            referencedRelation: "card_news"
            referencedColumns: ["id"]
          },
        ]
      }
      card_news_variants: {
        Row: {
          base_card_news_id: string | null
          created_at: string | null
          id: string
          metrics: Json | null
          template_family: string
          variant_card_news_id: string | null
          variant_label: string | null
        }
        Insert: {
          base_card_news_id?: string | null
          created_at?: string | null
          id?: string
          metrics?: Json | null
          template_family: string
          variant_card_news_id?: string | null
          variant_label?: string | null
        }
        Update: {
          base_card_news_id?: string | null
          created_at?: string | null
          id?: string
          metrics?: Json | null
          template_family?: string
          variant_card_news_id?: string | null
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "card_news_variants_base_card_news_id_fkey"
            columns: ["base_card_news_id"]
            isOneToOne: false
            referencedRelation: "card_news"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_news_variants_variant_card_news_id_fkey"
            columns: ["variant_card_news_id"]
            isOneToOne: false
            referencedRelation: "card_news"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          created_at: string | null
          id: string
          items: Json
          session_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          items?: Json
          session_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          items?: Json
          session_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      commission_adjustments: {
        Row: {
          adjustment_type: string
          affiliate_id: string
          amount: number
          applied_at: string | null
          applied_to_period: string | null
          booking_id: string | null
          created_at: string | null
          created_by: string
          id: string
          reason: string
          status: string
        }
        Insert: {
          adjustment_type: string
          affiliate_id: string
          amount: number
          applied_at?: string | null
          applied_to_period?: string | null
          booking_id?: string | null
          created_at?: string | null
          created_by?: string
          id?: string
          reason: string
          status?: string
        }
        Update: {
          adjustment_type?: string
          affiliate_id?: string
          amount?: number
          applied_at?: string | null
          applied_to_period?: string | null
          booking_id?: string | null
          created_at?: string | null
          created_by?: string
          id?: string
          reason?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_adjustments_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_adjustments_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "influencer_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_adjustments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_adjustments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_adjustments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_ad_snapshots: {
        Row: {
          active_days: number | null
          ad_library_id: string | null
          analysis: Json | null
          brand: string
          captured_at: string | null
          captured_by: string | null
          copy_description: string | null
          copy_headline: string | null
          copy_primary: string
          created_at: string | null
          creative_urls: string[] | null
          cta_button: string | null
          ctr_estimate: number | null
          destination_hint: string | null
          id: string
          impressions_lower: number | null
          impressions_upper: number | null
          landing_url: string | null
          platform: string
          product_category: string | null
          promo_type: string | null
          source_url: string | null
          spend_lower_krw: number | null
          spend_upper_krw: number | null
        }
        Insert: {
          active_days?: number | null
          ad_library_id?: string | null
          analysis?: Json | null
          brand: string
          captured_at?: string | null
          captured_by?: string | null
          copy_description?: string | null
          copy_headline?: string | null
          copy_primary: string
          created_at?: string | null
          creative_urls?: string[] | null
          cta_button?: string | null
          ctr_estimate?: number | null
          destination_hint?: string | null
          id?: string
          impressions_lower?: number | null
          impressions_upper?: number | null
          landing_url?: string | null
          platform?: string
          product_category?: string | null
          promo_type?: string | null
          source_url?: string | null
          spend_lower_krw?: number | null
          spend_upper_krw?: number | null
        }
        Update: {
          active_days?: number | null
          ad_library_id?: string | null
          analysis?: Json | null
          brand?: string
          captured_at?: string | null
          captured_by?: string | null
          copy_description?: string | null
          copy_headline?: string | null
          copy_primary?: string
          created_at?: string | null
          creative_urls?: string[] | null
          cta_button?: string | null
          ctr_estimate?: number | null
          destination_hint?: string | null
          id?: string
          impressions_lower?: number | null
          impressions_upper?: number | null
          landing_url?: string | null
          platform?: string
          product_category?: string | null
          promo_type?: string | null
          source_url?: string | null
          spend_lower_krw?: number | null
          spend_upper_krw?: number | null
        }
        Relationships: []
      }
      competitor_pricing: {
        Row: {
          competitor_name: string
          competitor_price: number
          competitor_product_name: string | null
          created_at: string | null
          data_quality: string | null
          destination: string | null
          duration_days: number | null
          id: string
          inclusions: Json | null
          our_package_id: string | null
          our_price: number
          price_difference: number | null
          price_difference_percent: number | null
          quality_score: number | null
          scraped_at: string | null
          scraping_method: string | null
          source_url: string | null
        }
        Insert: {
          competitor_name: string
          competitor_price: number
          competitor_product_name?: string | null
          created_at?: string | null
          data_quality?: string | null
          destination?: string | null
          duration_days?: number | null
          id?: string
          inclusions?: Json | null
          our_package_id?: string | null
          our_price: number
          price_difference?: number | null
          price_difference_percent?: number | null
          quality_score?: number | null
          scraped_at?: string | null
          scraping_method?: string | null
          source_url?: string | null
        }
        Update: {
          competitor_name?: string
          competitor_price?: number
          competitor_product_name?: string | null
          created_at?: string | null
          data_quality?: string | null
          destination?: string | null
          duration_days?: number | null
          id?: string
          inclusions?: Json | null
          our_package_id?: string | null
          our_price?: number
          price_difference?: number | null
          price_difference_percent?: number | null
          quality_score?: number | null
          scraped_at?: string | null
          scraping_method?: string | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_pricing_our_package_id_fkey"
            columns: ["our_package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_pricing_our_package_id_fkey"
            columns: ["our_package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      content_creatives: {
        Row: {
          ad_copy: Json | null
          ai_model: string | null
          ai_temperature: number | null
          angle_type: string
          blog_html: string | null
          category: string | null
          category_id: string | null
          channel: string
          content_type: string | null
          created_at: string | null
          destination: string | null
          extra_prompt: string | null
          featured: boolean
          featured_order: number | null
          generation_meta: Json | null
          generation_params: Json | null
          id: string
          image_ratio: string | null
          landing_enabled: boolean
          landing_headline: string | null
          landing_subtitle: string | null
          og_image_url: string | null
          pillar_for: string | null
          product_id: string | null
          prompt_version: string | null
          publish_scheduled_at: string | null
          published_at: string | null
          quality_gate: Json | null
          readability_issues: Json | null
          readability_score: number | null
          seo_description: string | null
          seo_title: string | null
          slides: Json | null
          slug: string | null
          status: string | null
          sub_keyword: string | null
          target_ad_keywords: string[] | null
          target_audience: string | null
          tenant_id: string | null
          tone: string | null
          topic_source: string | null
          tracking_id: string | null
          updated_at: string | null
          view_count: number
        }
        Insert: {
          ad_copy?: Json | null
          ai_model?: string | null
          ai_temperature?: number | null
          angle_type?: string
          blog_html?: string | null
          category?: string | null
          category_id?: string | null
          channel?: string
          content_type?: string | null
          created_at?: string | null
          destination?: string | null
          extra_prompt?: string | null
          featured?: boolean
          featured_order?: number | null
          generation_meta?: Json | null
          generation_params?: Json | null
          id?: string
          image_ratio?: string | null
          landing_enabled?: boolean
          landing_headline?: string | null
          landing_subtitle?: string | null
          og_image_url?: string | null
          pillar_for?: string | null
          product_id?: string | null
          prompt_version?: string | null
          publish_scheduled_at?: string | null
          published_at?: string | null
          quality_gate?: Json | null
          readability_issues?: Json | null
          readability_score?: number | null
          seo_description?: string | null
          seo_title?: string | null
          slides?: Json | null
          slug?: string | null
          status?: string | null
          sub_keyword?: string | null
          target_ad_keywords?: string[] | null
          target_audience?: string | null
          tenant_id?: string | null
          tone?: string | null
          topic_source?: string | null
          tracking_id?: string | null
          updated_at?: string | null
          view_count?: number
        }
        Update: {
          ad_copy?: Json | null
          ai_model?: string | null
          ai_temperature?: number | null
          angle_type?: string
          blog_html?: string | null
          category?: string | null
          category_id?: string | null
          channel?: string
          content_type?: string | null
          created_at?: string | null
          destination?: string | null
          extra_prompt?: string | null
          featured?: boolean
          featured_order?: number | null
          generation_meta?: Json | null
          generation_params?: Json | null
          id?: string
          image_ratio?: string | null
          landing_enabled?: boolean
          landing_headline?: string | null
          landing_subtitle?: string | null
          og_image_url?: string | null
          pillar_for?: string | null
          product_id?: string | null
          prompt_version?: string | null
          publish_scheduled_at?: string | null
          published_at?: string | null
          quality_gate?: Json | null
          readability_issues?: Json | null
          readability_score?: number | null
          seo_description?: string | null
          seo_title?: string | null
          slides?: Json | null
          slug?: string | null
          status?: string | null
          sub_keyword?: string | null
          target_ad_keywords?: string[] | null
          target_audience?: string | null
          tenant_id?: string | null
          tone?: string | null
          topic_source?: string | null
          tracking_id?: string | null
          updated_at?: string | null
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_creatives_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "blog_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_creatives_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_creatives_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      content_distributions: {
        Row: {
          ad_disclosure: string | null
          affiliate_id: string | null
          blog_post_id: string | null
          card_news_id: string | null
          created_at: string | null
          created_by: string | null
          engagement: Json | null
          external_id: string | null
          external_url: string | null
          generation_agent: string | null
          generation_config: Json | null
          id: string
          is_co_branded: boolean
          payload: Json
          platform: string
          product_id: string | null
          published_at: string | null
          scheduled_for: string | null
          status: string
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          ad_disclosure?: string | null
          affiliate_id?: string | null
          blog_post_id?: string | null
          card_news_id?: string | null
          created_at?: string | null
          created_by?: string | null
          engagement?: Json | null
          external_id?: string | null
          external_url?: string | null
          generation_agent?: string | null
          generation_config?: Json | null
          id?: string
          is_co_branded?: boolean
          payload?: Json
          platform: string
          product_id?: string | null
          published_at?: string | null
          scheduled_for?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          ad_disclosure?: string | null
          affiliate_id?: string | null
          blog_post_id?: string | null
          card_news_id?: string | null
          created_at?: string | null
          created_by?: string | null
          engagement?: Json | null
          external_id?: string | null
          external_url?: string | null
          generation_agent?: string | null
          generation_config?: Json | null
          id?: string
          is_co_branded?: boolean
          payload?: Json
          platform?: string
          product_id?: string | null
          published_at?: string | null
          scheduled_for?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_distributions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_distributions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "influencer_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_distributions_card_news_id_fkey"
            columns: ["card_news_id"]
            isOneToOne: false
            referencedRelation: "card_news"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_distributions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_distributions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_distributions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      content_factory_jobs: {
        Row: {
          card_news_id: string
          completed_at: string | null
          completed_steps: number
          cost_usd: number | null
          created_at: string
          failed_steps: number
          id: string
          product_id: string | null
          started_at: string | null
          status: string
          steps: Json
          tenant_id: string | null
          total_steps: number
          updated_at: string
        }
        Insert: {
          card_news_id: string
          completed_at?: string | null
          completed_steps?: number
          cost_usd?: number | null
          created_at?: string
          failed_steps?: number
          id?: string
          product_id?: string | null
          started_at?: string | null
          status?: string
          steps?: Json
          tenant_id?: string | null
          total_steps?: number
          updated_at?: string
        }
        Update: {
          card_news_id?: string
          completed_at?: string | null
          completed_steps?: number
          cost_usd?: number | null
          created_at?: string
          failed_steps?: number
          id?: string
          product_id?: string | null
          started_at?: string | null
          status?: string
          steps?: Json
          tenant_id?: string | null
          total_steps?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_factory_jobs_card_news_id_fkey"
            columns: ["card_news_id"]
            isOneToOne: true
            referencedRelation: "card_news"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_factory_jobs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_factory_jobs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_factory_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      content_insights: {
        Row: {
          angle_type: string
          avg_conversions: number | null
          avg_cpa: number | null
          avg_ctr: number | null
          channel: string
          confidence_score: number | null
          destination: string
          id: string
          last_updated: string | null
          sample_count: number | null
          target_audience: string | null
          tenant_id: string | null
        }
        Insert: {
          angle_type: string
          avg_conversions?: number | null
          avg_cpa?: number | null
          avg_ctr?: number | null
          channel: string
          confidence_score?: number | null
          destination: string
          id?: string
          last_updated?: string | null
          sample_count?: number | null
          target_audience?: string | null
          tenant_id?: string | null
        }
        Update: {
          angle_type?: string
          avg_conversions?: number | null
          avg_cpa?: number | null
          avg_ctr?: number | null
          channel?: string
          confidence_score?: number | null
          destination?: string
          id?: string
          last_updated?: string | null
          sample_count?: number | null
          target_audience?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      content_performance: {
        Row: {
          clicks: number | null
          conversions: number | null
          cpa: number | null
          created_at: string | null
          creative_id: string | null
          ctr: number | null
          date: string
          id: string
          impressions: number | null
          platform_raw: Json | null
          roas: number | null
          spend: number | null
          tenant_id: string | null
        }
        Insert: {
          clicks?: number | null
          conversions?: number | null
          cpa?: number | null
          created_at?: string | null
          creative_id?: string | null
          ctr?: number | null
          date: string
          id?: string
          impressions?: number | null
          platform_raw?: Json | null
          roas?: number | null
          spend?: number | null
          tenant_id?: string | null
        }
        Update: {
          clicks?: number | null
          conversions?: number | null
          cpa?: number | null
          created_at?: string | null
          creative_id?: string | null
          ctr?: number | null
          date?: string
          id?: string
          impressions?: number | null
          platform_raw?: Json | null
          roas?: number | null
          spend?: number | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_performance_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "blog_performance_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_performance_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "content_creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_performance_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "content_roas_summary"
            referencedColumns: ["creative_id"]
          },
        ]
      }
      conversations: {
        Row: {
          affiliate_id: string | null
          ai_intervention_success: boolean | null
          channel: string | null
          created_at: string | null
          customer_id: string | null
          id: string
          journey: Json | null
          messages: Json | null
          question_complexity: number | null
          rejection_keywords: string[] | null
          sentiment_score: number | null
          source: string | null
          updated_at: string | null
          urgency_level: string | null
        }
        Insert: {
          affiliate_id?: string | null
          ai_intervention_success?: boolean | null
          channel?: string | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          journey?: Json | null
          messages?: Json | null
          question_complexity?: number | null
          rejection_keywords?: string[] | null
          sentiment_score?: number | null
          source?: string | null
          updated_at?: string | null
          urgency_level?: string | null
        }
        Update: {
          affiliate_id?: string | null
          ai_intervention_success?: boolean | null
          channel?: string | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          journey?: Json | null
          messages?: Json | null
          question_complexity?: number | null
          rejection_keywords?: string[] | null
          sentiment_score?: number | null
          source?: string | null
          updated_at?: string | null
          urgency_level?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "influencer_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      course_templates: {
        Row: {
          course_type: string
          created_at: string | null
          day_blocks: Json
          days: number
          default_excludes: string[] | null
          default_inclusions: string[] | null
          default_tags: string[] | null
          destination_id: string
          id: string
          is_active: boolean | null
          name: string
          nights: number
          template_code: string
          updated_at: string | null
        }
        Insert: {
          course_type?: string
          created_at?: string | null
          day_blocks: Json
          days: number
          default_excludes?: string[] | null
          default_inclusions?: string[] | null
          default_tags?: string[] | null
          destination_id: string
          id?: string
          is_active?: boolean | null
          name: string
          nights: number
          template_code: string
          updated_at?: string | null
        }
        Update: {
          course_type?: string
          created_at?: string | null
          day_blocks?: Json
          days?: number
          default_excludes?: string[] | null
          default_inclusions?: string[] | null
          default_tags?: string[] | null
          destination_id?: string
          id?: string
          is_active?: boolean | null
          name?: string
          nights?: number
          template_code?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_templates_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destination_masters"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_edits: {
        Row: {
          after_value: string | null
          before_value: string | null
          creative_id: string
          edited_at: string | null
          edited_by: string | null
          field: string
          id: string
          slide_index: number | null
        }
        Insert: {
          after_value?: string | null
          before_value?: string | null
          creative_id: string
          edited_at?: string | null
          edited_by?: string | null
          field: string
          id?: string
          slide_index?: number | null
        }
        Update: {
          after_value?: string | null
          before_value?: string | null
          creative_id?: string
          edited_at?: string | null
          edited_by?: string | null
          field?: string
          id?: string
          slide_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "creative_edits_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "ad_creatives"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_performance: {
        Row: {
          bookings: number | null
          channel: string
          clicks: number | null
          cpc: number | null
          created_at: string | null
          creative_id: string
          ctr: number | null
          date: string
          frequency: number | null
          id: string
          impressions: number | null
          inquiries: number | null
          reach: number | null
          revenue: number | null
          roas: number | null
          spend: number | null
          video_views: number | null
        }
        Insert: {
          bookings?: number | null
          channel: string
          clicks?: number | null
          cpc?: number | null
          created_at?: string | null
          creative_id: string
          ctr?: number | null
          date: string
          frequency?: number | null
          id?: string
          impressions?: number | null
          inquiries?: number | null
          reach?: number | null
          revenue?: number | null
          roas?: number | null
          spend?: number | null
          video_views?: number | null
        }
        Update: {
          bookings?: number | null
          channel?: string
          clicks?: number | null
          cpc?: number | null
          created_at?: string | null
          creative_id?: string
          ctr?: number | null
          date?: string
          frequency?: number | null
          id?: string
          impressions?: number | null
          inquiries?: number | null
          reach?: number | null
          revenue?: number | null
          roas?: number | null
          spend?: number | null
          video_views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "creative_performance_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "ad_creatives"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_run_logs: {
        Row: {
          alerted: boolean
          created_at: string
          cron_name: string
          elapsed_ms: number | null
          error_count: number
          error_messages: string[] | null
          finished_at: string
          id: string
          started_at: string
          status: string
          summary: Json | null
          tenant_id: string | null
        }
        Insert: {
          alerted?: boolean
          created_at?: string
          cron_name: string
          elapsed_ms?: number | null
          error_count?: number
          error_messages?: string[] | null
          finished_at: string
          id?: string
          started_at: string
          status: string
          summary?: Json | null
          tenant_id?: string | null
        }
        Update: {
          alerted?: boolean
          created_at?: string
          cron_name?: string
          elapsed_ms?: number | null
          error_count?: number
          error_messages?: string[] | null
          finished_at?: string
          id?: string
          started_at?: string
          status?: string
          summary?: Json | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cron_run_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_aliases: {
        Row: {
          alias: string
          confidence_boost: number
          created_at: string
          customer_id: string
          id: string
          last_used_at: string
          normalized_alias: string
          source: string
          usage_count: number
        }
        Insert: {
          alias: string
          confidence_boost?: number
          created_at?: string
          customer_id: string
          id?: string
          last_used_at?: string
          normalized_alias: string
          source?: string
          usage_count?: number
        }
        Update: {
          alias?: string
          confidence_boost?: number
          created_at?: string
          customer_id?: string
          id?: string
          last_used_at?: string
          normalized_alias?: string
          source?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_aliases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_aliases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_aliases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_facts: {
        Row: {
          access_count: number | null
          category: string
          confidence: number | null
          conversation_id: string | null
          customer_id: string | null
          embedding: string | null
          extracted_at: string | null
          fact_text: string
          id: string
          importance: number | null
          is_active: boolean | null
          last_accessed_at: string | null
          source_message_idx: number | null
          superseded_by: string | null
          tenant_id: string | null
        }
        Insert: {
          access_count?: number | null
          category?: string
          confidence?: number | null
          conversation_id?: string | null
          customer_id?: string | null
          embedding?: string | null
          extracted_at?: string | null
          fact_text: string
          id?: string
          importance?: number | null
          is_active?: boolean | null
          last_accessed_at?: string | null
          source_message_idx?: number | null
          superseded_by?: string | null
          tenant_id?: string | null
        }
        Update: {
          access_count?: number | null
          category?: string
          confidence?: number | null
          conversation_id?: string | null
          customer_id?: string | null
          embedding?: string | null
          extracted_at?: string | null
          fact_text?: string
          id?: string
          importance?: number | null
          is_active?: boolean | null
          last_accessed_at?: string | null
          source_message_idx?: number | null
          superseded_by?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_facts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_facts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_facts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_facts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_facts_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "customer_facts"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_notes: {
        Row: {
          channel: string | null
          content: string
          created_at: string | null
          customer_id: string
          id: string
        }
        Insert: {
          channel?: string | null
          content: string
          created_at?: string | null
          customer_id: string
          id?: string
        }
        Update: {
          channel?: string | null
          content?: string
          created_at?: string | null
          customer_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_preferences_learned: {
        Row: {
          accessibility_needs: string[] | null
          allergies: string[] | null
          confidence_score: number | null
          customer_id: string
          data_points_count: number | null
          decision_speed: string | null
          dislikes: string[] | null
          id: string
          preferred_accommodation_style: string[] | null
          preferred_activities: string[] | null
          preferred_booking_dow: number | null
          preferred_booking_hour: number | null
          preferred_meal_types: string[] | null
          preferred_pace: string | null
          price_sensitivity: string | null
          refers_friends: boolean | null
          shares_on_social: boolean | null
          typical_budget_range: unknown
          typical_lead_time_days: number | null
          updated_at: string | null
          upgrade_propensity: number | null
          writes_reviews: boolean | null
        }
        Insert: {
          accessibility_needs?: string[] | null
          allergies?: string[] | null
          confidence_score?: number | null
          customer_id: string
          data_points_count?: number | null
          decision_speed?: string | null
          dislikes?: string[] | null
          id?: string
          preferred_accommodation_style?: string[] | null
          preferred_activities?: string[] | null
          preferred_booking_dow?: number | null
          preferred_booking_hour?: number | null
          preferred_meal_types?: string[] | null
          preferred_pace?: string | null
          price_sensitivity?: string | null
          refers_friends?: boolean | null
          shares_on_social?: boolean | null
          typical_budget_range?: unknown
          typical_lead_time_days?: number | null
          updated_at?: string | null
          upgrade_propensity?: number | null
          writes_reviews?: boolean | null
        }
        Update: {
          accessibility_needs?: string[] | null
          allergies?: string[] | null
          confidence_score?: number | null
          customer_id?: string
          data_points_count?: number | null
          decision_speed?: string | null
          dislikes?: string[] | null
          id?: string
          preferred_accommodation_style?: string[] | null
          preferred_activities?: string[] | null
          preferred_booking_dow?: number | null
          preferred_booking_hour?: number | null
          preferred_meal_types?: string[] | null
          preferred_pace?: string | null
          price_sensitivity?: string | null
          refers_friends?: boolean | null
          shares_on_social?: boolean | null
          typical_budget_range?: unknown
          typical_lead_time_days?: number | null
          updated_at?: string | null
          upgrade_propensity?: number | null
          writes_reviews?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_preferences_learned_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_preferences_learned_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_preferences_learned_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_unified_profile: {
        Row: {
          avg_order_value: number | null
          behavioral_patterns: Json | null
          booking_frequency_days: number | null
          chat_engagement_count: number | null
          churn_risk_level: string | null
          created_at: string | null
          customer_id: string
          days_since_last_booking: number | null
          destination_fatigue: string[] | null
          dietary_restrictions: string[] | null
          email_click_rate: number | null
          email_open_rate: number | null
          engagement_score: number | null
          financial_profile: Json | null
          first_booking_at: string | null
          health_needs: string[] | null
          heritage_data: Json | null
          id: string
          last_booking_at: string | null
          lifecycle_stage: string | null
          ltv_estimate: number | null
          milestone_dates: Json | null
          next_best_action: string | null
          pet_friendly: boolean | null
          preferred_budget_range: unknown
          preferred_destinations: string[] | null
          preferred_party_type: string | null
          preferred_styles: string[] | null
          preferred_travel_months: number[] | null
          propensity_scores: Json | null
          psychological_profile: Json | null
          rfm_calculated_at: string | null
          rfm_f: number | null
          rfm_m: number | null
          rfm_r: number | null
          rfm_segment: string | null
          social_graph: Json | null
          total_revenue: number | null
          travel_companion_profile: Json | null
          travel_pace_preference: string | null
          updated_at: string | null
          website_visit_count: number | null
        }
        Insert: {
          avg_order_value?: number | null
          behavioral_patterns?: Json | null
          booking_frequency_days?: number | null
          chat_engagement_count?: number | null
          churn_risk_level?: string | null
          created_at?: string | null
          customer_id: string
          days_since_last_booking?: number | null
          destination_fatigue?: string[] | null
          dietary_restrictions?: string[] | null
          email_click_rate?: number | null
          email_open_rate?: number | null
          engagement_score?: number | null
          financial_profile?: Json | null
          first_booking_at?: string | null
          health_needs?: string[] | null
          heritage_data?: Json | null
          id?: string
          last_booking_at?: string | null
          lifecycle_stage?: string | null
          ltv_estimate?: number | null
          milestone_dates?: Json | null
          next_best_action?: string | null
          pet_friendly?: boolean | null
          preferred_budget_range?: unknown
          preferred_destinations?: string[] | null
          preferred_party_type?: string | null
          preferred_styles?: string[] | null
          preferred_travel_months?: number[] | null
          propensity_scores?: Json | null
          psychological_profile?: Json | null
          rfm_calculated_at?: string | null
          rfm_f?: number | null
          rfm_m?: number | null
          rfm_r?: number | null
          rfm_segment?: string | null
          social_graph?: Json | null
          total_revenue?: number | null
          travel_companion_profile?: Json | null
          travel_pace_preference?: string | null
          updated_at?: string | null
          website_visit_count?: number | null
        }
        Update: {
          avg_order_value?: number | null
          behavioral_patterns?: Json | null
          booking_frequency_days?: number | null
          chat_engagement_count?: number | null
          churn_risk_level?: string | null
          created_at?: string | null
          customer_id?: string
          days_since_last_booking?: number | null
          destination_fatigue?: string[] | null
          dietary_restrictions?: string[] | null
          email_click_rate?: number | null
          email_open_rate?: number | null
          engagement_score?: number | null
          financial_profile?: Json | null
          first_booking_at?: string | null
          health_needs?: string[] | null
          heritage_data?: Json | null
          id?: string
          last_booking_at?: string | null
          lifecycle_stage?: string | null
          ltv_estimate?: number | null
          milestone_dates?: Json | null
          next_best_action?: string | null
          pet_friendly?: boolean | null
          preferred_budget_range?: unknown
          preferred_destinations?: string[] | null
          preferred_party_type?: string | null
          preferred_styles?: string[] | null
          preferred_travel_months?: number[] | null
          propensity_scores?: Json | null
          psychological_profile?: Json | null
          rfm_calculated_at?: string | null
          rfm_f?: number | null
          rfm_m?: number | null
          rfm_r?: number | null
          rfm_segment?: string | null
          social_graph?: Json | null
          total_revenue?: number | null
          travel_companion_profile?: Json | null
          travel_pace_preference?: string | null
          updated_at?: string | null
          website_visit_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_unified_profile_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_unified_profile_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_unified_profile_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          birth_date: string | null
          booking_count: number | null
          cafe_sync_data: Json | null
          created_at: string | null
          deleted_at: string | null
          email: string | null
          first_contact_at: string | null
          grade: string | null
          id: string
          memo: string | null
          mileage: number | null
          name: string
          passport_expiry: string | null
          passport_no: string | null
          phone: string | null
          quick_created: boolean
          quick_created_tx_id: string | null
          referrer_id: string | null
          source: string | null
          status: string | null
          tags: string[] | null
          tenant_id: string | null
          total_spent: number | null
          updated_at: string | null
        }
        Insert: {
          birth_date?: string | null
          booking_count?: number | null
          cafe_sync_data?: Json | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          first_contact_at?: string | null
          grade?: string | null
          id?: string
          memo?: string | null
          mileage?: number | null
          name: string
          passport_expiry?: string | null
          passport_no?: string | null
          phone?: string | null
          quick_created?: boolean
          quick_created_tx_id?: string | null
          referrer_id?: string | null
          source?: string | null
          status?: string | null
          tags?: string[] | null
          tenant_id?: string | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Update: {
          birth_date?: string | null
          booking_count?: number | null
          cafe_sync_data?: Json | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          first_contact_at?: string | null
          grade?: string | null
          id?: string
          memo?: string | null
          mileage?: number | null
          name?: string
          passport_expiry?: string | null
          passport_no?: string | null
          phone?: string | null
          quick_created?: boolean
          quick_created_tx_id?: string | null
          referrer_id?: string | null
          source?: string | null
          status?: string | null
          tags?: string[] | null
          tenant_id?: string | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_quick_created_tx_id_fkey"
            columns: ["quick_created_tx_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "influencer_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_operations_metrics: {
        Row: {
          avg_booking_value: number | null
          avg_response_time_hours: number | null
          calculated_at: string | null
          cancelled_bookings: number | null
          confirmed_bookings: number | null
          conversion_rate: number | null
          daily_cost: number | null
          daily_margin: number | null
          daily_profit: number | null
          daily_revenue: number | null
          id: string
          inventory_sold_out_count: number | null
          marketing_spend: number | null
          metric_date: string
          new_bookings: number | null
          new_customers: number | null
          new_inquiries: number | null
          occupancy_rate: number | null
          page_views: number | null
          pending_inquiries: number | null
          resolved_inquiries: number | null
          returning_customers: number | null
          roas: number | null
          seats_sold: number | null
          top_destination: string | null
          top_selling_package_id: string | null
          total_available_seats: number | null
          total_sessions: number | null
          total_visitors: number | null
          unique_visitors: number | null
          website_visitors: number | null
        }
        Insert: {
          avg_booking_value?: number | null
          avg_response_time_hours?: number | null
          calculated_at?: string | null
          cancelled_bookings?: number | null
          confirmed_bookings?: number | null
          conversion_rate?: number | null
          daily_cost?: number | null
          daily_margin?: number | null
          daily_profit?: number | null
          daily_revenue?: number | null
          id?: string
          inventory_sold_out_count?: number | null
          marketing_spend?: number | null
          metric_date: string
          new_bookings?: number | null
          new_customers?: number | null
          new_inquiries?: number | null
          occupancy_rate?: number | null
          page_views?: number | null
          pending_inquiries?: number | null
          resolved_inquiries?: number | null
          returning_customers?: number | null
          roas?: number | null
          seats_sold?: number | null
          top_destination?: string | null
          top_selling_package_id?: string | null
          total_available_seats?: number | null
          total_sessions?: number | null
          total_visitors?: number | null
          unique_visitors?: number | null
          website_visitors?: number | null
        }
        Update: {
          avg_booking_value?: number | null
          avg_response_time_hours?: number | null
          calculated_at?: string | null
          cancelled_bookings?: number | null
          confirmed_bookings?: number | null
          conversion_rate?: number | null
          daily_cost?: number | null
          daily_margin?: number | null
          daily_profit?: number | null
          daily_revenue?: number | null
          id?: string
          inventory_sold_out_count?: number | null
          marketing_spend?: number | null
          metric_date?: string
          new_bookings?: number | null
          new_customers?: number | null
          new_inquiries?: number | null
          occupancy_rate?: number | null
          page_views?: number | null
          pending_inquiries?: number | null
          resolved_inquiries?: number | null
          returning_customers?: number | null
          roas?: number | null
          seats_sold?: number | null
          top_destination?: string | null
          top_selling_package_id?: string | null
          total_available_seats?: number | null
          total_sessions?: number | null
          total_visitors?: number | null
          unique_visitors?: number | null
          website_visitors?: number | null
        }
        Relationships: []
      }
      demand_forecast: {
        Row: {
          actual_demand: number | null
          confidence_score: number | null
          created_at: string | null
          destination: string | null
          event_factor: number | null
          external_factors: Json | null
          forecast_accuracy: number | null
          forecast_demand: number | null
          forecast_period: string
          id: string
          model_version: string | null
          package_id: string | null
          prediction_model: string | null
          season_factor: number | null
          trend_factor: number | null
        }
        Insert: {
          actual_demand?: number | null
          confidence_score?: number | null
          created_at?: string | null
          destination?: string | null
          event_factor?: number | null
          external_factors?: Json | null
          forecast_accuracy?: number | null
          forecast_demand?: number | null
          forecast_period: string
          id?: string
          model_version?: string | null
          package_id?: string | null
          prediction_model?: string | null
          season_factor?: number | null
          trend_factor?: number | null
        }
        Update: {
          actual_demand?: number | null
          confidence_score?: number | null
          created_at?: string | null
          destination?: string | null
          event_factor?: number | null
          external_factors?: Json | null
          forecast_accuracy?: number | null
          forecast_demand?: number | null
          forecast_period?: string
          id?: string
          model_version?: string | null
          package_id?: string | null
          prediction_model?: string | null
          season_factor?: number | null
          trend_factor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "demand_forecast_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_forecast_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      departing_locations: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: []
      }
      destination_climate: {
        Row: {
          country: string | null
          destination: string
          fetched_at: string | null
          fitness_scores: Json | null
          lat: number
          lon: number
          manual_override: boolean | null
          monthly_normals: Json | null
          primary_city: string
          seasonal_signals: Json | null
          timezone: string
          utc_offset_minutes: number
        }
        Insert: {
          country?: string | null
          destination: string
          fetched_at?: string | null
          fitness_scores?: Json | null
          lat: number
          lon: number
          manual_override?: boolean | null
          monthly_normals?: Json | null
          primary_city: string
          seasonal_signals?: Json | null
          timezone: string
          utc_offset_minutes: number
        }
        Update: {
          country?: string | null
          destination?: string
          fetched_at?: string | null
          fitness_scores?: Json | null
          lat?: number
          lon?: number
          manual_override?: boolean | null
          monthly_normals?: Json | null
          primary_city?: string
          seasonal_signals?: Json | null
          timezone?: string
          utc_offset_minutes?: number
        }
        Relationships: []
      }
      destination_masters: {
        Row: {
          arrival_time: string | null
          common_notices: Json | null
          country: string
          created_at: string | null
          default_airline: string | null
          default_departure_airport: string | null
          default_flight_in: string | null
          default_flight_out: string | null
          flight_in_time: string | null
          flight_out_time: string | null
          hotel_pool: Json | null
          id: string
          is_active: boolean | null
          keywords: string[] | null
          meal_pool: Json | null
          name: string
          region_code: string | null
          return_departure_time: string | null
          updated_at: string | null
        }
        Insert: {
          arrival_time?: string | null
          common_notices?: Json | null
          country: string
          created_at?: string | null
          default_airline?: string | null
          default_departure_airport?: string | null
          default_flight_in?: string | null
          default_flight_out?: string | null
          flight_in_time?: string | null
          flight_out_time?: string | null
          hotel_pool?: Json | null
          id?: string
          is_active?: boolean | null
          keywords?: string[] | null
          meal_pool?: Json | null
          name: string
          region_code?: string | null
          return_departure_time?: string | null
          updated_at?: string | null
        }
        Update: {
          arrival_time?: string | null
          common_notices?: Json | null
          country?: string
          created_at?: string | null
          default_airline?: string | null
          default_departure_airport?: string | null
          default_flight_in?: string | null
          default_flight_out?: string | null
          flight_in_time?: string | null
          flight_out_time?: string | null
          hotel_pool?: Json | null
          id?: string
          is_active?: boolean | null
          keywords?: string[] | null
          meal_pool?: Json | null
          name?: string
          region_code?: string | null
          return_departure_time?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      document_hashes: {
        Row: {
          created_at: string | null
          file_hash: string
          file_name: string
          normalized_hash: string | null
          product_id: string | null
        }
        Insert: {
          created_at?: string | null
          file_hash: string
          file_name: string
          normalized_hash?: string | null
          product_id?: string | null
        }
        Update: {
          created_at?: string | null
          file_hash?: string
          file_name?: string
          normalized_hash?: string | null
          product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_hashes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["internal_code"]
          },
        ]
      }
      upload_review_queue: {
        Row: {
          created_at: string
          error_reason: string | null
          file_hash: string | null
          id: string
          land_operator_id: string | null
          normalized_content_hash: string | null
          parsed_draft_json: Json | null
          product_title: string | null
          raw_text_chunk: string | null
          severity: string
          source_filename: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_reason?: string | null
          file_hash?: string | null
          id?: string
          land_operator_id?: string | null
          normalized_content_hash?: string | null
          parsed_draft_json?: Json | null
          product_title?: string | null
          raw_text_chunk?: string | null
          severity?: string
          source_filename?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_reason?: string | null
          file_hash?: string | null
          id?: string
          land_operator_id?: string | null
          normalized_content_hash?: string | null
          parsed_draft_json?: Json | null
          product_title?: string | null
          raw_text_chunk?: string | null
          severity?: string
          source_filename?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_review_queue_land_operator_id_fkey"
            columns: ["land_operator_id"]
            isOneToOne: false
            referencedRelation: "land_operators"
            referencedColumns: ["id"]
          },
        ]
      }
      during_trip_feedback: {
        Row: {
          additional_requests: string[] | null
          booking_id: string | null
          check_in_date: string | null
          check_in_method: string | null
          created_at: string | null
          current_location: string | null
          current_satisfaction: number | null
          customer_id: string | null
          feedback_channel: string | null
          food_rating: number | null
          guide_rating: number | null
          hotel_rating: number | null
          id: string
          issue_resolved: boolean | null
          issue_severity: string | null
          issues_reported: string[] | null
          resolution_time_minutes: number | null
          transport_rating: number | null
          upgrade_interest: boolean | null
        }
        Insert: {
          additional_requests?: string[] | null
          booking_id?: string | null
          check_in_date?: string | null
          check_in_method?: string | null
          created_at?: string | null
          current_location?: string | null
          current_satisfaction?: number | null
          customer_id?: string | null
          feedback_channel?: string | null
          food_rating?: number | null
          guide_rating?: number | null
          hotel_rating?: number | null
          id?: string
          issue_resolved?: boolean | null
          issue_severity?: string | null
          issues_reported?: string[] | null
          resolution_time_minutes?: number | null
          transport_rating?: number | null
          upgrade_interest?: boolean | null
        }
        Update: {
          additional_requests?: string[] | null
          booking_id?: string | null
          check_in_date?: string | null
          check_in_method?: string | null
          created_at?: string | null
          current_location?: string | null
          current_satisfaction?: number | null
          customer_id?: string | null
          feedback_channel?: string | null
          food_rating?: number | null
          guide_rating?: number | null
          hotel_rating?: number | null
          id?: string
          issue_resolved?: boolean | null
          issue_severity?: string | null
          issues_reported?: string[] | null
          resolution_time_minutes?: number | null
          transport_rating?: number | null
          upgrade_interest?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "during_trip_feedback_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "during_trip_feedback_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "during_trip_feedback_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "during_trip_feedback_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "during_trip_feedback_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "during_trip_feedback_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          bounced_count: number | null
          campaign_id: string | null
          click_rate: number | null
          clicked_count: number | null
          created_at: string | null
          delivered_count: number | null
          html_content: string | null
          id: string
          open_rate: number | null
          opened_count: number | null
          preview_text: string | null
          reply_to_email: string | null
          sender_email: string | null
          sender_name: string | null
          sent_at: string | null
          sent_count: number | null
          subject: string
          text_content: string | null
          unsubscribed_count: number | null
        }
        Insert: {
          bounced_count?: number | null
          campaign_id?: string | null
          click_rate?: number | null
          clicked_count?: number | null
          created_at?: string | null
          delivered_count?: number | null
          html_content?: string | null
          id?: string
          open_rate?: number | null
          opened_count?: number | null
          preview_text?: string | null
          reply_to_email?: string | null
          sender_email?: string | null
          sender_name?: string | null
          sent_at?: string | null
          sent_count?: number | null
          subject: string
          text_content?: string | null
          unsubscribed_count?: number | null
        }
        Update: {
          bounced_count?: number | null
          campaign_id?: string | null
          click_rate?: number | null
          clicked_count?: number | null
          created_at?: string | null
          delivered_count?: number | null
          html_content?: string | null
          id?: string
          open_rate?: number | null
          opened_count?: number | null
          preview_text?: string | null
          reply_to_email?: string | null
          sender_email?: string | null
          sender_name?: string | null
          sent_at?: string | null
          sent_count?: number | null
          subject?: string
          text_content?: string | null
          unsubscribed_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_roi_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaigns_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      error_patterns: {
        Row: {
          bad_example: Json | null
          category: string
          created_at: string | null
          created_by: string | null
          description: string | null
          embedding: string | null
          error_code: string
          first_seen: string | null
          good_fix: Json | null
          id: string
          last_seen: string | null
          occurrence_count: number | null
          promoted_to_whitelist: boolean | null
          related_package_id: string | null
          resolution_type: string | null
          severity: string | null
          source: string | null
          status: string | null
          tenant_id: string | null
          title: string
          trigger_keywords: string[] | null
          updated_at: string | null
        }
        Insert: {
          bad_example?: Json | null
          category: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          embedding?: string | null
          error_code: string
          first_seen?: string | null
          good_fix?: Json | null
          id?: string
          last_seen?: string | null
          occurrence_count?: number | null
          promoted_to_whitelist?: boolean | null
          related_package_id?: string | null
          resolution_type?: string | null
          severity?: string | null
          source?: string | null
          status?: string | null
          tenant_id?: string | null
          title: string
          trigger_keywords?: string[] | null
          updated_at?: string | null
        }
        Update: {
          bad_example?: Json | null
          category?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          embedding?: string | null
          error_code?: string
          first_seen?: string | null
          good_fix?: Json | null
          id?: string
          last_seen?: string | null
          occurrence_count?: number | null
          promoted_to_whitelist?: boolean | null
          related_package_id?: string | null
          resolution_type?: string | null
          severity?: string | null
          source?: string | null
          status?: string | null
          tenant_id?: string | null
          title?: string
          trigger_keywords?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_patterns_related_package_id_fkey"
            columns: ["related_package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_patterns_related_package_id_fkey"
            columns: ["related_package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      exclusion_rules: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          match_keywords: string[]
          rule_name: string
          severity: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          match_keywords: string[]
          rule_name: string
          severity?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          match_keywords?: string[]
          rule_name?: string
          severity?: string | null
        }
        Relationships: []
      }
      external_bookings: {
        Row: {
          booking_data: Json | null
          created_at: string
          external_id: string | null
          id: string
          parsed_package_id: string | null
          status: string | null
        }
        Insert: {
          booking_data?: Json | null
          created_at?: string
          external_id?: string | null
          id?: string
          parsed_package_id?: string | null
          status?: string | null
        }
        Update: {
          booking_data?: Json | null
          created_at?: string
          external_id?: string | null
          id?: string
          parsed_package_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_bookings_parsed_package_id_fkey"
            columns: ["parsed_package_id"]
            isOneToOne: false
            referencedRelation: "parsed_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      extractions_corrections: {
        Row: {
          after_value: Json | null
          applied_count: number
          before_value: Json | null
          category: string | null
          created_at: string
          created_by: string | null
          destination: string | null
          field_path: string
          id: string
          is_active: boolean
          land_operator_id: string | null
          last_applied_at: string | null
          package_id: string | null
          raw_text_excerpt: string | null
          reflection: string | null
          severity: string | null
        }
        Insert: {
          after_value?: Json | null
          applied_count?: number
          before_value?: Json | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          field_path: string
          id?: string
          is_active?: boolean
          land_operator_id?: string | null
          last_applied_at?: string | null
          package_id?: string | null
          raw_text_excerpt?: string | null
          reflection?: string | null
          severity?: string | null
        }
        Update: {
          after_value?: Json | null
          applied_count?: number
          before_value?: Json | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          field_path?: string
          id?: string
          is_active?: boolean
          land_operator_id?: string | null
          last_applied_at?: string | null
          package_id?: string | null
          raw_text_excerpt?: string | null
          reflection?: string | null
          severity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "extractions_corrections_land_operator_id_fkey"
            columns: ["land_operator_id"]
            isOneToOne: false
            referencedRelation: "land_operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extractions_corrections_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extractions_corrections_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_snapshots: {
        Row: {
          changed_axes: string[] | null
          climate_score: number | null
          confirmation_rate: number | null
          created_at: string | null
          destination: string | null
          duration_days: number | null
          flight_time: string | null
          free_option_count: number | null
          free_time_ratio: number | null
          hotel_avg_grade: number | null
          hotel_location: string | null
          id: number
          is_direct_flight: boolean | null
          korean_meal_count: number | null
          meal_count: number | null
          package_id: string
          popularity_score: number | null
          prev_snapshot_id: number | null
          reliability_score: number | null
          shopping_count: number | null
          snapshot_date: string
          special_meal_count: number | null
        }
        Insert: {
          changed_axes?: string[] | null
          climate_score?: number | null
          confirmation_rate?: number | null
          created_at?: string | null
          destination?: string | null
          duration_days?: number | null
          flight_time?: string | null
          free_option_count?: number | null
          free_time_ratio?: number | null
          hotel_avg_grade?: number | null
          hotel_location?: string | null
          id?: number
          is_direct_flight?: boolean | null
          korean_meal_count?: number | null
          meal_count?: number | null
          package_id: string
          popularity_score?: number | null
          prev_snapshot_id?: number | null
          reliability_score?: number | null
          shopping_count?: number | null
          snapshot_date: string
          special_meal_count?: number | null
        }
        Update: {
          changed_axes?: string[] | null
          climate_score?: number | null
          confirmation_rate?: number | null
          created_at?: string | null
          destination?: string | null
          duration_days?: number | null
          flight_time?: string | null
          free_option_count?: number | null
          free_time_ratio?: number | null
          hotel_avg_grade?: number | null
          hotel_location?: string | null
          id?: number
          is_direct_flight?: boolean | null
          korean_meal_count?: number | null
          meal_count?: number | null
          package_id?: string
          popularity_score?: number | null
          prev_snapshot_id?: number | null
          reliability_score?: number | null
          shopping_count?: number | null
          snapshot_date?: string
          special_meal_count?: number | null
        }
        Relationships: []
      }
      free_travel_booking_items: {
        Row: {
          affiliate_link: string | null
          booking_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          date_from: string | null
          date_to: string | null
          id: string
          name: string
          our_commission: number | null
          price: number
          provider: string
          provider_booking_id: string | null
          status: string
          type: string
        }
        Insert: {
          affiliate_link?: string | null
          booking_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          id?: string
          name: string
          our_commission?: number | null
          price?: number
          provider: string
          provider_booking_id?: string | null
          status?: string
          type: string
        }
        Update: {
          affiliate_link?: string | null
          booking_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          id?: string
          name?: string
          our_commission?: number | null
          price?: number
          provider?: string
          provider_booking_id?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "free_travel_booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "free_travel_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      free_travel_bookings: {
        Row: {
          created_at: string
          customer_phone: string
          id: string
          our_commission: number | null
          session_id: string | null
          status: string
          total_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_phone: string
          id?: string
          our_commission?: number | null
          session_id?: string | null
          status?: string
          total_price?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_phone?: string
          id?: string
          our_commission?: number | null
          session_id?: string | null
          status?: string
          total_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "free_travel_bookings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "free_travel_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      free_travel_commissions: {
        Row: {
          affiliate_link: string | null
          click_count: number
          clicked_at: string | null
          commission_rate: number
          confirmed_krw: number | null
          created_at: string
          estimated_krw: number | null
          id: string
          ota: string
          ota_report_ref: string | null
          paid_at: string | null
          reported_at: string | null
          session_id: string | null
          status: string
        }
        Insert: {
          affiliate_link?: string | null
          click_count?: number
          clicked_at?: string | null
          commission_rate?: number
          confirmed_krw?: number | null
          created_at?: string
          estimated_krw?: number | null
          id?: string
          ota?: string
          ota_report_ref?: string | null
          paid_at?: string | null
          reported_at?: string | null
          session_id?: string | null
          status?: string
        }
        Update: {
          affiliate_link?: string | null
          click_count?: number
          clicked_at?: string | null
          commission_rate?: number
          confirmed_krw?: number | null
          created_at?: string
          estimated_krw?: number | null
          id?: string
          ota?: string
          ota_report_ref?: string | null
          paid_at?: string | null
          reported_at?: string | null
          session_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "free_travel_commissions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "free_travel_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      free_travel_sessions: {
        Row: {
          admin_notes: string | null
          booked_at: string | null
          booked_by: string | null
          converted_to_package_id: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          date_from: string
          date_to: string
          departure: string
          destination: string
          id: string
          mrt_booking_ref: string | null
          pax_adults: number
          pax_children: number
          plan_expires_at: string | null
          plan_json: Json | null
          source: string
          status: string
        }
        Insert: {
          admin_notes?: string | null
          booked_at?: string | null
          booked_by?: string | null
          converted_to_package_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          date_from: string
          date_to: string
          departure?: string
          destination: string
          id?: string
          mrt_booking_ref?: string | null
          pax_adults?: number
          pax_children?: number
          plan_expires_at?: string | null
          plan_json?: Json | null
          source?: string
          status?: string
        }
        Update: {
          admin_notes?: string | null
          booked_at?: string | null
          booked_by?: string | null
          converted_to_package_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          date_from?: string
          date_to?: string
          departure?: string
          destination?: string
          id?: string
          mrt_booking_ref?: string | null
          pax_adults?: number
          pax_children?: number
          plan_expires_at?: string | null
          plan_json?: Json | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      group_rfqs: {
        Row: {
          adult_count: number
          ai_interview_log: Json | null
          bid_deadline: string | null
          bronze_unlock_at: string | null
          budget_per_person: number | null
          child_count: number
          created_at: string
          custom_requirements: Json | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          departure_date_from: string | null
          departure_date_to: string | null
          destination: string
          duration_nights: number | null
          gold_unlock_at: string | null
          hotel_grade: string | null
          id: string
          max_proposals: number
          meal_plan: string | null
          published_at: string | null
          rfq_code: string
          selected_proposal_id: string | null
          silver_unlock_at: string | null
          special_requests: string | null
          status: string
          total_budget: number | null
          transportation: string | null
          updated_at: string
        }
        Insert: {
          adult_count?: number
          ai_interview_log?: Json | null
          bid_deadline?: string | null
          bronze_unlock_at?: string | null
          budget_per_person?: number | null
          child_count?: number
          created_at?: string
          custom_requirements?: Json | null
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          departure_date_from?: string | null
          departure_date_to?: string | null
          destination: string
          duration_nights?: number | null
          gold_unlock_at?: string | null
          hotel_grade?: string | null
          id?: string
          max_proposals?: number
          meal_plan?: string | null
          published_at?: string | null
          rfq_code: string
          selected_proposal_id?: string | null
          silver_unlock_at?: string | null
          special_requests?: string | null
          status?: string
          total_budget?: number | null
          transportation?: string | null
          updated_at?: string
        }
        Update: {
          adult_count?: number
          ai_interview_log?: Json | null
          bid_deadline?: string | null
          bronze_unlock_at?: string | null
          budget_per_person?: number | null
          child_count?: number
          created_at?: string
          custom_requirements?: Json | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          departure_date_from?: string | null
          departure_date_to?: string | null
          destination?: string
          duration_nights?: number | null
          gold_unlock_at?: string | null
          hotel_grade?: string | null
          id?: string
          max_proposals?: number
          meal_plan?: string | null
          published_at?: string | null
          rfq_code?: string
          selected_proposal_id?: string | null
          silver_unlock_at?: string | null
          special_requests?: string | null
          status?: string
          total_budget?: number | null
          transportation?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_rfqs_selected_proposal"
            columns: ["selected_proposal_id"]
            isOneToOne: false
            referencedRelation: "rfq_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_rfqs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_rfqs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_rfqs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      guidebook_events: {
        Row: {
          action: string
          created_at: string
          guide_ref: string
          id: string
          meta: Json
        }
        Insert: {
          action: string
          created_at?: string
          guide_ref: string
          id?: string
          meta?: Json
        }
        Update: {
          action?: string
          created_at?: string
          guide_ref?: string
          id?: string
          meta?: Json
        }
        Relationships: []
      }
      hotel_brands: {
        Row: {
          applicable_stars: number[]
          brand_family: string
          id: string
          name_patterns: string[]
          notes: string | null
          updated_at: string | null
          within_star_score: number
        }
        Insert: {
          applicable_stars: number[]
          brand_family: string
          id?: string
          name_patterns: string[]
          notes?: string | null
          updated_at?: string | null
          within_star_score: number
        }
        Update: {
          applicable_stars?: number[]
          brand_family?: string
          id?: string
          name_patterns?: string[]
          notes?: string | null
          updated_at?: string | null
          within_star_score?: number
        }
        Relationships: []
      }
      indexing_reports: {
        Row: {
          content_creative_id: string | null
          duration_ms: number | null
          google_error: string | null
          google_status: string
          id: string
          indexnow_error: string | null
          indexnow_status: string
          reported_at: string
          sitemap_pings: Json | null
          url: string
        }
        Insert: {
          content_creative_id?: string | null
          duration_ms?: number | null
          google_error?: string | null
          google_status: string
          id?: string
          indexnow_error?: string | null
          indexnow_status: string
          reported_at?: string
          sitemap_pings?: Json | null
          url: string
        }
        Update: {
          content_creative_id?: string | null
          duration_ms?: number | null
          google_error?: string | null
          google_status?: string
          id?: string
          indexnow_error?: string | null
          indexnow_status?: string
          reported_at?: string
          sitemap_pings?: Json | null
          url?: string
        }
        Relationships: []
      }
      instagram_accounts: {
        Row: {
          access_token: string
          created_at: string
          daily_quota_used: number
          display_name: string | null
          id: string
          ig_user_id: string
          is_active: boolean
          last_published_at: string | null
          quota_reset_at: string | null
          tenant_id: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          daily_quota_used?: number
          display_name?: string | null
          id?: string
          ig_user_id: string
          is_active?: boolean
          last_published_at?: string | null
          quota_reset_at?: string | null
          tenant_id: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          daily_quota_used?: number
          display_name?: string | null
          id?: string
          ig_user_id?: string
          is_active?: boolean
          last_published_at?: string | null
          quota_reset_at?: string | null
          tenant_id?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      intents: {
        Row: {
          booking_stage: string | null
          budget_range: unknown
          conversation_id: string | null
          destination: string | null
          extracted_at: string | null
          id: string
          party_size: number | null
          priorities: string[] | null
          travel_dates: unknown
        }
        Insert: {
          booking_stage?: string | null
          budget_range?: unknown
          conversation_id?: string | null
          destination?: string | null
          extracted_at?: string | null
          id?: string
          party_size?: number | null
          priorities?: string[] | null
          travel_dates?: unknown
        }
        Update: {
          booking_stage?: string | null
          budget_range?: unknown
          conversation_id?: string | null
          destination?: string | null
          extracted_at?: string | null
          id?: string
          party_size?: number | null
          priorities?: string[] | null
          travel_dates?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "intents_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_alerts: {
        Row: {
          acknowledged: boolean | null
          acknowledged_at: string | null
          action_taken: string | null
          alert_level: string
          alert_type: string
          created_at: string | null
          current_available: number | null
          days_until_departure: number | null
          id: string
          message: string | null
          package_id: string | null
          resolved: boolean | null
          resolved_at: string | null
          threshold: number | null
        }
        Insert: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          action_taken?: string | null
          alert_level: string
          alert_type: string
          created_at?: string | null
          current_available?: number | null
          days_until_departure?: number | null
          id?: string
          message?: string | null
          package_id?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          threshold?: number | null
        }
        Update: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          action_taken?: string | null
          alert_level?: string
          alert_type?: string
          created_at?: string | null
          current_available?: number | null
          days_until_departure?: number | null
          id?: string
          message?: string | null
          package_id?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_alerts_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_alerts_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_blocks: {
        Row: {
          available_seats: number | null
          booked_seats: number
          created_at: string | null
          date: string
          id: string
          price_override: number | null
          product_id: string
          status: string | null
          tenant_id: string
          total_seats: number
          updated_at: string | null
        }
        Insert: {
          available_seats?: number | null
          booked_seats?: number
          created_at?: string | null
          date: string
          id?: string
          price_override?: number | null
          product_id: string
          status?: string | null
          tenant_id: string
          total_seats?: number
          updated_at?: string | null
        }
        Update: {
          available_seats?: number | null
          booked_seats?: number
          created_at?: string | null
          date?: string
          id?: string
          price_override?: number | null
          product_id?: string
          status?: string | null
          tenant_id?: string
          total_seats?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_blocks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_blocks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_blocks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jarvis_cost_ledger: {
        Row: {
          agent_type: string | null
          cache_read_tokens: number
          cache_write_tokens: number
          cost_usd: number
          created_at: string | null
          id: string
          input_tokens: number
          latency_ms: number | null
          model: string
          output_tokens: number
          session_id: string | null
          tenant_id: string | null
          thinking_tokens: number | null
        }
        Insert: {
          agent_type?: string | null
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          created_at?: string | null
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model: string
          output_tokens?: number
          session_id?: string | null
          tenant_id?: string | null
          thinking_tokens?: number | null
        }
        Update: {
          agent_type?: string | null
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          created_at?: string | null
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model?: string
          output_tokens?: number
          session_id?: string | null
          tenant_id?: string | null
          thinking_tokens?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jarvis_cost_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jarvis_knowledge_chunks: {
        Row: {
          bm25_tokens: unknown
          chunk_index: number
          chunk_text: string
          content_hash: string | null
          contextual_text: string
          created_at: string | null
          embedding: string | null
          id: string
          metadata: Json
          source_id: string | null
          source_title: string | null
          source_type: string
          source_url: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          bm25_tokens?: unknown
          chunk_index: number
          chunk_text: string
          content_hash?: string | null
          contextual_text: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json
          source_id?: string | null
          source_title?: string | null
          source_type: string
          source_url?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          bm25_tokens?: unknown
          chunk_index?: number
          chunk_text?: string
          content_hash?: string | null
          contextual_text?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json
          source_id?: string | null
          source_title?: string | null
          source_type?: string
          source_url?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jarvis_knowledge_chunks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jarvis_pending_actions: {
        Row: {
          agent_type: string
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          description: string
          id: string
          risk_level: string | null
          session_id: string | null
          status: string | null
          tenant_id: string | null
          tool_args: Json
          tool_name: string
        }
        Insert: {
          agent_type: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          description: string
          id?: string
          risk_level?: string | null
          session_id?: string | null
          status?: string | null
          tenant_id?: string | null
          tool_args: Json
          tool_name: string
        }
        Update: {
          agent_type?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          description?: string
          id?: string
          risk_level?: string | null
          session_id?: string | null
          status?: string | null
          tenant_id?: string | null
          tool_args?: Json
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "jarvis_pending_actions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "jarvis_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jarvis_pending_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jarvis_sessions: {
        Row: {
          context: Json | null
          created_at: string | null
          id: string
          messages: Json | null
          tenant_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string | null
          id?: string
          messages?: Json | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string | null
          id?: string
          messages?: Json | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jarvis_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jarvis_tool_logs: {
        Row: {
          agent_type: string
          duration_ms: number | null
          executed_at: string | null
          id: string
          is_hitl: boolean | null
          pending_action_id: string | null
          result: Json | null
          session_id: string | null
          tenant_id: string | null
          tool_args: Json | null
          tool_name: string
        }
        Insert: {
          agent_type: string
          duration_ms?: number | null
          executed_at?: string | null
          id?: string
          is_hitl?: boolean | null
          pending_action_id?: string | null
          result?: Json | null
          session_id?: string | null
          tenant_id?: string | null
          tool_args?: Json | null
          tool_name: string
        }
        Update: {
          agent_type?: string
          duration_ms?: number | null
          executed_at?: string | null
          id?: string
          is_hitl?: boolean | null
          pending_action_id?: string | null
          result?: Json | null
          session_id?: string | null
          tenant_id?: string | null
          tool_args?: Json | null
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "jarvis_tool_logs_pending_action_id_fkey"
            columns: ["pending_action_id"]
            isOneToOne: false
            referencedRelation: "jarvis_pending_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jarvis_tool_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "jarvis_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jarvis_tool_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kakao_inbound: {
        Row: {
          attachments: Json | null
          customer_id: string | null
          id: string
          is_processed: boolean | null
          jarvis_session_id: string | null
          kakao_user_id: string
          message: string
          message_type: string | null
          received_at: string | null
        }
        Insert: {
          attachments?: Json | null
          customer_id?: string | null
          id?: string
          is_processed?: boolean | null
          jarvis_session_id?: string | null
          kakao_user_id: string
          message: string
          message_type?: string | null
          received_at?: string | null
        }
        Update: {
          attachments?: Json | null
          customer_id?: string | null
          id?: string
          is_processed?: boolean | null
          jarvis_session_id?: string | null
          kakao_user_id?: string
          message?: string
          message_type?: string | null
          received_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kakao_inbound_jarvis_session_id_fkey"
            columns: ["jarvis_session_id"]
            isOneToOne: false
            referencedRelation: "jarvis_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      keyword_performances: {
        Row: {
          ad_account_id: string | null
          clicks: number
          conversions: number
          current_bid: number | null
          discovered_at: string | null
          id: string
          impressions: number
          is_longtail: boolean
          keyword: string
          net_profit: number | null
          period_end: string | null
          period_start: string | null
          platform: string
          roas_pct: number | null
          status: string
          total_cost: number
          total_revenue: number
          total_spend: number
          updated_at: string
        }
        Insert: {
          ad_account_id?: string | null
          clicks?: number
          conversions?: number
          current_bid?: number | null
          discovered_at?: string | null
          id?: string
          impressions?: number
          is_longtail?: boolean
          keyword: string
          net_profit?: number | null
          period_end?: string | null
          period_start?: string | null
          platform: string
          roas_pct?: number | null
          status?: string
          total_cost?: number
          total_revenue?: number
          total_spend?: number
          updated_at?: string
        }
        Update: {
          ad_account_id?: string | null
          clicks?: number
          conversions?: number
          current_bid?: number | null
          discovered_at?: string | null
          id?: string
          impressions?: number
          is_longtail?: boolean
          keyword?: string
          net_profit?: number | null
          period_end?: string | null
          period_start?: string | null
          platform?: string
          roas_pct?: number | null
          status?: string
          total_cost?: number
          total_revenue?: number
          total_spend?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "keyword_performances_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      keyword_research_cache: {
        Row: {
          competition_level: string | null
          fetched_at: string
          keyword: string
          monthly_search_volume: number | null
          raw: Json | null
          related_queries: string[] | null
          source: string
        }
        Insert: {
          competition_level?: string | null
          fetched_at?: string
          keyword: string
          monthly_search_volume?: number | null
          raw?: Json | null
          related_queries?: string[] | null
          source: string
        }
        Update: {
          competition_level?: string | null
          fetched_at?: string
          keyword?: string
          monthly_search_volume?: number | null
          raw?: Json | null
          related_queries?: string[] | null
          source?: string
        }
        Relationships: []
      }
      ktkg_triples: {
        Row: {
          aspect: string | null
          bronze_event_id: string
          confidence: number | null
          created_at: string
          demographic: string | null
          entity_name: string
          entity_norm: string | null
          entity_type: string
          id: string
          phase: string | null
          raw_quote_hash: string | null
          sentiment_label: string | null
          sentiment_score: number | null
          snippet: string | null
          source_message_idx: number | null
          tenant_id: string | null
        }
        Insert: {
          aspect?: string | null
          bronze_event_id: string
          confidence?: number | null
          created_at?: string
          demographic?: string | null
          entity_name: string
          entity_norm?: string | null
          entity_type: string
          id?: string
          phase?: string | null
          raw_quote_hash?: string | null
          sentiment_label?: string | null
          sentiment_score?: number | null
          snippet?: string | null
          source_message_idx?: number | null
          tenant_id?: string | null
        }
        Update: {
          aspect?: string | null
          bronze_event_id?: string
          confidence?: number | null
          created_at?: string
          demographic?: string | null
          entity_name?: string
          entity_norm?: string | null
          entity_type?: string
          id?: string
          phase?: string | null
          raw_quote_hash?: string | null
          sentiment_label?: string | null
          sentiment_score?: number | null
          snippet?: string | null
          source_message_idx?: number | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ktkg_triples_bronze_event_id_fkey"
            columns: ["bronze_event_id"]
            isOneToOne: false
            referencedRelation: "bronze_chat_events"
            referencedColumns: ["id"]
          },
        ]
      }
      land_operators: {
        Row: {
          aliases: string[] | null
          cancelled_count: number | null
          contact: string | null
          created_at: string
          dispute_count: number | null
          id: string
          is_active: boolean | null
          memo: string | null
          name: string
          refund_total: number | null
          regions: string[] | null
          reliability_computed_at: string | null
          reliability_score: number | null
          total_bookings: number | null
          updated_at: string
        }
        Insert: {
          aliases?: string[] | null
          cancelled_count?: number | null
          contact?: string | null
          created_at?: string
          dispute_count?: number | null
          id?: string
          is_active?: boolean | null
          memo?: string | null
          name: string
          refund_total?: number | null
          regions?: string[] | null
          reliability_computed_at?: string | null
          reliability_score?: number | null
          total_bookings?: number | null
          updated_at?: string
        }
        Update: {
          aliases?: string[] | null
          cancelled_count?: number | null
          contact?: string | null
          created_at?: string
          dispute_count?: number | null
          id?: string
          is_active?: boolean | null
          memo?: string | null
          name?: string
          refund_total?: number | null
          regions?: string[] | null
          reliability_computed_at?: string | null
          reliability_score?: number | null
          total_bookings?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      land_settlement_bookings: {
        Row: {
          amount: number
          booking_id: string
          settlement_id: string
        }
        Insert: {
          amount: number
          booking_id: string
          settlement_id: string
        }
        Update: {
          amount?: number
          booking_id?: string
          settlement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "land_settlement_bookings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "land_settlement_bookings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "land_settlement_bookings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "land_settlement_bookings_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "land_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      land_settlements: {
        Row: {
          bank_transaction_id: string
          bundled_total: number
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          fee_amount: number
          id: string
          is_refund: boolean
          land_operator_id: string
          notes: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          status: string
          tenant_id: string | null
          total_amount: number
        }
        Insert: {
          bank_transaction_id: string
          bundled_total: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          fee_amount?: number
          id?: string
          is_refund?: boolean
          land_operator_id: string
          notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
          tenant_id?: string | null
          total_amount: number
        }
        Update: {
          bank_transaction_id?: string
          bundled_total?: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          fee_amount?: number
          id?: string
          is_refund?: boolean
          land_operator_id?: string
          notes?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
          tenant_id?: string | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "land_settlements_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "land_settlements_land_operator_id_fkey"
            columns: ["land_operator_id"]
            isOneToOne: false
            referencedRelation: "land_operators"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          account: string
          amount: number
          booking_id: string
          created_at: string
          created_by: string | null
          currency: string
          entry_type: string
          id: string
          idempotency_key: string | null
          memo: string | null
          source: string
          source_ref_id: string | null
        }
        Insert: {
          account: string
          amount: number
          booking_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          entry_type: string
          id?: string
          idempotency_key?: string | null
          memo?: string | null
          source: string
          source_ref_id?: string | null
        }
        Update: {
          account?: string
          amount?: number
          booking_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          entry_type?: string
          id?: string
          idempotency_key?: string | null
          memo?: string | null
          source?: string
          source_ref_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
        ]
      }
      margin_settings: {
        Row: {
          base_price: number
          bulk_margin_percent: number | null
          created_at: string | null
          id: string
          package_id: string | null
          regular_margin_percent: number | null
          updated_at: string | null
          vip_margin_percent: number | null
        }
        Insert: {
          base_price: number
          bulk_margin_percent?: number | null
          created_at?: string | null
          id?: string
          package_id?: string | null
          regular_margin_percent?: number | null
          updated_at?: string | null
          vip_margin_percent?: number | null
        }
        Update: {
          base_price?: number
          bulk_margin_percent?: number | null
          created_at?: string | null
          id?: string
          package_id?: string | null
          regular_margin_percent?: number | null
          updated_at?: string | null
          vip_margin_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "margin_settings_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "margin_settings_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaigns: {
        Row: {
          budget: number | null
          channel: string | null
          channels: string[] | null
          clicks: number | null
          conversions: number | null
          cpa: number | null
          cpc: number | null
          created_at: string | null
          creative_assets: Json | null
          creative_variants: Json | null
          ctr: number | null
          description: string | null
          end_date: string | null
          estimated_audience_size: number | null
          goal: string | null
          id: string
          impressions: number | null
          name: string
          remaining: number | null
          revenue: number | null
          roas: number | null
          spent: number | null
          start_date: string | null
          status: string | null
          target_conversions: number | null
          target_criteria: Json | null
          target_customer_ids: string[] | null
          target_destinations: string[] | null
          target_revenue: number | null
          target_segments: string[] | null
          type: string | null
          updated_at: string | null
          winning_variant: string | null
        }
        Insert: {
          budget?: number | null
          channel?: string | null
          channels?: string[] | null
          clicks?: number | null
          conversions?: number | null
          cpa?: number | null
          cpc?: number | null
          created_at?: string | null
          creative_assets?: Json | null
          creative_variants?: Json | null
          ctr?: number | null
          description?: string | null
          end_date?: string | null
          estimated_audience_size?: number | null
          goal?: string | null
          id?: string
          impressions?: number | null
          name: string
          remaining?: number | null
          revenue?: number | null
          roas?: number | null
          spent?: number | null
          start_date?: string | null
          status?: string | null
          target_conversions?: number | null
          target_criteria?: Json | null
          target_customer_ids?: string[] | null
          target_destinations?: string[] | null
          target_revenue?: number | null
          target_segments?: string[] | null
          type?: string | null
          updated_at?: string | null
          winning_variant?: string | null
        }
        Update: {
          budget?: number | null
          channel?: string | null
          channels?: string[] | null
          clicks?: number | null
          conversions?: number | null
          cpa?: number | null
          cpc?: number | null
          created_at?: string | null
          creative_assets?: Json | null
          creative_variants?: Json | null
          ctr?: number | null
          description?: string | null
          end_date?: string | null
          estimated_audience_size?: number | null
          goal?: string | null
          id?: string
          impressions?: number | null
          name?: string
          remaining?: number | null
          revenue?: number | null
          roas?: number | null
          spent?: number | null
          start_date?: string | null
          status?: string | null
          target_conversions?: number | null
          target_criteria?: Json | null
          target_customer_ids?: string[] | null
          target_destinations?: string[] | null
          target_revenue?: number | null
          target_segments?: string[] | null
          type?: string | null
          updated_at?: string | null
          winning_variant?: string | null
        }
        Relationships: []
      }
      marketing_logs: {
        Row: {
          created_at: string | null
          id: string
          platform: string
          product_id: string | null
          url: string
          va_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          platform: string
          product_id?: string | null
          url: string
          va_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          platform?: string
          product_id?: string | null
          url?: string
          va_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_logs: {
        Row: {
          booking_id: string | null
          content: string | null
          created_at: string | null
          id: string
          payload: Json | null
          status: string | null
          tenant_id: string | null
        }
        Insert: {
          booking_id?: string | null
          content?: string | null
          created_at?: string | null
          id?: string
          payload?: Json | null
          status?: string | null
          tenant_id?: string | null
        }
        Update: {
          booking_id?: string | null
          content?: string | null
          created_at?: string | null
          id?: string
          payload?: Json | null
          status?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      mileage_history: {
        Row: {
          amount: number
          booking_id: string | null
          created_at: string | null
          customer_id: string | null
          id: string
          reason: string | null
        }
        Insert: {
          amount: number
          booking_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          reason?: string | null
        }
        Update: {
          amount?: number
          booking_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mileage_history_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_history_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_history_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_history_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_history_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_history_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      mileage_transactions: {
        Row: {
          amount: number
          base_net_profit: number | null
          booking_id: string | null
          created_at: string
          id: string
          margin_impact: number | null
          memo: string | null
          mileage_rate: number | null
          ref_transaction_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          base_net_profit?: number | null
          booking_id?: string | null
          created_at?: string
          id?: string
          margin_impact?: number | null
          memo?: string | null
          mileage_rate?: number | null
          ref_transaction_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          base_net_profit?: number | null
          booking_id?: string | null
          created_at?: string
          id?: string
          margin_impact?: number | null
          memo?: string | null
          mileage_rate?: number | null
          ref_transaction_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mileage_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_transactions_ref_transaction_id_fkey"
            columns: ["ref_transaction_id"]
            isOneToOne: false
            referencedRelation: "mileage_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      mock_api_configs: {
        Row: {
          api_name: string
          delay_ms: number | null
          id: string
          mode: string
          updated_at: string | null
        }
        Insert: {
          api_name: string
          delay_ms?: number | null
          id?: string
          mode?: string
          updated_at?: string | null
        }
        Update: {
          api_name?: string
          delay_ms?: number | null
          id?: string
          mode?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      mrt_package_hotel_intel: {
        Row: {
          composite_mrt_score: number | null
          computed_at: string
          day_index: number
          departure_date: string
          id: string
          itinerary_hotel_grade: string | null
          itinerary_hotel_name: string
          listing_price_krw: number | null
          market_median_price_krw: number | null
          match_score: number | null
          matched_mrt_gid: string | null
          matched_mrt_name: string | null
          package_id: string
          price_percentile: number | null
          snapshot_id: string | null
        }
        Insert: {
          composite_mrt_score?: number | null
          computed_at?: string
          day_index: number
          departure_date: string
          id?: string
          itinerary_hotel_grade?: string | null
          itinerary_hotel_name: string
          listing_price_krw?: number | null
          market_median_price_krw?: number | null
          match_score?: number | null
          matched_mrt_gid?: string | null
          matched_mrt_name?: string | null
          package_id: string
          price_percentile?: number | null
          snapshot_id?: string | null
        }
        Update: {
          composite_mrt_score?: number | null
          computed_at?: string
          day_index?: number
          departure_date?: string
          id?: string
          itinerary_hotel_grade?: string | null
          itinerary_hotel_name?: string
          listing_price_krw?: number | null
          market_median_price_krw?: number | null
          match_score?: number | null
          matched_mrt_gid?: string | null
          matched_mrt_name?: string | null
          package_id?: string
          price_percentile?: number | null
          snapshot_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mrt_package_hotel_intel_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mrt_package_hotel_intel_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mrt_package_hotel_intel_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "mrt_stay_detail_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      mrt_stay_detail_snapshots: {
        Row: {
          adult_count: number
          amenities: string[]
          check_in: string
          check_out: string
          child_count: number
          detail_jsonb: Json
          expires_at: string
          fetched_at: string
          id: string
          min_room_price_krw: number | null
          mrt_gid: string
          mrt_name: string | null
          provider_url: string | null
          rating: number | null
          review_count: number | null
        }
        Insert: {
          adult_count?: number
          amenities?: string[]
          check_in: string
          check_out: string
          child_count?: number
          detail_jsonb?: Json
          expires_at: string
          fetched_at?: string
          id?: string
          min_room_price_krw?: number | null
          mrt_gid: string
          mrt_name?: string | null
          provider_url?: string | null
          rating?: number | null
          review_count?: number | null
        }
        Update: {
          adult_count?: number
          amenities?: string[]
          check_in?: string
          check_out?: string
          child_count?: number
          detail_jsonb?: Json
          expires_at?: string
          fetched_at?: string
          id?: string
          min_room_price_krw?: number | null
          mrt_gid?: string
          mrt_name?: string | null
          provider_url?: string | null
          rating?: number | null
          review_count?: number | null
        }
        Relationships: []
      }
      normalization_rules: {
        Row: {
          category: string | null
          correct_text: string
          created_at: string | null
          id: string
          is_active: boolean | null
          land_operator_id: string | null
          priority: number | null
          typo_pattern: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          correct_text: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          land_operator_id?: string | null
          priority?: number | null
          typo_pattern: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          correct_text?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          land_operator_id?: string | null
          priority?: number | null
          typo_pattern?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "normalization_rules_land_operator_id_fkey"
            columns: ["land_operator_id"]
            isOneToOne: false
            referencedRelation: "land_operators"
            referencedColumns: ["id"]
          },
        ]
      }
      normalized_intakes: {
        Row: {
          canary_mode: boolean
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string | null
          id: string
          ir: Json
          judge_report: Json | null
          judge_verdict: string | null
          land_operator: string | null
          normalizer_version: string
          package_id: string | null
          raw_text: string
          raw_text_hash: string
          region: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          canary_mode?: boolean
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          id?: string
          ir: Json
          judge_report?: Json | null
          judge_verdict?: string | null
          land_operator?: string | null
          normalizer_version: string
          package_id?: string | null
          raw_text: string
          raw_text_hash: string
          region?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          canary_mode?: boolean
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string | null
          id?: string
          ir?: Json
          judge_report?: Json | null
          judge_verdict?: string | null
          land_operator?: string | null
          normalizer_version?: string
          package_id?: string | null
          raw_text?: string
          raw_text_hash?: string
          region?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "normalized_intakes_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_intakes_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      optional_tour_market_rates: {
        Row: {
          created_at: string
          destination: string | null
          id: string
          market_rate_krw: number
          notes: string | null
          sample_size: number
          source: string
          tour_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          destination?: string | null
          id?: string
          market_rate_krw: number
          notes?: string | null
          sample_size?: number
          source?: string
          tour_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          destination?: string | null
          id?: string
          market_rate_krw?: number
          notes?: string | null
          sample_size?: number
          source?: string
          tour_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      os_policies: {
        Row: {
          action_config: Json | null
          action_type: string
          category: string
          created_at: string | null
          created_by: string | null
          description: string | null
          ends_at: string | null
          id: string
          is_active: boolean | null
          name: string
          priority: number | null
          starts_at: string | null
          target_scope: Json | null
          trigger_config: Json | null
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          action_config?: Json | null
          action_type: string
          category: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          priority?: number | null
          starts_at?: string | null
          target_scope?: Json | null
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string | null
        }
        Update: {
          action_config?: Json | null
          action_type?: string
          category?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          priority?: number | null
          starts_at?: string | null
          target_scope?: Json | null
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      os_policy_audit_log: {
        Row: {
          action: string
          changed_at: string | null
          changed_by: string
          diff: Json
          id: string
          policy_id: string | null
          reason: string | null
        }
        Insert: {
          action: string
          changed_at?: string | null
          changed_by?: string
          diff: Json
          id?: string
          policy_id?: string | null
          reason?: string | null
        }
        Update: {
          action?: string
          changed_at?: string | null
          changed_by?: string
          diff?: Json
          id?: string
          policy_id?: string | null
          reason?: string | null
        }
        Relationships: []
      }
      ota_commission_reports: {
        Row: {
          bank_tx_id: string | null
          created_at: string
          id: string
          item_count: number
          ota: string
          raw_json: Json | null
          reconciled: boolean
          reconciled_at: string | null
          report_month: string
          total_krw: number
        }
        Insert: {
          bank_tx_id?: string | null
          created_at?: string
          id?: string
          item_count?: number
          ota: string
          raw_json?: Json | null
          reconciled?: boolean
          reconciled_at?: string | null
          report_month: string
          total_krw?: number
        }
        Update: {
          bank_tx_id?: string | null
          created_at?: string
          id?: string
          item_count?: number
          ota?: string
          raw_json?: Json | null
          reconciled?: boolean
          reconciled_at?: string | null
          report_month?: string
          total_krw?: number
        }
        Relationships: []
      }
      package_pricings: {
        Row: {
          cost: number | null
          created_at: string
          day_of_week: string | null
          id: string
          parsed_package_id: string | null
          sale_price: number | null
          surcharge: number | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          cost?: number | null
          created_at?: string
          day_of_week?: string | null
          id?: string
          parsed_package_id?: string | null
          sale_price?: number | null
          surcharge?: number | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          cost?: number | null
          created_at?: string
          day_of_week?: string | null
          id?: string
          parsed_package_id?: string | null
          sale_price?: number | null
          surcharge?: number | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "package_pricings_parsed_package_id_fkey"
            columns: ["parsed_package_id"]
            isOneToOne: false
            referencedRelation: "parsed_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_score_history: {
        Row: {
          breakdown: Json | null
          created_at: string | null
          departure_date: string | null
          effective_price: number | null
          free_option_count: number | null
          group_key: string
          group_size: number | null
          hotel_avg_grade: number | null
          id: number
          is_direct_flight: boolean | null
          list_price: number | null
          package_id: string
          policy_id: string
          policy_version: string | null
          rank_in_group: number | null
          shopping_count: number | null
          snapshot_date: string
          topsis_score: number | null
        }
        Insert: {
          breakdown?: Json | null
          created_at?: string | null
          departure_date?: string | null
          effective_price?: number | null
          free_option_count?: number | null
          group_key: string
          group_size?: number | null
          hotel_avg_grade?: number | null
          id?: number
          is_direct_flight?: boolean | null
          list_price?: number | null
          package_id: string
          policy_id: string
          policy_version?: string | null
          rank_in_group?: number | null
          shopping_count?: number | null
          snapshot_date: string
          topsis_score?: number | null
        }
        Update: {
          breakdown?: Json | null
          created_at?: string | null
          departure_date?: string | null
          effective_price?: number | null
          free_option_count?: number | null
          group_key?: string
          group_size?: number | null
          hotel_avg_grade?: number | null
          id?: number
          is_direct_flight?: boolean | null
          list_price?: number | null
          package_id?: string
          policy_id?: string
          policy_version?: string | null
          rank_in_group?: number | null
          shopping_count?: number | null
          snapshot_date?: string
          topsis_score?: number | null
        }
        Relationships: []
      }
      package_score_signals: {
        Row: {
          created_at: string
          group_key: string | null
          id: number
          package_id: string
          rank_at_signal: number | null
          session_id: string | null
          signal_type: string
          topsis_score_at_signal: number | null
        }
        Insert: {
          created_at?: string
          group_key?: string | null
          id?: number
          package_id: string
          rank_at_signal?: number | null
          session_id?: string | null
          signal_type: string
          topsis_score_at_signal?: number | null
        }
        Update: {
          created_at?: string
          group_key?: string | null
          id?: number
          package_id?: string
          rank_at_signal?: number | null
          session_id?: string | null
          signal_type?: string
          topsis_score_at_signal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "package_score_signals_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_score_signals_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_scores: {
        Row: {
          breakdown: Json
          computed_at: string
          departure_date: string | null
          duration_days: number
          effective_price: number
          free_option_count: number
          group_key: string
          group_size: number
          hotel_avg_grade: number | null
          is_direct_flight: boolean
          list_price: number | null
          meal_count: number
          package_id: string
          policy_id: string
          rank_in_group: number
          shopping_count: number
          topsis_score: number
        }
        Insert: {
          breakdown: Json
          computed_at?: string
          departure_date?: string | null
          duration_days?: number
          effective_price: number
          free_option_count?: number
          group_key: string
          group_size: number
          hotel_avg_grade?: number | null
          is_direct_flight?: boolean
          list_price?: number | null
          meal_count?: number
          package_id: string
          policy_id: string
          rank_in_group: number
          shopping_count?: number
          topsis_score: number
        }
        Update: {
          breakdown?: Json
          computed_at?: string
          departure_date?: string | null
          duration_days?: number
          effective_price?: number
          free_option_count?: number
          group_key?: string
          group_size?: number
          hotel_avg_grade?: number | null
          is_direct_flight?: boolean
          list_price?: number | null
          meal_count?: number
          package_id?: string
          policy_id?: string
          rank_in_group?: number
          shopping_count?: number
          topsis_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "package_scores_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_scores_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_scores_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "scoring_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      page_engagement_detailed: {
        Row: {
          browser: string | null
          buttons_clicked: string[] | null
          clicks_count: number | null
          created_at: string | null
          customer_id: string | null
          device_type: string | null
          error_encounters: number | null
          exited_at: string | null
          hesitation_time_seconds: number | null
          id: string
          images_viewed: string[] | null
          links_clicked: string[] | null
          page_title: string | null
          page_type: string | null
          page_url: string
          rage_clicks: number | null
          scroll_depth_percent: number | null
          session_id: string | null
          time_on_page_seconds: number | null
          videos_played: string[] | null
          viewport_height: number | null
          viewport_width: number | null
        }
        Insert: {
          browser?: string | null
          buttons_clicked?: string[] | null
          clicks_count?: number | null
          created_at?: string | null
          customer_id?: string | null
          device_type?: string | null
          error_encounters?: number | null
          exited_at?: string | null
          hesitation_time_seconds?: number | null
          id?: string
          images_viewed?: string[] | null
          links_clicked?: string[] | null
          page_title?: string | null
          page_type?: string | null
          page_url: string
          rage_clicks?: number | null
          scroll_depth_percent?: number | null
          session_id?: string | null
          time_on_page_seconds?: number | null
          videos_played?: string[] | null
          viewport_height?: number | null
          viewport_width?: number | null
        }
        Update: {
          browser?: string | null
          buttons_clicked?: string[] | null
          clicks_count?: number | null
          created_at?: string | null
          customer_id?: string | null
          device_type?: string | null
          error_encounters?: number | null
          exited_at?: string | null
          hesitation_time_seconds?: number | null
          id?: string
          images_viewed?: string[] | null
          links_clicked?: string[] | null
          page_title?: string | null
          page_type?: string | null
          page_url?: string
          rage_clicks?: number | null
          scroll_depth_percent?: number | null
          session_id?: string | null
          time_on_page_seconds?: number | null
          videos_played?: string[] | null
          viewport_height?: number | null
          viewport_width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "page_engagement_detailed_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_engagement_detailed_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_engagement_detailed_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      parsed_packages: {
        Row: {
          additional_notes: string | null
          airline_exclusions: Json | null
          approved: boolean
          cancellation_policy: string | null
          created_at: string
          departure_end_date: string | null
          departure_start_date: string | null
          destination: string | null
          generated_content: string | null
          id: string
          origin: string | null
          package_name: string | null
          price_details: Json | null
          raw_document_id: string | null
          schedule: Json | null
          surcharge_notes: Json | null
          updated_at: string
        }
        Insert: {
          additional_notes?: string | null
          airline_exclusions?: Json | null
          approved?: boolean
          cancellation_policy?: string | null
          created_at?: string
          departure_end_date?: string | null
          departure_start_date?: string | null
          destination?: string | null
          generated_content?: string | null
          id?: string
          origin?: string | null
          package_name?: string | null
          price_details?: Json | null
          raw_document_id?: string | null
          schedule?: Json | null
          surcharge_notes?: Json | null
          updated_at?: string
        }
        Update: {
          additional_notes?: string | null
          airline_exclusions?: Json | null
          approved?: boolean
          cancellation_policy?: string | null
          created_at?: string
          departure_end_date?: string | null
          departure_start_date?: string | null
          destination?: string | null
          generated_content?: string | null
          id?: string
          origin?: string | null
          package_name?: string | null
          price_details?: Json | null
          raw_document_id?: string | null
          schedule?: Json | null
          surcharge_notes?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parsed_packages_raw_document_id_fkey"
            columns: ["raw_document_id"]
            isOneToOne: false
            referencedRelation: "raw_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_sales: {
        Row: {
          commission: number | null
          created_at: string
          id: string
          package_pricing_id: string | null
          partner_id: string | null
          sale_amount: number | null
          sale_date: string | null
        }
        Insert: {
          commission?: number | null
          created_at?: string
          id?: string
          package_pricing_id?: string | null
          partner_id?: string | null
          sale_amount?: number | null
          sale_date?: string | null
        }
        Update: {
          commission?: number | null
          created_at?: string
          id?: string
          package_pricing_id?: string | null
          partner_id?: string | null
          sale_amount?: number | null
          sale_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_sales_package_pricing_id_fkey"
            columns: ["package_pricing_id"]
            isOneToOne: false
            referencedRelation: "package_pricings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_sales_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          code: string
          contact_info: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          code: string
          contact_info?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          code?: string
          contact_info?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      payment_command_log: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          id: string
          parsed_booking_id: string | null
          parsed_customer_name: string | null
          parsed_date: string | null
          parsed_operator_alias: string | null
          pattern_signature: string | null
          raw_input: string
          reasons: Json | null
          resolved_booking_id: string | null
          resolved_branch: string | null
          resolved_inflow_tx_id: string | null
          resolved_outflow_tx_id: string | null
          resolved_settlement_id: string | null
          score: number | null
          tenant_id: string | null
          user_corrected: boolean
        }
        Insert: {
          action?: string
          created_at?: string
          created_by?: string | null
          id?: string
          parsed_booking_id?: string | null
          parsed_customer_name?: string | null
          parsed_date?: string | null
          parsed_operator_alias?: string | null
          pattern_signature?: string | null
          raw_input: string
          reasons?: Json | null
          resolved_booking_id?: string | null
          resolved_branch?: string | null
          resolved_inflow_tx_id?: string | null
          resolved_outflow_tx_id?: string | null
          resolved_settlement_id?: string | null
          score?: number | null
          tenant_id?: string | null
          user_corrected?: boolean
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          id?: string
          parsed_booking_id?: string | null
          parsed_customer_name?: string | null
          parsed_date?: string | null
          parsed_operator_alias?: string | null
          pattern_signature?: string | null
          raw_input?: string
          reasons?: Json | null
          resolved_booking_id?: string | null
          resolved_branch?: string | null
          resolved_inflow_tx_id?: string | null
          resolved_outflow_tx_id?: string | null
          resolved_settlement_id?: string | null
          score?: number | null
          tenant_id?: string | null
          user_corrected?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fk_pcl_settlement"
            columns: ["resolved_settlement_id"]
            isOneToOne: false
            referencedRelation: "land_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_command_log_resolved_booking_id_fkey"
            columns: ["resolved_booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_command_log_resolved_booking_id_fkey"
            columns: ["resolved_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_command_log_resolved_booking_id_fkey"
            columns: ["resolved_booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_command_log_resolved_inflow_tx_id_fkey"
            columns: ["resolved_inflow_tx_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_command_log_resolved_outflow_tx_id_fkey"
            columns: ["resolved_outflow_tx_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_command_rules: {
        Row: {
          created_at: string
          first_seen_at: string
          id: string
          last_seen_at: string
          learn_count: number
          parsed_operator_alias: string | null
          pattern_signature: string
          resolved_operator_id: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          learn_count?: number
          parsed_operator_alias?: string | null
          pattern_signature: string
          resolved_operator_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          learn_count?: number
          parsed_operator_alias?: string | null
          pattern_signature?: string
          resolved_operator_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_command_rules_resolved_operator_id_fkey"
            columns: ["resolved_operator_id"]
            isOneToOne: false
            referencedRelation: "land_operators"
            referencedColumns: ["id"]
          },
        ]
      }
      pin_attempts: {
        Row: {
          attempted_at: string | null
          id: string
          identifier: string
        }
        Insert: {
          attempted_at?: string | null
          id?: string
          identifier: string
        }
        Update: {
          attempted_at?: string | null
          id?: string
          identifier?: string
        }
        Relationships: []
      }
      platform_learning_events: {
        Row: {
          affiliate_id: string | null
          consent_flags: Json
          created_at: string
          id: string
          message_redacted: string | null
          message_sha256: string | null
          payload: Json
          session_id: string | null
          source: string
          tenant_id: string | null
        }
        Insert: {
          affiliate_id?: string | null
          consent_flags?: Json
          created_at?: string
          id?: string
          message_redacted?: string | null
          message_sha256?: string | null
          payload?: Json
          session_id?: string | null
          source: string
          tenant_id?: string | null
        }
        Update: {
          affiliate_id?: string | null
          consent_flags?: Json
          created_at?: string
          id?: string
          message_redacted?: string | null
          message_sha256?: string | null
          payload?: Json
          session_id?: string | null
          source?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_learning_events_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_learning_events_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "influencer_performance"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_ab_results: {
        Row: {
          booking_rate_a: number | null
          booking_rate_b: number | null
          booking_value_a: number | null
          booking_value_b: number | null
          bookings_a: number | null
          bookings_b: number | null
          confidence: number | null
          exposures_a: number | null
          exposures_b: number | null
          id: number
          measured_at: string
          notes: string | null
          period_end: string | null
          period_start: string | null
          policy_a_id: string
          policy_a_version: string | null
          policy_b_id: string
          policy_b_version: string | null
          winner: string | null
        }
        Insert: {
          booking_rate_a?: number | null
          booking_rate_b?: number | null
          booking_value_a?: number | null
          booking_value_b?: number | null
          bookings_a?: number | null
          bookings_b?: number | null
          confidence?: number | null
          exposures_a?: number | null
          exposures_b?: number | null
          id?: number
          measured_at?: string
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          policy_a_id: string
          policy_a_version?: string | null
          policy_b_id: string
          policy_b_version?: string | null
          winner?: string | null
        }
        Update: {
          booking_rate_a?: number | null
          booking_rate_b?: number | null
          booking_value_a?: number | null
          booking_value_b?: number | null
          bookings_a?: number | null
          bookings_b?: number | null
          confidence?: number | null
          exposures_a?: number | null
          exposures_b?: number | null
          id?: number
          measured_at?: string
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          policy_a_id?: string
          policy_a_version?: string | null
          policy_b_id?: string
          policy_b_version?: string | null
          winner?: string | null
        }
        Relationships: []
      }
      post_engagement_snapshots: {
        Row: {
          captured_at: string
          card_news_id: string | null
          clicks: number | null
          comments: number | null
          created_at: string
          ctr: number | null
          distribution_id: string | null
          external_id: string
          id: string
          impressions_legacy: number | null
          likes: number | null
          performance_score: number | null
          platform: string
          quotes: number | null
          raw_response: Json | null
          reach: number | null
          replies: number | null
          reposts: number | null
          saves: number | null
          shares: number | null
          spend: number | null
          tenant_id: string | null
          views: number | null
        }
        Insert: {
          captured_at?: string
          card_news_id?: string | null
          clicks?: number | null
          comments?: number | null
          created_at?: string
          ctr?: number | null
          distribution_id?: string | null
          external_id: string
          id?: string
          impressions_legacy?: number | null
          likes?: number | null
          performance_score?: number | null
          platform: string
          quotes?: number | null
          raw_response?: Json | null
          reach?: number | null
          replies?: number | null
          reposts?: number | null
          saves?: number | null
          shares?: number | null
          spend?: number | null
          tenant_id?: string | null
          views?: number | null
        }
        Update: {
          captured_at?: string
          card_news_id?: string | null
          clicks?: number | null
          comments?: number | null
          created_at?: string
          ctr?: number | null
          distribution_id?: string | null
          external_id?: string
          id?: string
          impressions_legacy?: number | null
          likes?: number | null
          performance_score?: number | null
          platform?: string
          quotes?: number | null
          raw_response?: Json | null
          reach?: number | null
          replies?: number | null
          reposts?: number | null
          saves?: number | null
          shares?: number | null
          spend?: number | null
          tenant_id?: string | null
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "post_engagement_snapshots_card_news_id_fkey"
            columns: ["card_news_id"]
            isOneToOne: false
            referencedRelation: "card_news"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_engagement_snapshots_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "content_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_engagement_snapshots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      post_trip_reviews: {
        Row: {
          accommodation_quality: number | null
          booking_id: string | null
          cancellation_risk_score: number | null
          company_responded_at: string | null
          company_response: string | null
          complaint_filed: boolean | null
          complaint_resolution_cost: number | null
          cons: string[] | null
          created_at: string | null
          customer_id: string | null
          food_quality: number | null
          guide_quality: number | null
          helpful_count: number | null
          id: string
          is_featured: boolean | null
          itinerary_quality: number | null
          moderation_notes: string | null
          overall_rating: number
          package_id: string | null
          photo_urls: string[] | null
          pros: string[] | null
          published_at: string | null
          rebooking_interval_days: number | null
          referral_count: number | null
          review_language: string | null
          review_text: string | null
          status: string | null
          tips_for_travelers: string[] | null
          title: string | null
          transportation_quality: number | null
          value_for_money: number | null
          verified_traveler: boolean | null
          video_urls: string[] | null
          would_book_again: boolean | null
          would_recommend: boolean | null
        }
        Insert: {
          accommodation_quality?: number | null
          booking_id?: string | null
          cancellation_risk_score?: number | null
          company_responded_at?: string | null
          company_response?: string | null
          complaint_filed?: boolean | null
          complaint_resolution_cost?: number | null
          cons?: string[] | null
          created_at?: string | null
          customer_id?: string | null
          food_quality?: number | null
          guide_quality?: number | null
          helpful_count?: number | null
          id?: string
          is_featured?: boolean | null
          itinerary_quality?: number | null
          moderation_notes?: string | null
          overall_rating: number
          package_id?: string | null
          photo_urls?: string[] | null
          pros?: string[] | null
          published_at?: string | null
          rebooking_interval_days?: number | null
          referral_count?: number | null
          review_language?: string | null
          review_text?: string | null
          status?: string | null
          tips_for_travelers?: string[] | null
          title?: string | null
          transportation_quality?: number | null
          value_for_money?: number | null
          verified_traveler?: boolean | null
          video_urls?: string[] | null
          would_book_again?: boolean | null
          would_recommend?: boolean | null
        }
        Update: {
          accommodation_quality?: number | null
          booking_id?: string | null
          cancellation_risk_score?: number | null
          company_responded_at?: string | null
          company_response?: string | null
          complaint_filed?: boolean | null
          complaint_resolution_cost?: number | null
          cons?: string[] | null
          created_at?: string | null
          customer_id?: string | null
          food_quality?: number | null
          guide_quality?: number | null
          helpful_count?: number | null
          id?: string
          is_featured?: boolean | null
          itinerary_quality?: number | null
          moderation_notes?: string | null
          overall_rating?: number
          package_id?: string | null
          photo_urls?: string[] | null
          pros?: string[] | null
          published_at?: string | null
          rebooking_interval_days?: number | null
          referral_count?: number | null
          review_language?: string | null
          review_text?: string | null
          status?: string | null
          tips_for_travelers?: string[] | null
          title?: string | null
          transportation_quality?: number | null
          value_for_money?: number | null
          verified_traveler?: boolean | null
          video_urls?: string[] | null
          would_book_again?: boolean | null
          would_recommend?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "post_trip_reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_trip_reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_trip_reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_trip_reviews_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_trip_reviews_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_trip_reviews_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_trip_reviews_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_trip_reviews_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      pre_trip_data: {
        Row: {
          booking_id: string | null
          collected_at: string | null
          concerns: string[] | null
          contact_time_preference: string | null
          customer_id: string | null
          documents_ready: boolean | null
          excitement_level: number | null
          expectations: string[] | null
          id: string
          insurance_purchased: boolean | null
          language_preference: string | null
          must_do_activities: string[] | null
          packing_completed: boolean | null
          preferred_contact_method: string | null
          special_requests: string[] | null
          survey_responses: Json | null
          vaccinations_completed: boolean | null
        }
        Insert: {
          booking_id?: string | null
          collected_at?: string | null
          concerns?: string[] | null
          contact_time_preference?: string | null
          customer_id?: string | null
          documents_ready?: boolean | null
          excitement_level?: number | null
          expectations?: string[] | null
          id?: string
          insurance_purchased?: boolean | null
          language_preference?: string | null
          must_do_activities?: string[] | null
          packing_completed?: boolean | null
          preferred_contact_method?: string | null
          special_requests?: string[] | null
          survey_responses?: Json | null
          vaccinations_completed?: boolean | null
        }
        Update: {
          booking_id?: string | null
          collected_at?: string | null
          concerns?: string[] | null
          contact_time_preference?: string | null
          customer_id?: string | null
          documents_ready?: boolean | null
          excitement_level?: number | null
          expectations?: string[] | null
          id?: string
          insurance_purchased?: boolean | null
          language_preference?: string | null
          must_do_activities?: string[] | null
          packing_completed?: boolean | null
          preferred_contact_method?: string | null
          special_requests?: string[] | null
          survey_responses?: Json | null
          vaccinations_completed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "pre_trip_data_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_trip_data_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_trip_data_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_trip_data_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_trip_data_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_trip_data_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      price_history: {
        Row: {
          change_reason: string | null
          change_type: string | null
          cost_price: number | null
          days_until_departure: number | null
          demand_level: string | null
          discount_amount: number | null
          id: string
          is_automated: boolean | null
          occupancy_rate: number | null
          original_price: number | null
          package_id: string
          price: number
          pricing_algorithm: string | null
          recorded_at: string | null
          season_type: string | null
          seats_booked: number | null
          seats_total: number | null
          source: string | null
        }
        Insert: {
          change_reason?: string | null
          change_type?: string | null
          cost_price?: number | null
          days_until_departure?: number | null
          demand_level?: string | null
          discount_amount?: number | null
          id?: string
          is_automated?: boolean | null
          occupancy_rate?: number | null
          original_price?: number | null
          package_id: string
          price: number
          pricing_algorithm?: string | null
          recorded_at?: string | null
          season_type?: string | null
          seats_booked?: number | null
          seats_total?: number | null
          source?: string | null
        }
        Update: {
          change_reason?: string | null
          change_type?: string | null
          cost_price?: number | null
          days_until_departure?: number | null
          demand_level?: string | null
          discount_amount?: number | null
          id?: string
          is_automated?: boolean | null
          occupancy_rate?: number | null
          original_price?: number | null
          package_id?: string
          price?: number
          pricing_algorithm?: string | null
          recorded_at?: string | null
          season_type?: string | null
          seats_booked?: number | null
          seats_total?: number | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_history_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_history_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      product_comparison_events: {
        Row: {
          comparison_criteria: string[] | null
          created_at: string | null
          customer_id: string | null
          id: string
          product_a_id: string | null
          product_b_id: string | null
          product_c_id: string | null
          selected_product_id: string | null
          selection_reason: string | null
          session_id: string | null
          time_spent_seconds: number | null
        }
        Insert: {
          comparison_criteria?: string[] | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          product_a_id?: string | null
          product_b_id?: string | null
          product_c_id?: string | null
          selected_product_id?: string | null
          selection_reason?: string | null
          session_id?: string | null
          time_spent_seconds?: number | null
        }
        Update: {
          comparison_criteria?: string[] | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          product_a_id?: string | null
          product_b_id?: string | null
          product_c_id?: string | null
          selected_product_id?: string | null
          selection_reason?: string | null
          session_id?: string | null
          time_spent_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_comparison_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_comparison_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_comparison_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_comparison_events_product_a_id_fkey"
            columns: ["product_a_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_comparison_events_product_a_id_fkey"
            columns: ["product_a_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_comparison_events_product_b_id_fkey"
            columns: ["product_b_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_comparison_events_product_b_id_fkey"
            columns: ["product_b_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_comparison_events_product_c_id_fkey"
            columns: ["product_c_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_comparison_events_product_c_id_fkey"
            columns: ["product_c_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      product_prices: {
        Row: {
          adult_selling_price: number | null
          child_price: number | null
          created_at: string | null
          day_of_week: string | null
          id: string
          net_price: number
          note: string | null
          product_id: string
          target_date: string | null
        }
        Insert: {
          adult_selling_price?: number | null
          child_price?: number | null
          created_at?: string | null
          day_of_week?: string | null
          id?: string
          net_price: number
          note?: string | null
          product_id: string
          target_date?: string | null
        }
        Update: {
          adult_selling_price?: number | null
          child_price?: number | null
          created_at?: string | null
          day_of_week?: string | null
          id?: string
          net_price?: number
          note?: string | null
          product_id?: string
          target_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["internal_code"]
          },
        ]
      }
      products: {
        Row: {
          ai_confidence_score: number | null
          ai_tags: string[]
          created_at: string
          departing_location_id: string | null
          departure_date: string | null
          departure_region: string
          discount_amount: number
          display_name: string
          embedding: string | null
          expired_at: string | null
          flight_info: Json | null
          inquiry_count: number | null
          internal_code: string
          internal_memo: string | null
          land_operator_id: string | null
          margin_rate: number
          net_price: number
          raw_extracted_text: string | null
          selling_points: Json | null
          selling_price: number | null
          source_filename: string | null
          status: string
          supplier_code: string
          tenant_id: string | null
          theme_tags: string[] | null
          thumbnail_urls: string[] | null
          updated_at: string
          view_count: number | null
        }
        Insert: {
          ai_confidence_score?: number | null
          ai_tags?: string[]
          created_at?: string
          departing_location_id?: string | null
          departure_date?: string | null
          departure_region?: string
          discount_amount?: number
          display_name: string
          embedding?: string | null
          expired_at?: string | null
          flight_info?: Json | null
          inquiry_count?: number | null
          internal_code: string
          internal_memo?: string | null
          land_operator_id?: string | null
          margin_rate?: number
          net_price: number
          raw_extracted_text?: string | null
          selling_points?: Json | null
          selling_price?: number | null
          source_filename?: string | null
          status?: string
          supplier_code: string
          tenant_id?: string | null
          theme_tags?: string[] | null
          thumbnail_urls?: string[] | null
          updated_at?: string
          view_count?: number | null
        }
        Update: {
          ai_confidence_score?: number | null
          ai_tags?: string[]
          created_at?: string
          departing_location_id?: string | null
          departure_date?: string | null
          departure_region?: string
          discount_amount?: number
          display_name?: string
          embedding?: string | null
          expired_at?: string | null
          flight_info?: Json | null
          inquiry_count?: number | null
          internal_code?: string
          internal_memo?: string | null
          land_operator_id?: string | null
          margin_rate?: number
          net_price?: number
          raw_extracted_text?: string | null
          selling_points?: Json | null
          selling_price?: number | null
          source_filename?: string | null
          status?: string
          supplier_code?: string
          tenant_id?: string | null
          theme_tags?: string[] | null
          thumbnail_urls?: string[] | null
          updated_at?: string
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_departing_location_id_fkey"
            columns: ["departing_location_id"]
            isOneToOne: false
            referencedRelation: "departing_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_land_operator_id_fkey"
            columns: ["land_operator_id"]
            isOneToOne: false
            referencedRelation: "land_operators"
            referencedColumns: ["id"]
          },
        ]
      }
      programmatic_seo_topics: {
        Row: {
          angle: string
          created_at: string
          destination: string
          expected_tier: string | null
          expected_volume: number | null
          id: number
          meta: Json | null
          month: number | null
          primary_keyword: string
          priority: number
          promoted_at: string | null
          status: string
          topic_queue_id: string | null
          topic_template: string
        }
        Insert: {
          angle: string
          created_at?: string
          destination: string
          expected_tier?: string | null
          expected_volume?: number | null
          id?: number
          meta?: Json | null
          month?: number | null
          primary_keyword: string
          priority?: number
          promoted_at?: string | null
          status?: string
          topic_queue_id?: string | null
          topic_template: string
        }
        Update: {
          angle?: string
          created_at?: string
          destination?: string
          expected_tier?: string | null
          expected_volume?: number | null
          id?: number
          meta?: Json | null
          month?: number | null
          primary_keyword?: string
          priority?: number
          promoted_at?: string | null
          status?: string
          topic_queue_id?: string | null
          topic_template?: string
        }
        Relationships: [
          {
            foreignKeyName: "programmatic_seo_topics_topic_queue_id_fkey"
            columns: ["topic_queue_id"]
            isOneToOne: false
            referencedRelation: "blog_topic_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_usages: {
        Row: {
          booking_id: string | null
          customer_id: string | null
          discount_amount: number | null
          final_amount: number | null
          id: string
          original_amount: number | null
          promotion_id: string
          used_at: string | null
        }
        Insert: {
          booking_id?: string | null
          customer_id?: string | null
          discount_amount?: number | null
          final_amount?: number | null
          id?: string
          original_amount?: number | null
          promotion_id: string
          used_at?: string | null
        }
        Update: {
          booking_id?: string | null
          customer_id?: string | null
          discount_amount?: number | null
          final_amount?: number | null
          id?: string
          original_amount?: number | null
          promotion_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promotion_usages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_usages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_usages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_usages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_usages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_usages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_usages_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          applicable_destinations: string[] | null
          applicable_packages: string[] | null
          campaign_id: string | null
          code: string
          created_at: string | null
          description: string | null
          discount_value: number | null
          id: string
          max_discount_amount: number | null
          min_purchase_amount: number | null
          name: string
          status: string | null
          type: string | null
          usage_limit: number | null
          usage_limit_per_customer: number | null
          used_count: number | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          applicable_destinations?: string[] | null
          applicable_packages?: string[] | null
          campaign_id?: string | null
          code: string
          created_at?: string | null
          description?: string | null
          discount_value?: number | null
          id?: string
          max_discount_amount?: number | null
          min_purchase_amount?: number | null
          name: string
          status?: string | null
          type?: string | null
          usage_limit?: number | null
          usage_limit_per_customer?: number | null
          used_count?: number | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          applicable_destinations?: string[] | null
          applicable_packages?: string[] | null
          campaign_id?: string | null
          code?: string
          created_at?: string | null
          description?: string | null
          discount_value?: number | null
          id?: string
          max_discount_amount?: number | null
          min_purchase_amount?: number | null
          name?: string
          status?: string | null
          type?: string | null
          usage_limit?: number | null
          usage_limit_per_customer?: number | null
          used_count?: number | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promotions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_roi_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_versions: {
        Row: {
          activated_at: string | null
          change_notes: string | null
          content: string
          created_at: string
          domain: string
          id: string
          is_active: boolean
          performance_baseline: Json | null
          source: string | null
          source_action_id: string | null
          version: string
        }
        Insert: {
          activated_at?: string | null
          change_notes?: string | null
          content: string
          created_at?: string
          domain: string
          id?: string
          is_active?: boolean
          performance_baseline?: Json | null
          source?: string | null
          source_action_id?: string | null
          version: string
        }
        Update: {
          activated_at?: string | null
          change_notes?: string | null
          content?: string
          created_at?: string
          domain?: string
          id?: string
          is_active?: boolean
          performance_baseline?: Json | null
          source?: string | null
          source_action_id?: string | null
          version?: string
        }
        Relationships: []
      }
      publishing_policies: {
        Row: {
          auto_regenerate_underperformers: boolean
          auto_trigger_card_news: boolean
          auto_trigger_orchestrator: boolean
          created_at: string
          daily_summary_webhook: string | null
          enabled: boolean
          id: number
          meta: Json | null
          multi_angle_count: number
          multi_angle_gap_days: number
          per_destination_daily_cap: number
          posts_per_day: number
          product_ratio: number
          scope: string
          slot_times: string[]
          updated_at: string
        }
        Insert: {
          auto_regenerate_underperformers?: boolean
          auto_trigger_card_news?: boolean
          auto_trigger_orchestrator?: boolean
          created_at?: string
          daily_summary_webhook?: string | null
          enabled?: boolean
          id?: number
          meta?: Json | null
          multi_angle_count?: number
          multi_angle_gap_days?: number
          per_destination_daily_cap?: number
          posts_per_day?: number
          product_ratio?: number
          scope: string
          slot_times?: string[]
          updated_at?: string
        }
        Update: {
          auto_regenerate_underperformers?: boolean
          auto_trigger_card_news?: boolean
          auto_trigger_orchestrator?: boolean
          created_at?: string
          daily_summary_webhook?: string | null
          enabled?: boolean
          id?: number
          meta?: Json | null
          multi_angle_count?: number
          multi_angle_gap_days?: number
          per_destination_daily_cap?: number
          posts_per_day?: number
          product_ratio?: number
          scope?: string
          slot_times?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      push_notifications: {
        Row: {
          body: string | null
          created_at: string
          deep_link: string | null
          id: string
          kind: string | null
          payload: Json | null
          read_at: string | null
          title: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          deep_link?: string | null
          id?: string
          kind?: string | null
          payload?: Json | null
          read_at?: string | null
          title: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          deep_link?: string | null
          id?: string
          kind?: string | null
          payload?: Json | null
          read_at?: string | null
          title?: string
          user_id?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          revoked_at: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          revoked_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          revoked_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      qa_inquiries: {
        Row: {
          answered_at: string | null
          answered_by: string | null
          created_at: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          id: string
          inquiry_type: string | null
          question: string
          related_packages: string[] | null
          status: string | null
        }
        Insert: {
          answered_at?: string | null
          answered_by?: string | null
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          inquiry_type?: string | null
          question: string
          related_packages?: string[] | null
          status?: string | null
        }
        Update: {
          answered_at?: string | null
          answered_by?: string | null
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          inquiry_type?: string | null
          question?: string
          related_packages?: string[] | null
          status?: string | null
        }
        Relationships: []
      }
      rank_alerts: {
        Row: {
          curr_position: number | null
          delta: number | null
          detected_at: string
          id: number
          meta: Json | null
          prev_position: number | null
          query: string
          resolved_at: string | null
          slug: string
        }
        Insert: {
          curr_position?: number | null
          delta?: number | null
          detected_at?: string
          id?: number
          meta?: Json | null
          prev_position?: number | null
          query: string
          resolved_at?: string | null
          slug: string
        }
        Update: {
          curr_position?: number | null
          delta?: number | null
          detected_at?: string
          id?: number
          meta?: Json | null
          prev_position?: number | null
          query?: string
          resolved_at?: string | null
          slug?: string
        }
        Relationships: []
      }
      rank_history: {
        Row: {
          clicks: number | null
          ctr: number | null
          date: string
          id: number
          impressions: number | null
          page_url: string | null
          position: number | null
          query: string
          slug: string
          source: string | null
        }
        Insert: {
          clicks?: number | null
          ctr?: number | null
          date: string
          id?: number
          impressions?: number | null
          page_url?: string | null
          position?: number | null
          query: string
          slug: string
          source?: string | null
        }
        Update: {
          clicks?: number | null
          ctr?: number | null
          date?: string
          id?: number
          impressions?: number | null
          page_url?: string | null
          position?: number | null
          query?: string
          slug?: string
          source?: string | null
        }
        Relationships: []
      }
      raw_documents: {
        Row: {
          content: string
          created_at: string
          filename: string | null
          id: string
          source_type: string
        }
        Insert: {
          content: string
          created_at?: string
          filename?: string | null
          id?: string
          source_type: string
        }
        Update: {
          content?: string
          created_at?: string
          filename?: string | null
          id?: string
          source_type?: string
        }
        Relationships: []
      }
      recommendation_logs: {
        Row: {
          algorithm: string | null
          clicked_package_id: string | null
          converted: boolean | null
          created_at: string | null
          customer_id: string | null
          id: string
          recommended_packages: string[] | null
          session_id: string | null
        }
        Insert: {
          algorithm?: string | null
          clicked_package_id?: string | null
          converted?: boolean | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          recommended_packages?: string[] | null
          session_id?: string | null
        }
        Update: {
          algorithm?: string | null
          clicked_package_id?: string | null
          converted?: boolean | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          recommended_packages?: string[] | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_logs_clicked_package_id_fkey"
            columns: ["clicked_package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_logs_clicked_package_id_fkey"
            columns: ["clicked_package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_outcomes: {
        Row: {
          id: number
          intent: string | null
          notes: string | null
          outcome: string | null
          outcome_at: string | null
          outcome_value: number | null
          package_id: string
          policy_id: string | null
          recommended_at: string
          recommended_rank: number | null
          session_id: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          id?: number
          intent?: string | null
          notes?: string | null
          outcome?: string | null
          outcome_at?: string | null
          outcome_value?: number | null
          package_id: string
          policy_id?: string | null
          recommended_at?: string
          recommended_rank?: number | null
          session_id?: string | null
          source: string
          user_id?: string | null
        }
        Update: {
          id?: number
          intent?: string | null
          notes?: string | null
          outcome?: string | null
          outcome_at?: string | null
          outcome_value?: number | null
          package_id?: string
          policy_id?: string | null
          recommended_at?: string
          recommended_rank?: number | null
          session_id?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      rfq_bids: {
        Row: {
          id: string
          is_penalized: boolean
          locked_at: string
          penalty_reason: string | null
          rfq_id: string
          status: string
          submit_deadline: string
          submitted_at: string | null
          tenant_id: string
        }
        Insert: {
          id?: string
          is_penalized?: boolean
          locked_at?: string
          penalty_reason?: string | null
          rfq_id: string
          status?: string
          submit_deadline: string
          submitted_at?: string | null
          tenant_id: string
        }
        Update: {
          id?: string
          is_penalized?: boolean
          locked_at?: string
          penalty_reason?: string | null
          rfq_id?: string
          status?: string
          submit_deadline?: string
          submitted_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfq_bids_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "group_rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_bids_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rfq_messages: {
        Row: {
          created_at: string
          id: string
          is_visible_to_customer: boolean
          is_visible_to_tenant: boolean
          pii_blocked: boolean
          pii_detected: boolean
          processed_content: string | null
          proposal_id: string | null
          raw_content: string
          recipient_type: string
          rfq_id: string
          sender_id: string | null
          sender_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_visible_to_customer?: boolean
          is_visible_to_tenant?: boolean
          pii_blocked?: boolean
          pii_detected?: boolean
          processed_content?: string | null
          proposal_id?: string | null
          raw_content: string
          recipient_type: string
          rfq_id: string
          sender_id?: string | null
          sender_type: string
        }
        Update: {
          created_at?: string
          id?: string
          is_visible_to_customer?: boolean
          is_visible_to_tenant?: boolean
          pii_blocked?: boolean
          pii_detected?: boolean
          processed_content?: string | null
          proposal_id?: string | null
          raw_content?: string
          recipient_type?: string
          rfq_id?: string
          sender_id?: string | null
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfq_messages_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "rfq_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_messages_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "group_rfqs"
            referencedColumns: ["id"]
          },
        ]
      }
      rfq_proposals: {
        Row: {
          ai_review: Json | null
          ai_reviewed_at: string | null
          bid_id: string
          checklist: Json
          checklist_completed: boolean
          created_at: string
          hidden_cost_estimate: number
          id: string
          itinerary_summary: string | null
          proposal_title: string | null
          rank: number | null
          real_total_price: number | null
          rfq_id: string
          status: string
          submitted_at: string | null
          tenant_id: string
          total_cost: number
          total_selling_price: number
          updated_at: string
        }
        Insert: {
          ai_review?: Json | null
          ai_reviewed_at?: string | null
          bid_id: string
          checklist?: Json
          checklist_completed?: boolean
          created_at?: string
          hidden_cost_estimate?: number
          id?: string
          itinerary_summary?: string | null
          proposal_title?: string | null
          rank?: number | null
          real_total_price?: number | null
          rfq_id: string
          status?: string
          submitted_at?: string | null
          tenant_id: string
          total_cost: number
          total_selling_price: number
          updated_at?: string
        }
        Update: {
          ai_review?: Json | null
          ai_reviewed_at?: string | null
          bid_id?: string
          checklist?: Json
          checklist_completed?: boolean
          created_at?: string
          hidden_cost_estimate?: number
          id?: string
          itinerary_summary?: string | null
          proposal_title?: string | null
          rank?: number | null
          real_total_price?: number | null
          rfq_id?: string
          status?: string
          submitted_at?: string | null
          tenant_id?: string
          total_cost?: number
          total_selling_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfq_proposals_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "rfq_bids"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_proposals_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "group_rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_proposals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_policies: {
        Row: {
          created_at: string
          created_by: string | null
          fallback_rules: Json
          flight_premium: Json
          hedonic_coefs: Json
          hotel_brand_max_bonus: number
          hotel_premium: Json
          id: string
          is_active: boolean
          market_rates: Json
          notes: string | null
          updated_at: string
          version: string
          weights: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fallback_rules?: Json
          flight_premium?: Json
          hedonic_coefs?: Json
          hotel_brand_max_bonus?: number
          hotel_premium?: Json
          id?: string
          is_active?: boolean
          market_rates?: Json
          notes?: string | null
          updated_at?: string
          version: string
          weights: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fallback_rules?: Json
          flight_premium?: Json
          hedonic_coefs?: Json
          hotel_brand_max_bonus?: number
          hotel_premium?: Json
          id?: string
          is_active?: boolean
          market_rates?: Json
          notes?: string | null
          updated_at?: string
          version?: string
          weights?: Json
        }
        Relationships: []
      }
      scoring_rules: {
        Row: {
          category: string
          description: string | null
          id: string
          is_active: boolean | null
          item: string
          match_field: string | null
          match_keywords: string[] | null
          score: number
        }
        Insert: {
          category: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          item: string
          match_field?: string | null
          match_keywords?: string[] | null
          score: number
        }
        Update: {
          category?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          item?: string
          match_field?: string | null
          match_keywords?: string[] | null
          score?: number
        }
        Relationships: []
      }
      search_queries: {
        Row: {
          clicked_results: string[] | null
          conversion_package_id: string | null
          created_at: string | null
          customer_id: string | null
          filters_applied: Json | null
          id: string
          led_to_conversion: boolean | null
          query_normalized: string | null
          query_text: string
          query_tokens: string[] | null
          results_count: number | null
          results_shown: string[] | null
          session_id: string | null
          sort_order: string | null
        }
        Insert: {
          clicked_results?: string[] | null
          conversion_package_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          filters_applied?: Json | null
          id?: string
          led_to_conversion?: boolean | null
          query_normalized?: string | null
          query_text: string
          query_tokens?: string[] | null
          results_count?: number | null
          results_shown?: string[] | null
          session_id?: string | null
          sort_order?: string | null
        }
        Update: {
          clicked_results?: string[] | null
          conversion_package_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          filters_applied?: Json | null
          id?: string
          led_to_conversion?: boolean | null
          query_normalized?: string | null
          query_text?: string
          query_tokens?: string[] | null
          results_count?: number | null
          results_shown?: string[] | null
          session_id?: string | null
          sort_order?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "search_queries_conversion_package_id_fkey"
            columns: ["conversion_package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_queries_conversion_package_id_fkey"
            columns: ["conversion_package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_queries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_queries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_queries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      search_sessions_detailed: {
        Row: {
          abandoned: boolean | null
          abandonment_stage: string | null
          browser: string | null
          clicks_count: number | null
          conversion_package_id: string | null
          conversion_value: number | null
          converted: boolean | null
          customer_id: string | null
          destinations_searched: string[] | null
          device_type: string | null
          duration_seconds: number | null
          ended_at: string | null
          engagement_score: number | null
          entry_page: string | null
          exit_page: string | null
          filter_change_count: number | null
          filters_used: Json | null
          id: string
          os: string | null
          page_sequence: string[] | null
          products_compared: string[] | null
          products_favorited: string[] | null
          products_viewed: string[] | null
          search_queries: string[] | null
          session_id: string
          started_at: string | null
          time_per_product: Json | null
          time_to_conversion_seconds: number | null
          total_searches: number | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          abandoned?: boolean | null
          abandonment_stage?: string | null
          browser?: string | null
          clicks_count?: number | null
          conversion_package_id?: string | null
          conversion_value?: number | null
          converted?: boolean | null
          customer_id?: string | null
          destinations_searched?: string[] | null
          device_type?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          engagement_score?: number | null
          entry_page?: string | null
          exit_page?: string | null
          filter_change_count?: number | null
          filters_used?: Json | null
          id?: string
          os?: string | null
          page_sequence?: string[] | null
          products_compared?: string[] | null
          products_favorited?: string[] | null
          products_viewed?: string[] | null
          search_queries?: string[] | null
          session_id: string
          started_at?: string | null
          time_per_product?: Json | null
          time_to_conversion_seconds?: number | null
          total_searches?: number | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          abandoned?: boolean | null
          abandonment_stage?: string | null
          browser?: string | null
          clicks_count?: number | null
          conversion_package_id?: string | null
          conversion_value?: number | null
          converted?: boolean | null
          customer_id?: string | null
          destinations_searched?: string[] | null
          device_type?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          engagement_score?: number | null
          entry_page?: string | null
          exit_page?: string | null
          filter_change_count?: number | null
          filters_used?: Json | null
          id?: string
          os?: string | null
          page_sequence?: string[] | null
          products_compared?: string[] | null
          products_favorited?: string[] | null
          products_viewed?: string[] | null
          search_queries?: string[] | null
          session_id?: string
          started_at?: string | null
          time_per_product?: Json | null
          time_to_conversion_seconds?: number | null
          total_searches?: number | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "search_sessions_detailed_conversion_package_id_fkey"
            columns: ["conversion_package_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_sessions_detailed_conversion_package_id_fkey"
            columns: ["conversion_package_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_sessions_detailed_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_sessions_detailed_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_sessions_detailed_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      secure_chats: {
        Row: {
          booking_id: string | null
          created_at: string
          filter_detail: string | null
          id: string
          is_filtered: boolean
          is_unmasked: boolean
          masked_message: string
          raw_message: string
          receiver_type: string
          rfq_id: string | null
          sender_id: string
          sender_type: string
          unmasked_at: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          filter_detail?: string | null
          id?: string
          is_filtered?: boolean
          is_unmasked?: boolean
          masked_message: string
          raw_message: string
          receiver_type: string
          rfq_id?: string | null
          sender_id: string
          sender_type: string
          unmasked_at?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          filter_detail?: string | null
          id?: string
          is_filtered?: boolean
          is_unmasked?: boolean
          masked_message?: string
          raw_message?: string
          receiver_type?: string
          rfq_id?: string | null
          sender_id?: string
          sender_type?: string
          unmasked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "secure_chats_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secure_chats_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secure_chats_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secure_chats_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "group_rfqs"
            referencedColumns: ["id"]
          },
        ]
      }
      serp_analysis: {
        Row: {
          avg_title_len: number | null
          bracket_rate: number | null
          entities: Json | null
          fetched_at: string
          keyword: string
          power_words: Json | null
          raw: Json | null
          recommended_title_pattern: string | null
          source: string
          year_inclusion_rate: number | null
        }
        Insert: {
          avg_title_len?: number | null
          bracket_rate?: number | null
          entities?: Json | null
          fetched_at?: string
          keyword: string
          power_words?: Json | null
          raw?: Json | null
          recommended_title_pattern?: string | null
          source: string
          year_inclusion_rate?: number | null
        }
        Update: {
          avg_title_len?: number | null
          bracket_rate?: number | null
          entities?: Json | null
          fetched_at?: string
          keyword?: string
          power_words?: Json | null
          raw?: Json | null
          recommended_title_pattern?: string | null
          source?: string
          year_inclusion_rate?: number | null
        }
        Relationships: []
      }
      serp_snapshots: {
        Row: {
          fetched_at: string
          id: number
          keyword: string
          rank: number
          snippet: string | null
          source: string
          title: string | null
          url: string | null
        }
        Insert: {
          fetched_at?: string
          id?: number
          keyword: string
          rank: number
          snippet?: string | null
          source: string
          title?: string | null
          url?: string | null
        }
        Update: {
          fetched_at?: string
          id?: number
          keyword?: string
          rank?: number
          snippet?: string | null
          source?: string
          title?: string | null
          url?: string | null
        }
        Relationships: []
      }
      settlements: {
        Row: {
          affiliate_id: string
          carryover_balance: number | null
          created_at: string | null
          final_payout: number | null
          final_total: number | null
          held_at: string | null
          hold_reason: string | null
          id: string
          pdf_url: string | null
          qualified_booking_count: number | null
          released_at: string | null
          settled_at: string | null
          settlement_period: string
          status: string | null
          tax_deduction: number | null
          tenant_id: string | null
          total_amount: number | null
        }
        Insert: {
          affiliate_id: string
          carryover_balance?: number | null
          created_at?: string | null
          final_payout?: number | null
          final_total?: number | null
          held_at?: string | null
          hold_reason?: string | null
          id?: string
          pdf_url?: string | null
          qualified_booking_count?: number | null
          released_at?: string | null
          settled_at?: string | null
          settlement_period: string
          status?: string | null
          tax_deduction?: number | null
          tenant_id?: string | null
          total_amount?: number | null
        }
        Update: {
          affiliate_id?: string
          carryover_balance?: number | null
          created_at?: string | null
          final_payout?: number | null
          final_total?: number | null
          held_at?: string | null
          hold_reason?: string | null
          id?: string
          pdf_url?: string | null
          qualified_booking_count?: number | null
          released_at?: string | null
          settled_at?: string | null
          settlement_period?: string
          status?: string | null
          tax_deduction?: number | null
          tenant_id?: string | null
          total_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "settlements_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "influencer_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_itineraries: {
        Row: {
          created_at: string
          creator_name: string
          expires_at: string
          id: string
          items: Json | null
          product_id: string | null
          product_name: string | null
          review_text: string | null
          search_query: string | null
          share_code: string
          share_type: string
          view_count: number
        }
        Insert: {
          created_at?: string
          creator_name?: string
          expires_at?: string
          id?: string
          items?: Json | null
          product_id?: string | null
          product_name?: string | null
          review_text?: string | null
          search_query?: string | null
          share_code: string
          share_type: string
          view_count?: number
        }
        Update: {
          created_at?: string
          creator_name?: string
          expires_at?: string
          id?: string
          items?: Json | null
          product_id?: string | null
          product_name?: string | null
          review_text?: string | null
          search_query?: string | null
          share_code?: string
          share_type?: string
          view_count?: number
        }
        Relationships: []
      }
      slack_raw_events: {
        Row: {
          channel_id: string | null
          created_at: string
          event_id: string | null
          extracted_text: string
          id: string
          last_parse_error: string | null
          message_ts: string | null
          parse_attempts: number
          parse_status: string
          parsed_at: string | null
          parsed_tx_count: number
          raw_payload: Json
          received_at: string
          slack_message_at: string | null
          source: string
          updated_at: string
        }
        Insert: {
          channel_id?: string | null
          created_at?: string
          event_id?: string | null
          extracted_text: string
          id?: string
          last_parse_error?: string | null
          message_ts?: string | null
          parse_attempts?: number
          parse_status?: string
          parsed_at?: string | null
          parsed_tx_count?: number
          raw_payload: Json
          received_at?: string
          slack_message_at?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          channel_id?: string | null
          created_at?: string
          event_id?: string | null
          extracted_text?: string
          id?: string
          last_parse_error?: string | null
          message_ts?: string | null
          parse_attempts?: number
          parse_status?: string
          parsed_at?: string | null
          parsed_tx_count?: number
          raw_payload?: Json
          received_at?: string
          slack_message_at?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      sms_payments: {
        Row: {
          amount: number | null
          booking_id: string | null
          created_at: string | null
          id: string
          match_confidence: number | null
          raw_sms: string
          received_at: string | null
          sender_name: string | null
          source: string | null
          status: string | null
        }
        Insert: {
          amount?: number | null
          booking_id?: string | null
          created_at?: string | null
          id?: string
          match_confidence?: number | null
          raw_sms: string
          received_at?: string | null
          sender_name?: string | null
          source?: string | null
          status?: string | null
        }
        Update: {
          amount?: number | null
          booking_id?: string | null
          created_at?: string | null
          id?: string
          match_confidence?: number | null
          raw_sms?: string
          received_at?: string | null
          sender_name?: string | null
          source?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
        ]
      }
      social_webhook_events: {
        Row: {
          event_type: string | null
          external_id: string | null
          id: string
          platform: string
          processed: boolean
          processing_error: string | null
          raw_payload: Json
          received_at: string
          tenant_id: string | null
        }
        Insert: {
          event_type?: string | null
          external_id?: string | null
          id?: string
          platform: string
          processed?: boolean
          processing_error?: string | null
          raw_payload: Json
          received_at?: string
          tenant_id?: string | null
        }
        Update: {
          event_type?: string | null
          external_id?: string | null
          id?: string
          platform?: string
          processed?: boolean
          processing_error?: string | null
          raw_payload?: Json
          received_at?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_webhook_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_communications: {
        Row: {
          booking_id: string | null
          communication_type: string | null
          content: string | null
          created_at: string | null
          direction: string | null
          id: string
          resolution_notes: string | null
          resolved: boolean | null
          resolved_at: string | null
          response_time_hours: number | null
          subject: string | null
          supplier_id: string
        }
        Insert: {
          booking_id?: string | null
          communication_type?: string | null
          content?: string | null
          created_at?: string | null
          direction?: string | null
          id?: string
          resolution_notes?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          response_time_hours?: number | null
          subject?: string | null
          supplier_id: string
        }
        Update: {
          booking_id?: string | null
          communication_type?: string | null
          content?: string | null
          created_at?: string | null
          direction?: string | null
          id?: string
          resolution_notes?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          response_time_hours?: number | null
          subject?: string | null
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_communications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_communications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_communications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_communications_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier_rankings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_communications_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_inventory: {
        Row: {
          available_quantity: number | null
          blocked_quantity: number | null
          booking_deadline: string | null
          cancellation_policy: string | null
          cost_price: number | null
          destination: string | null
          id: string
          is_available: boolean | null
          minimum_quantity: number | null
          product_name: string | null
          product_type: string | null
          rack_rate: number | null
          reserved_quantity: number | null
          retail_price: number | null
          service_date: string | null
          service_name: string | null
          service_type: string | null
          status: string | null
          supplier_id: string
          supplier_product_code: string | null
          total_quantity: number | null
          updated_at: string | null
        }
        Insert: {
          available_quantity?: number | null
          blocked_quantity?: number | null
          booking_deadline?: string | null
          cancellation_policy?: string | null
          cost_price?: number | null
          destination?: string | null
          id?: string
          is_available?: boolean | null
          minimum_quantity?: number | null
          product_name?: string | null
          product_type?: string | null
          rack_rate?: number | null
          reserved_quantity?: number | null
          retail_price?: number | null
          service_date?: string | null
          service_name?: string | null
          service_type?: string | null
          status?: string | null
          supplier_id: string
          supplier_product_code?: string | null
          total_quantity?: number | null
          updated_at?: string | null
        }
        Update: {
          available_quantity?: number | null
          blocked_quantity?: number | null
          booking_deadline?: string | null
          cancellation_policy?: string | null
          cost_price?: number | null
          destination?: string | null
          id?: string
          is_available?: boolean | null
          minimum_quantity?: number | null
          product_name?: string | null
          product_type?: string | null
          rack_rate?: number | null
          reserved_quantity?: number | null
          retail_price?: number | null
          service_date?: string | null
          service_name?: string | null
          service_type?: string | null
          status?: string | null
          supplier_id?: string
          supplier_product_code?: string | null
          total_quantity?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_inventory_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier_rankings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_inventory_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_performance: {
        Row: {
          accuracy_rate: number | null
          average_rating: number | null
          avg_confirmation_time_hours: number | null
          avg_response_time_hours: number | null
          calculated_at: string | null
          cancellation_rate: number | null
          cancelled_bookings: number | null
          commission_paid: number | null
          complaint_count: number | null
          compliment_count: number | null
          confirmed_bookings: number | null
          confirmed_rate: number | null
          gross_margin: number | null
          id: string
          on_time_delivery_rate: number | null
          period_end: string
          period_start: string
          supplier_id: string
          total_bookings: number | null
          total_cost: number | null
          total_revenue: number | null
          total_reviews: number | null
        }
        Insert: {
          accuracy_rate?: number | null
          average_rating?: number | null
          avg_confirmation_time_hours?: number | null
          avg_response_time_hours?: number | null
          calculated_at?: string | null
          cancellation_rate?: number | null
          cancelled_bookings?: number | null
          commission_paid?: number | null
          complaint_count?: number | null
          compliment_count?: number | null
          confirmed_bookings?: number | null
          confirmed_rate?: number | null
          gross_margin?: number | null
          id?: string
          on_time_delivery_rate?: number | null
          period_end: string
          period_start: string
          supplier_id: string
          total_bookings?: number | null
          total_cost?: number | null
          total_revenue?: number | null
          total_reviews?: number | null
        }
        Update: {
          accuracy_rate?: number | null
          average_rating?: number | null
          avg_confirmation_time_hours?: number | null
          avg_response_time_hours?: number | null
          calculated_at?: string | null
          cancellation_rate?: number | null
          cancelled_bookings?: number | null
          commission_paid?: number | null
          complaint_count?: number | null
          compliment_count?: number | null
          confirmed_bookings?: number | null
          confirmed_rate?: number | null
          gross_margin?: number | null
          id?: string
          on_time_delivery_rate?: number | null
          period_end?: string
          period_start?: string
          supplier_id?: string
          total_bookings?: number | null
          total_cost?: number | null
          total_revenue?: number | null
          total_reviews?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_performance_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier_rankings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_performance_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          category: string | null
          commission_rate: number | null
          contact_person: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          contract_terms: Json | null
          country: string | null
          created_at: string | null
          email: string | null
          id: string
          last_transaction_at: string | null
          name: string
          notes: string | null
          outstanding_balance: number | null
          payment_cycle: string | null
          payment_terms: string | null
          phone: string | null
          preferred_supplier: boolean | null
          quality_score: number | null
          rating: number | null
          region: string | null
          reliability_score: number | null
          response_time_hours: number | null
          status: string | null
          total_commission_paid: number | null
          total_transactions: number | null
          total_volume: number | null
          type: string
          updated_at: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          category?: string | null
          commission_rate?: number | null
          contact_person?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          contract_terms?: Json | null
          country?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          last_transaction_at?: string | null
          name: string
          notes?: string | null
          outstanding_balance?: number | null
          payment_cycle?: string | null
          payment_terms?: string | null
          phone?: string | null
          preferred_supplier?: boolean | null
          quality_score?: number | null
          rating?: number | null
          region?: string | null
          reliability_score?: number | null
          response_time_hours?: number | null
          status?: string | null
          total_commission_paid?: number | null
          total_transactions?: number | null
          total_volume?: number | null
          type: string
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          category?: string | null
          commission_rate?: number | null
          contact_person?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          contract_terms?: Json | null
          country?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          last_transaction_at?: string | null
          name?: string
          notes?: string | null
          outstanding_balance?: number | null
          payment_cycle?: string | null
          payment_terms?: string | null
          phone?: string | null
          preferred_supplier?: boolean | null
          quality_score?: number | null
          rating?: number | null
          region?: string | null
          reliability_score?: number | null
          response_time_hours?: number | null
          status?: string | null
          total_commission_paid?: number | null
          total_transactions?: number | null
          total_volume?: number | null
          type?: string
          updated_at?: string | null
          website?: string | null
        }
        Relationships: []
      }
      surcharge_dates: {
        Row: {
          amount: number
          description: string | null
          id: string
          parsed_package_id: string | null
          surcharge_date: string
        }
        Insert: {
          amount: number
          description?: string | null
          id?: string
          parsed_package_id?: string | null
          surcharge_date: string
        }
        Update: {
          amount?: number
          description?: string | null
          id?: string
          parsed_package_id?: string | null
          surcharge_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "surcharge_dates_parsed_package_id_fkey"
            columns: ["parsed_package_id"]
            isOneToOne: false
            referencedRelation: "parsed_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      system_secrets: {
        Row: {
          created_at: string
          expires_at: string | null
          key: string
          notes: string | null
          tenant_id: string | null
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          key: string
          notes?: string | null
          tenant_id?: string | null
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          key?: string
          notes?: string | null
          tenant_id?: string | null
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_secrets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_bot_profiles: {
        Row: {
          allowed_agents: string[]
          allowed_tools: string[] | null
          bot_name: string
          branding: Json
          created_at: string | null
          greeting: string | null
          guardrails: Json
          id: string
          is_active: boolean
          knowledge_scope: Json
          monthly_token_quota: number
          persona_prompt: string | null
          rate_limit_per_min: number | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          allowed_agents?: string[]
          allowed_tools?: string[] | null
          bot_name: string
          branding?: Json
          created_at?: string | null
          greeting?: string | null
          guardrails?: Json
          id?: string
          is_active?: boolean
          knowledge_scope?: Json
          monthly_token_quota?: number
          persona_prompt?: string | null
          rate_limit_per_min?: number | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          allowed_agents?: string[]
          allowed_tools?: string[] | null
          bot_name?: string
          branding?: Json
          created_at?: string | null
          greeting?: string | null
          guardrails?: Json
          id?: string
          is_active?: boolean
          knowledge_scope?: Json
          monthly_token_quota?: number
          persona_prompt?: string | null
          rate_limit_per_min?: number | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_bot_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          commission_rate: number | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          reliability_score: number
          status: string | null
          tier: string
          updated_at: string | null
        }
        Insert: {
          commission_rate?: number | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          reliability_score?: number
          status?: string | null
          tier?: string
          updated_at?: string | null
        }
        Update: {
          commission_rate?: number | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          reliability_score?: number
          status?: string | null
          tier?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      terms_templates: {
        Row: {
          created_at: string
          ends_at: string | null
          id: string
          is_active: boolean
          is_current: boolean
          name: string
          notes: string | null
          notices: Json
          priority: number
          scope: Json
          starts_at: string
          tier: number
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          is_current?: boolean
          name: string
          notes?: string | null
          notices?: Json
          priority?: number
          scope?: Json
          starts_at?: string
          tier: number
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          is_current?: boolean
          name?: string
          notes?: string | null
          notices?: Json
          priority?: number
          scope?: Json
          starts_at?: string
          tier?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      topical_clusters: {
        Row: {
          cluster_slug: string
          destination: string
          established_at: string
          id: number
          pillar_slug: string
          rank: number
          relation_type: string
        }
        Insert: {
          cluster_slug: string
          destination: string
          established_at?: string
          id?: number
          pillar_slug: string
          rank?: number
          relation_type?: string
        }
        Update: {
          cluster_slug?: string
          destination?: string
          established_at?: string
          id?: number
          pillar_slug?: string
          rank?: number
          relation_type?: string
        }
        Relationships: []
      }
      tour_blocks: {
        Row: {
          attraction_ids: string[] | null
          block_code: string
          block_type: string
          created_at: string | null
          default_meals: Json | null
          destination_id: string
          duration: string
          id: string
          is_active: boolean | null
          is_optional: boolean | null
          keywords: string[] | null
          name: string
          option_price_usd: number | null
          quality_score: number | null
          schedule: Json
          typical_day_position: string | null
          updated_at: string | null
        }
        Insert: {
          attraction_ids?: string[] | null
          block_code: string
          block_type?: string
          created_at?: string | null
          default_meals?: Json | null
          destination_id: string
          duration?: string
          id?: string
          is_active?: boolean | null
          is_optional?: boolean | null
          keywords?: string[] | null
          name: string
          option_price_usd?: number | null
          quality_score?: number | null
          schedule?: Json
          typical_day_position?: string | null
          updated_at?: string | null
        }
        Update: {
          attraction_ids?: string[] | null
          block_code?: string
          block_type?: string
          created_at?: string | null
          default_meals?: Json | null
          destination_id?: string
          duration?: string
          id?: string
          is_active?: boolean | null
          is_optional?: boolean | null
          keywords?: string[] | null
          name?: string
          option_price_usd?: number | null
          quality_score?: number | null
          schedule?: Json
          typical_day_position?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tour_blocks_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destination_masters"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          created_at: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          id: string
          idempotency_key: string
          net_margin: number | null
          saga_log: Json
          session_id: string
          status: string
          tenant_cost_breakdown: Json | null
          total_cost: number
          total_price: number
          updated_at: string | null
          vouchers: Json | null
        }
        Insert: {
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          idempotency_key: string
          net_margin?: number | null
          saga_log?: Json
          session_id: string
          status?: string
          tenant_cost_breakdown?: Json | null
          total_cost?: number
          total_price?: number
          updated_at?: string | null
          vouchers?: Json | null
        }
        Update: {
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          idempotency_key?: string
          net_margin?: number | null
          saga_log?: Json
          session_id?: string
          status?: string
          tenant_cost_breakdown?: Json | null
          total_cost?: number
          total_price?: number
          updated_at?: string | null
          vouchers?: Json | null
        }
        Relationships: []
      }
      travel_packages: {
        Row: {
          accommodations: string[] | null
          affiliate_commission_rate: number
          agent_audit_report: Json | null
          airline: string | null
          audit_checked_at: string | null
          audit_report: Json | null
          audit_status: string | null
          avg_rating: number | null
          baseline_created_at: string | null
          baseline_requested_at: string | null
          cancellation_policy: Json | null
          category: string | null
          category_attrs: Json | null
          commission_currency: string | null
          commission_fixed_amount: number | null
          commission_rate: number | null
          confidence: number | null
          confirmed_dates: Json | null
          cost_price: number | null
          country: string | null
          created_at: string | null
          created_by: string | null
          customer_notes: string | null
          data_completeness: number | null
          departing_location_id: string | null
          departure_airport: string | null
          departure_days: string | null
          destination: string | null
          display_title: string | null
          duration: number | null
          embedding: string | null
          excluded_dates: string[] | null
          excludes: string[] | null
          field_confidences: Json | null
          file_type: string | null
          filename: string | null
          guide_tip: string | null
          hero_tagline: string | null
          highlights_md: string | null
          id: string
          inclusions: string[] | null
          inquiry_count: number | null
          internal_code: string | null
          internal_notes: string | null
          is_airtel: boolean | null
          is_stub: boolean
          itinerary: string[] | null
          itinerary_data: Json | null
          itinerary_md: string | null
          land_operator: string | null
          land_operator_id: string | null
          marketing_copies: Json | null
          min_participants: number | null
          nights: number | null
          normalized_surcharges: Json | null
          notes: string | null
          notices_parsed: Json | null
          optional_tours: Json | null
          parsed_at: string | null
          parsed_data: Json | null
          parser_version: string | null
          price: number | null
          price_dates: Json | null
          price_list: Json | null
          price_tiers: Json | null
          product_highlights: string[] | null
          product_summary: string | null
          product_tags: string[] | null
          product_type: string | null
          raw_text: string | null
          raw_text_hash: string | null
          review_count: number
          seats_confirmed: number | null
          seats_held: number | null
          seats_ticketed: number | null
          short_code: string | null
          single_supplement: string | null
          small_group_surcharge: string | null
          special_notes: string | null
          status: string | null
          structured_features: Json | null
          stub_source: string | null
          surcharges: Json | null
          tenant_id: string | null
          terms_md: string | null
          ticketing_deadline: string | null
          title: string
          trip_style: string | null
          updated_at: string | null
          usd_cost: number | null
          view_count: number | null
        }
        Insert: {
          accommodations?: string[] | null
          affiliate_commission_rate?: number
          agent_audit_report?: Json | null
          airline?: string | null
          audit_checked_at?: string | null
          audit_report?: Json | null
          audit_status?: string | null
          avg_rating?: number | null
          baseline_created_at?: string | null
          baseline_requested_at?: string | null
          cancellation_policy?: Json | null
          category?: string | null
          category_attrs?: Json | null
          commission_currency?: string | null
          commission_fixed_amount?: number | null
          commission_rate?: number | null
          confidence?: number | null
          confirmed_dates?: Json | null
          cost_price?: number | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_notes?: string | null
          data_completeness?: number | null
          departing_location_id?: string | null
          departure_airport?: string | null
          departure_days?: string | null
          destination?: string | null
          display_title?: string | null
          duration?: number | null
          embedding?: string | null
          excluded_dates?: string[] | null
          excludes?: string[] | null
          field_confidences?: Json | null
          file_type?: string | null
          filename?: string | null
          guide_tip?: string | null
          hero_tagline?: string | null
          highlights_md?: string | null
          id?: string
          inclusions?: string[] | null
          inquiry_count?: number | null
          internal_code?: string | null
          internal_notes?: string | null
          is_airtel?: boolean | null
          is_stub?: boolean
          itinerary?: string[] | null
          itinerary_data?: Json | null
          itinerary_md?: string | null
          land_operator?: string | null
          land_operator_id?: string | null
          marketing_copies?: Json | null
          min_participants?: number | null
          nights?: number | null
          normalized_surcharges?: Json | null
          notes?: string | null
          notices_parsed?: Json | null
          optional_tours?: Json | null
          parsed_at?: string | null
          parsed_data?: Json | null
          parser_version?: string | null
          price?: number | null
          price_dates?: Json | null
          price_list?: Json | null
          price_tiers?: Json | null
          product_highlights?: string[] | null
          product_summary?: string | null
          product_tags?: string[] | null
          product_type?: string | null
          raw_text?: string | null
          raw_text_hash?: string | null
          review_count?: number
          seats_confirmed?: number | null
          seats_held?: number | null
          seats_ticketed?: number | null
          short_code?: string | null
          single_supplement?: string | null
          small_group_surcharge?: string | null
          special_notes?: string | null
          status?: string | null
          structured_features?: Json | null
          stub_source?: string | null
          surcharges?: Json | null
          tenant_id?: string | null
          terms_md?: string | null
          ticketing_deadline?: string | null
          title: string
          trip_style?: string | null
          updated_at?: string | null
          usd_cost?: number | null
          view_count?: number | null
        }
        Update: {
          accommodations?: string[] | null
          affiliate_commission_rate?: number
          agent_audit_report?: Json | null
          airline?: string | null
          audit_checked_at?: string | null
          audit_report?: Json | null
          audit_status?: string | null
          avg_rating?: number | null
          baseline_created_at?: string | null
          baseline_requested_at?: string | null
          cancellation_policy?: Json | null
          category?: string | null
          category_attrs?: Json | null
          commission_currency?: string | null
          commission_fixed_amount?: number | null
          commission_rate?: number | null
          confidence?: number | null
          confirmed_dates?: Json | null
          cost_price?: number | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_notes?: string | null
          data_completeness?: number | null
          departing_location_id?: string | null
          departure_airport?: string | null
          departure_days?: string | null
          destination?: string | null
          display_title?: string | null
          duration?: number | null
          embedding?: string | null
          excluded_dates?: string[] | null
          excludes?: string[] | null
          field_confidences?: Json | null
          file_type?: string | null
          filename?: string | null
          guide_tip?: string | null
          hero_tagline?: string | null
          highlights_md?: string | null
          id?: string
          inclusions?: string[] | null
          inquiry_count?: number | null
          internal_code?: string | null
          internal_notes?: string | null
          is_airtel?: boolean | null
          is_stub?: boolean
          itinerary?: string[] | null
          itinerary_data?: Json | null
          itinerary_md?: string | null
          land_operator?: string | null
          land_operator_id?: string | null
          marketing_copies?: Json | null
          min_participants?: number | null
          nights?: number | null
          normalized_surcharges?: Json | null
          notes?: string | null
          notices_parsed?: Json | null
          optional_tours?: Json | null
          parsed_at?: string | null
          parsed_data?: Json | null
          parser_version?: string | null
          price?: number | null
          price_dates?: Json | null
          price_list?: Json | null
          price_tiers?: Json | null
          product_highlights?: string[] | null
          product_summary?: string | null
          product_tags?: string[] | null
          product_type?: string | null
          raw_text?: string | null
          raw_text_hash?: string | null
          review_count?: number
          seats_confirmed?: number | null
          seats_held?: number | null
          seats_ticketed?: number | null
          short_code?: string | null
          single_supplement?: string | null
          small_group_surcharge?: string | null
          special_notes?: string | null
          status?: string | null
          structured_features?: Json | null
          stub_source?: string | null
          surcharges?: Json | null
          tenant_id?: string | null
          terms_md?: string | null
          ticketing_deadline?: string | null
          title?: string
          trip_style?: string | null
          updated_at?: string | null
          usd_cost?: number | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "travel_packages_departing_location_id_fkey"
            columns: ["departing_location_id"]
            isOneToOne: false
            referencedRelation: "departing_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travel_packages_internal_code_fkey"
            columns: ["internal_code"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["internal_code"]
          },
          {
            foreignKeyName: "travel_packages_land_operator_id_fkey"
            columns: ["land_operator_id"]
            isOneToOne: false
            referencedRelation: "land_operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travel_packages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      trend_keyword_archive: {
        Row: {
          competition_level: string | null
          id: string
          keyword: string
          observed_at: string
          raw: Json | null
          related_destination: string | null
          search_volume: number | null
          source: string
          topic_queue_id: string | null
          trend_score: number | null
          used_at: string | null
        }
        Insert: {
          competition_level?: string | null
          id?: string
          keyword: string
          observed_at?: string
          raw?: Json | null
          related_destination?: string | null
          search_volume?: number | null
          source: string
          topic_queue_id?: string | null
          trend_score?: number | null
          used_at?: string | null
        }
        Update: {
          competition_level?: string | null
          id?: string
          keyword?: string
          observed_at?: string
          raw?: Json | null
          related_destination?: string | null
          search_volume?: number | null
          source?: string
          topic_queue_id?: string | null
          trend_score?: number | null
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trend_keyword_archive_topic_queue_id_fkey"
            columns: ["topic_queue_id"]
            isOneToOne: false
            referencedRelation: "blog_topic_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      unmatched_activities: {
        Row: {
          activity: string
          confidence: number | null
          country: string | null
          created_at: string | null
          day_number: number | null
          id: string
          intake_id: string | null
          normalizer_version: string | null
          occurrence_count: number | null
          package_id: string | null
          package_title: string | null
          raw_label: string | null
          region: string | null
          resolved_at: string | null
          resolved_attraction_id: string | null
          resolved_by: string | null
          resolved_kind: string | null
          segment_index: number | null
          segment_kind_guess: string | null
          status: string | null
        }
        Insert: {
          activity: string
          confidence?: number | null
          country?: string | null
          created_at?: string | null
          day_number?: number | null
          id?: string
          intake_id?: string | null
          normalizer_version?: string | null
          occurrence_count?: number | null
          package_id?: string | null
          package_title?: string | null
          raw_label?: string | null
          region?: string | null
          resolved_at?: string | null
          resolved_attraction_id?: string | null
          resolved_by?: string | null
          resolved_kind?: string | null
          segment_index?: number | null
          segment_kind_guess?: string | null
          status?: string | null
        }
        Update: {
          activity?: string
          confidence?: number | null
          country?: string | null
          created_at?: string | null
          day_number?: number | null
          id?: string
          intake_id?: string | null
          normalizer_version?: string | null
          occurrence_count?: number | null
          package_id?: string | null
          package_title?: string | null
          raw_label?: string | null
          region?: string | null
          resolved_at?: string | null
          resolved_attraction_id?: string | null
          resolved_by?: string | null
          resolved_kind?: string | null
          segment_index?: number | null
          segment_kind_guess?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unmatched_activities_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "normalized_intakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unmatched_activities_resolved_attraction_id_fkey"
            columns: ["resolved_attraction_id"]
            isOneToOne: false
            referencedRelation: "attractions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_actions: {
        Row: {
          action_type: string
          context: Json | null
          copy_to_clipboard_text: string | null
          created_at: string | null
          customer_id: string | null
          dwell_time_ms: number | null
          id: string
          idle_time_seconds: number | null
          mouse_movement_distance_px: number | null
          rage_click_count: number | null
          scroll_depth_percent: number | null
          session_id: string | null
          target_id: string | null
        }
        Insert: {
          action_type: string
          context?: Json | null
          copy_to_clipboard_text?: string | null
          created_at?: string | null
          customer_id?: string | null
          dwell_time_ms?: number | null
          id?: string
          idle_time_seconds?: number | null
          mouse_movement_distance_px?: number | null
          rage_click_count?: number | null
          scroll_depth_percent?: number | null
          session_id?: string | null
          target_id?: string | null
        }
        Update: {
          action_type?: string
          context?: Json | null
          copy_to_clipboard_text?: string | null
          created_at?: string | null
          customer_id?: string | null
          dwell_time_ms?: number | null
          id?: string
          idle_time_seconds?: number | null
          mouse_movement_distance_px?: number | null
          rage_click_count?: number | null
          scroll_depth_percent?: number | null
          session_id?: string | null
          target_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      vouchers: {
        Row: {
          booking_id: string | null
          created_at: string
          customer_id: string | null
          end_date: string | null
          id: string
          issued_at: string | null
          land_agency_id: string | null
          parsed_data: Json
          pdf_url: string | null
          review_notified: boolean
          rfq_id: string | null
          sent_at: string | null
          status: string
          updated_at: string
          upsell_data: Json
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          customer_id?: string | null
          end_date?: string | null
          id?: string
          issued_at?: string | null
          land_agency_id?: string | null
          parsed_data?: Json
          pdf_url?: string | null
          review_notified?: boolean
          rfq_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          upsell_data?: Json
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          customer_id?: string | null
          end_date?: string | null
          id?: string
          issued_at?: string | null
          land_agency_id?: string | null
          parsed_data?: Json
          pdf_url?: string | null
          review_notified?: boolean
          rfq_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          upsell_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "vouchers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_settlement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "v_bookings_kpi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_land_agency_id_fkey"
            columns: ["land_agency_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "group_rfqs"
            referencedColumns: ["id"]
          },
        ]
      }
      winning_patterns: {
        Row: {
          avg_conv_rate: number | null
          avg_ctr: number | null
          avg_roas: number | null
          best_body: string | null
          best_headline: string | null
          best_hook_example: string | null
          channel: string | null
          confidence_score: number | null
          created_at: string | null
          creative_type: string | null
          destination_type: string | null
          hook_type: string | null
          id: string
          key_selling_point: string | null
          nights_range: string | null
          price_range: string | null
          sample_count: number | null
          target_segment: string | null
          tone: string | null
          total_spend: number | null
          updated_at: string | null
        }
        Insert: {
          avg_conv_rate?: number | null
          avg_ctr?: number | null
          avg_roas?: number | null
          best_body?: string | null
          best_headline?: string | null
          best_hook_example?: string | null
          channel?: string | null
          confidence_score?: number | null
          created_at?: string | null
          creative_type?: string | null
          destination_type?: string | null
          hook_type?: string | null
          id?: string
          key_selling_point?: string | null
          nights_range?: string | null
          price_range?: string | null
          sample_count?: number | null
          target_segment?: string | null
          tone?: string | null
          total_spend?: number | null
          updated_at?: string | null
        }
        Update: {
          avg_conv_rate?: number | null
          avg_ctr?: number | null
          avg_roas?: number | null
          best_body?: string | null
          best_headline?: string | null
          best_hook_example?: string | null
          channel?: string | null
          confidence_score?: number | null
          created_at?: string | null
          creative_type?: string | null
          destination_type?: string | null
          hook_type?: string | null
          id?: string
          key_selling_point?: string | null
          nights_range?: string | null
          price_range?: string | null
          sample_count?: number | null
          target_segment?: string | null
          tone?: string | null
          total_spend?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      active_destinations: {
        Row: {
          avg_rating: number | null
          destination: string | null
          min_price: number | null
          package_count: number | null
          total_reviews: number | null
        }
        Relationships: []
      }
      at_risk_customers: {
        Row: {
          avg_rating: number | null
          churn_propensity: string | null
          churn_risk_level: string | null
          days_since_last_booking: number | null
          email: string | null
          id: string | null
          name: string | null
          past_bookings: number | null
          phone: string | null
          rfm_f: number | null
          rfm_m: number | null
          rfm_r: number | null
          rfm_segment: string | null
          total_revenue: number | null
        }
        Relationships: []
      }
      bank_tx_health: {
        Row: {
          dead_raw_events: number | null
          error_count: number | null
          failed_raw_events: number | null
          last_bank_tx_at: string | null
          last_slack_event_at: string | null
          pending_raw_events: number | null
          review_count: number | null
          stale_over_24h: number | null
          unmatched_count: number | null
        }
        Relationships: []
      }
      best_publish_slots: {
        Row: {
          avg_engagement: number | null
          avg_reach: number | null
          confidence_adjusted_score: number | null
          dow: number | null
          hour: number | null
          platform: string | null
          sample_count: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_engagement_snapshots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_performance_view: {
        Row: {
          ai_model: string | null
          angle_type: string | null
          avg_scroll_depth: number | null
          avg_search_position: number | null
          avg_time_on_page: number | null
          cta_click_rate: number | null
          engagement_count: number | null
          first_touch_conversions: number | null
          first_touch_revenue: number | null
          id: string | null
          product_id: string | null
          prompt_version: string | null
          published_at: string | null
          seo_title: string | null
          slug: string | null
          sub_keyword: string | null
          total_clicks: number | null
          total_impressions: number | null
          traffic_count: number | null
        }
        Insert: {
          ai_model?: string | null
          angle_type?: string | null
          avg_scroll_depth?: never
          avg_search_position?: never
          avg_time_on_page?: never
          cta_click_rate?: never
          engagement_count?: never
          first_touch_conversions?: never
          first_touch_revenue?: never
          id?: string | null
          product_id?: string | null
          prompt_version?: string | null
          published_at?: string | null
          seo_title?: string | null
          slug?: string | null
          sub_keyword?: string | null
          total_clicks?: never
          total_impressions?: never
          traffic_count?: never
        }
        Update: {
          ai_model?: string | null
          angle_type?: string | null
          avg_scroll_depth?: never
          avg_search_position?: never
          avg_time_on_page?: never
          cta_click_rate?: never
          engagement_count?: never
          first_touch_conversions?: never
          first_touch_revenue?: never
          id?: string | null
          product_id?: string | null
          prompt_version?: string | null
          published_at?: string | null
          seo_title?: string | null
          slug?: string | null
          sub_keyword?: string | null
          total_clicks?: never
          total_impressions?: never
          traffic_count?: never
        }
        Relationships: [
          {
            foreignKeyName: "content_creatives_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_creatives_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_settlement: {
        Row: {
          booking_no: string | null
          customer_name: string | null
          departure_date: string | null
          id: string | null
          package_title: string | null
          payment_status: string | null
          status: string | null
          미수금: number | null
          수수료합계: number | null
          순이익: number | null
          원가: number | null
          초과지급액: number | null
          총입금액: number | null
          총출금액: number | null
          판매가: number | null
        }
        Relationships: []
      }
      booking_tasks_health: {
        Row: {
          auto_resolved_last_24h: number | null
          high_open: number | null
          last_task_at: string | null
          low_open: number | null
          manually_resolved_last_24h: number | null
          normal_open: number | null
          snoozed_count: number | null
          stale_over_48h: number | null
          total_open: number | null
          urgent_open: number | null
        }
        Relationships: []
      }
      campaign_roi_dashboard: {
        Row: {
          budget: number | null
          channels: string[] | null
          clicks: number | null
          conversions: number | null
          cpa: number | null
          cpc: number | null
          ctr: number | null
          end_date: string | null
          id: string | null
          impressions: number | null
          name: string | null
          remaining: number | null
          revenue: number | null
          roas: number | null
          roi_percent: number | null
          spent: number | null
          start_date: string | null
          status: string | null
          type: string | null
        }
        Insert: {
          budget?: number | null
          channels?: string[] | null
          clicks?: number | null
          conversions?: number | null
          cpa?: number | null
          cpc?: number | null
          ctr?: number | null
          end_date?: string | null
          id?: string | null
          impressions?: number | null
          name?: string | null
          remaining?: number | null
          revenue?: number | null
          roas?: number | null
          roi_percent?: never
          spent?: number | null
          start_date?: string | null
          status?: string | null
          type?: string | null
        }
        Update: {
          budget?: number | null
          channels?: string[] | null
          clicks?: number | null
          conversions?: number | null
          cpa?: number | null
          cpc?: number | null
          ctr?: number | null
          end_date?: string | null
          id?: string | null
          impressions?: number | null
          name?: string | null
          remaining?: number | null
          revenue?: number | null
          roas?: number | null
          roi_percent?: never
          spent?: number | null
          start_date?: string | null
          status?: string | null
          type?: string | null
        }
        Relationships: []
      }
      content_roas_summary: {
        Row: {
          angle_type: string | null
          creative_id: string | null
          destination: string | null
          first_touch_conversions: number | null
          first_touch_cost: number | null
          first_touch_profit: number | null
          first_touch_revenue: number | null
          last_touch_conversions: number | null
          last_touch_revenue: number | null
          package_title: string | null
          product_id: string | null
          published_at: string | null
          seo_title: string | null
          slug: string | null
          traffic_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_creatives_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_performance_dashboard"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_creatives_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "travel_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_funnel: {
        Row: {
          chatted: number | null
          click_to_booking_rate: number | null
          clicked: number | null
          converted: number | null
          inquired: number | null
          overall_conversion_rate: number | null
          search_to_click_rate: number | null
          searched: number | null
          total_sessions: number | null
        }
        Relationships: []
      }
      cron_health: {
        Row: {
          cron_name: string | null
          last_elapsed_ms: number | null
          last_error_count: number | null
          last_run_at: string | null
          last_status: string | null
          last_summary: Json | null
        }
        Relationships: []
      }
      customer_mileage_balances: {
        Row: {
          balance: number | null
          last_transaction_at: string | null
          total_clawback: number | null
          total_earned: number | null
          total_used: number | null
          transaction_count: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mileage_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "at_risk_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "high_value_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      high_value_customers: {
        Row: {
          avg_rating: number | null
          days_since_last_booking: number | null
          email: string | null
          engagement_score: number | null
          id: string | null
          last_booking_date: string | null
          lifecycle_stage: string | null
          ltv_estimate: number | null
          name: string | null
          next_best_action: string | null
          phone: string | null
          propensity_to_book: string | null
          rfm_f: number | null
          rfm_m: number | null
          rfm_r: number | null
          rfm_segment: string | null
          source: string | null
          total_bookings: number | null
          total_spent: number | null
        }
        Relationships: []
      }
      influencer_performance: {
        Row: {
          commission_rate: number | null
          conversion_rate: number | null
          grade: number | null
          id: string | null
          is_active: boolean | null
          last_booking_date: string | null
          name: string | null
          referral_code: string | null
          total_bookings: number | null
          total_commission: number | null
          total_referrals: number | null
          total_revenue: number | null
        }
        Relationships: []
      }
      jarvis_monthly_usage: {
        Row: {
          avg_latency_ms: number | null
          cache_read_tokens: number | null
          call_count: number | null
          input_tokens: number | null
          max_latency_ms: number | null
          month: string | null
          output_tokens: number | null
          tenant_id: string | null
          total_cost_usd: number | null
          total_tokens: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jarvis_cost_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ktkg_pool_candidates: {
        Row: {
          aspect: string | null
          demographic: string | null
          entity_norm: string | null
          entity_type: string | null
          first_seen: string | null
          last_seen: string | null
          mean_sentiment: number | null
          n: number | null
          sd_sentiment: number | null
          tenant_diversity: number | null
        }
        Relationships: []
      }
      post_engagement_current: {
        Row: {
          captured_at: string | null
          card_news_id: string | null
          clicks: number | null
          comments: number | null
          ctr: number | null
          distribution_id: string | null
          external_id: string | null
          likes: number | null
          performance_score: number | null
          platform: string | null
          quotes: number | null
          reach: number | null
          replies: number | null
          reposts: number | null
          saves: number | null
          shares: number | null
          spend: number | null
          views: number | null
        }
        Relationships: [
          {
            foreignKeyName: "post_engagement_snapshots_card_news_id_fkey"
            columns: ["card_news_id"]
            isOneToOne: false
            referencedRelation: "card_news"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_engagement_snapshots_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "content_distributions"
            referencedColumns: ["id"]
          },
        ]
      }
      product_performance_dashboard: {
        Row: {
          avg_rating: number | null
          conversion_rate: number | null
          destination: string | null
          duration: number | null
          id: string | null
          inquiry_count: number | null
          inquiry_rate: number | null
          nights: number | null
          price: number | null
          recommendation_rate: number | null
          review_count: number | null
          status: string | null
          title: string | null
          total_bookings: number | null
          total_revenue: number | null
          view_count: number | null
        }
        Relationships: []
      }
      supplier_rankings: {
        Row: {
          active_inventory_count: number | null
          avg_confirmed_rate: number | null
          avg_margin_percent: number | null
          avg_rating: number | null
          id: string | null
          name: string | null
          quality_score: number | null
          rating: number | null
          reliability_score: number | null
          status: string | null
          total_revenue: number | null
          type: string | null
        }
        Relationships: []
      }
      v_bookings_kpi: {
        Row: {
          affiliate_id: string | null
          booking_month: string | null
          booking_no: string | null
          booking_type: string | null
          cancelled_at: string | null
          cogs: number | null
          created_at: string | null
          departure_date: string | null
          departure_month: string | null
          departure_region: string | null
          gmv: number | null
          id: string | null
          influencer_commission: number | null
          is_recognized: boolean | null
          land_operator_id: string | null
          lead_time_days: number | null
          lifecycle_state: string | null
          margin: number | null
          outstanding: number | null
          paid_amount: number | null
          payment_status: string | null
          settlement_mode: string | null
          status: string | null
          tenant_id: string | null
          utm_campaign: string | null
          utm_source: string | null
        }
        Insert: {
          affiliate_id?: string | null
          booking_month?: never
          booking_no?: string | null
          booking_type?: string | null
          cancelled_at?: string | null
          cogs?: never
          created_at?: string | null
          departure_date?: string | null
          departure_month?: never
          departure_region?: string | null
          gmv?: never
          id?: string | null
          influencer_commission?: never
          is_recognized?: never
          land_operator_id?: string | null
          lead_time_days?: never
          lifecycle_state?: never
          margin?: never
          outstanding?: never
          paid_amount?: never
          payment_status?: string | null
          settlement_mode?: string | null
          status?: string | null
          tenant_id?: string | null
          utm_campaign?: string | null
          utm_source?: string | null
        }
        Update: {
          affiliate_id?: string | null
          booking_month?: never
          booking_no?: string | null
          booking_type?: string | null
          cancelled_at?: string | null
          cogs?: never
          created_at?: string | null
          departure_date?: string | null
          departure_month?: never
          departure_region?: string | null
          gmv?: never
          id?: string | null
          influencer_commission?: never
          is_recognized?: never
          land_operator_id?: string | null
          lead_time_days?: never
          lifecycle_state?: never
          margin?: never
          outstanding?: never
          paid_amount?: never
          payment_status?: string | null
          settlement_mode?: string | null
          status?: string | null
          tenant_id?: string | null
          utm_campaign?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "influencer_performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_land_operator_id_fkey"
            columns: ["land_operator_id"]
            isOneToOne: false
            referencedRelation: "land_operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_ltr_signals: {
        Row: {
          departure_date: string | null
          effective_price: number | null
          free_option_count: number | null
          group_key: string | null
          group_size: number | null
          hotel_avg_grade: number | null
          intent: string | null
          is_direct_flight: boolean | null
          label_booking: number | null
          label_relevant: number | null
          list_price: number | null
          outcome: string | null
          outcome_at: string | null
          outcome_id: number | null
          outcome_value: number | null
          package_id: string | null
          policy_version: string | null
          recommended_at: string | null
          recommended_rank: number | null
          shopping_count: number | null
          snapshot_date: string | null
          source: string | null
          topsis_score: number | null
        }
        Relationships: []
      }
      v_monthly_new_bookings: {
        Row: {
          avg_lead_time: number | null
          cancelled_bookings: number | null
          gmv_live: number | null
          gmv_total: number | null
          live_bookings: number | null
          month: string | null
          total_bookings: number | null
        }
        Relationships: []
      }
      v_monthly_recognized_revenue: {
        Row: {
          commission: number | null
          gmv: number | null
          margin: number | null
          month: string | null
          outstanding: number | null
          paid: number | null
          recognized_bookings: number | null
        }
        Relationships: []
      }
      v_package_rank_trends: {
        Row: {
          avg_effective_price: number | null
          avg_group_size: number | null
          avg_rank: number | null
          best_rank: number | null
          departure_date: string | null
          first_seen: string | null
          group_key: string | null
          last_seen: string | null
          latest_rank: number | null
          oldest_rank: number | null
          package_id: string | null
          policy_version: string | null
          snapshots: number | null
          worst_rank: number | null
        }
        Relationships: []
      }
      v_recommendation_funnel: {
        Row: {
          booking_rate_pct: number | null
          booking_value_sum: number | null
          bookings: number | null
          cancellations: number | null
          clicks: number | null
          conversion_rate_pct: number | null
          exposures: number | null
          first_seen: string | null
          inquiries: number | null
          intent: string | null
          last_seen: string | null
          recommended_rank: number | null
          source: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      bump_customer_facts_access: {
        Args: { fact_ids: string[] }
        Returns: undefined
      }
      calculate_rfm_scores: { Args: never; Returns: undefined }
      confirm_payment_match: {
        Args: {
          p_booking_id: string
          p_created_by?: string
          p_score: number
          p_transaction_id: string
        }
        Returns: Json
      }
      corrections_stats_by_category: {
        Args: never
        Returns: {
          applied_total: number
          category: string
          critical_count: number
          destinations: string[]
          total_count: number
        }[]
      }
      corrections_stats_by_destination: {
        Args: never
        Returns: {
          critical_count: number
          destination: string
          high_count: number
          last_correction_at: string
          most_common_field: string
          total_count: number
          unique_fields: number
        }[]
      }
      corrections_stats_by_field: {
        Args: { p_destination?: string; p_min_severity?: string }
        Returns: {
          applied_total: number
          critical_count: number
          field_path: string
          high_count: number
          last_correction_at: string
          most_common_category: string
          total_count: number
        }[]
      }
      create_land_settlement: {
        Args: {
          p_booking_amounts: Json
          p_created_by?: string
          p_fee_tolerance?: number
          p_is_refund?: boolean
          p_land_operator_id: string
          p_notes?: string
          p_transaction_id: string
        }
        Returns: Json
      }
      current_jarvis_context: {
        Args: never
        Returns: {
          tenant_id: string
          user_id: string
          user_role: string
        }[]
      }
      generate_internal_code: {
        Args: {
          p_departure_code: string
          p_destination_code: string
          p_duration_days: number
          p_supplier_code: string
        }
        Returns: string
      }
      get_active_scoring_policy: {
        Args: never
        Returns: {
          created_at: string
          created_by: string | null
          fallback_rules: Json
          flight_premium: Json
          hedonic_coefs: Json
          hotel_brand_max_bonus: number
          hotel_premium: Json
          id: string
          is_active: boolean
          market_rates: Json
          notes: string | null
          updated_at: string
          version: string
          weights: Json
        }
        SetofOptions: {
          from: "*"
          to: "scoring_policies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_inbox_tasks: {
        Args: { p_limit?: number; p_offset?: number; p_priority_max?: number }
        Returns: {
          booking_id: string
          booking_no: string
          context: Json
          created_at: string
          customer_name: string
          departure_date: string
          id: string
          package_title: string
          priority: number
          snoozed_until: string
          status: string
          task_type: string
          title: string
        }[]
      }
      get_personalized_by_destination: {
        Args: { p_customer_id: string; p_destination: string }
        Returns: {
          destination: string
          package_id: string
          package_name: string
          price: number
          reason: string
          score: number
        }[]
      }
      get_recent_resolved_task: {
        Args: { p_booking_id: string; p_since: string; p_task_type: string }
        Returns: string
      }
      get_simple_recommendations: {
        Args: { p_customer_id?: string }
        Returns: {
          destination: string
          package_id: string
          package_name: string
          price: number
          reason: string
          score: number
        }[]
      }
      get_stale_bank_transactions: {
        Args: { hours?: number }
        Returns: {
          amount: number
          counterparty_name: string
          hours_stale: number
          id: string
          match_status: string
          received_at: string
        }[]
      }
      get_trending_packages: {
        Args: never
        Returns: {
          destination: string
          package_id: string
          package_name: string
          price: number
          reason: string
          score: number
        }[]
      }
      increment_alm_clicks: {
        Args: { p_mapping_id: string }
        Returns: undefined
      }
      increment_alm_conversions: {
        Args: { p_mapping_id: string }
        Returns: undefined
      }
      increment_content_view_count: {
        Args: { p_creative_id: string }
        Returns: undefined
      }
      increment_correction_applied: {
        Args: { p_correction_ids: string[] }
        Returns: number
      }
      increment_package_inquiry_count: {
        Args: { package_id: string }
        Returns: undefined
      }
      increment_package_view_count: {
        Args: { package_id: string }
        Returns: undefined
      }
      jarvis_current_month_usage: {
        Args: { p_tenant_id: string }
        Returns: {
          call_count: number
          total_cost_usd: number
          total_tokens: number
        }[]
      }
      jarvis_current_tenant: { Args: never; Returns: string }
      jarvis_disable_rls: { Args: never; Returns: undefined }
      jarvis_enable_rls: { Args: never; Returns: undefined }
      jarvis_hybrid_search: {
        Args: {
          p_limit?: number
          p_query_embedding: string
          p_query_text: string
          p_source_types?: string[]
          p_tenant_id?: string
        }
        Returns: {
          bm25_score: number
          chunk_text: string
          contextual_text: string
          id: string
          metadata: Json
          rrf_score: number
          source_id: string
          source_title: string
          source_type: string
          source_url: string
          tenant_id: string
          vector_score: number
        }[]
      }
      jarvis_is_platform_admin: { Args: never; Returns: boolean }
      learn_payment_rules: {
        Args: { p_lookback_days?: number; p_min_count?: number }
        Returns: Json
      }
      match_error_patterns: {
        Args: {
          filter_category?: string
          match_count?: number
          match_threshold?: number
          only_whitelisted?: boolean
          query_embedding: string
        }
        Returns: {
          category: string
          description: string
          error_code: string
          good_fix: Json
          id: string
          occurrence_count: number
          promoted_to_whitelist: boolean
          resolution_type: string
          similarity: number
          title: string
        }[]
      }
      match_travel_packages_duplicate: {
        Args: {
          exclude_id?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          created_at: string
          destination: string
          id: string
          price: number
          similarity: number
          status: string
          title: string
        }[]
      }
      recommend_publish_slot: {
        Args: {
          p_after?: string
          p_horizon_hours?: number
          p_platform: string
          p_tenant_id?: string
        }
        Returns: string
      }
      reconcile_ledger: {
        Args: never
        Returns: {
          account: string
          booking_id: string
          bookings_balance: number
          drift: number
          ledger_sum: number
        }[]
      }
      record_ledger_entry: {
        Args: {
          p_account: string
          p_amount: number
          p_booking_id: string
          p_created_by?: string
          p_entry_type: string
          p_idempotency_key?: string
          p_memo?: string
          p_source: string
          p_source_ref_id?: string
        }
        Returns: string
      }
      record_manual_paid_amount_change: {
        Args: {
          p_booking_id: string
          p_created_by?: string
          p_idempotency_key?: string
          p_memo?: string
          p_new_paid_amount?: number
          p_new_total_paid_out?: number
          p_source?: string
          p_source_ref_id?: string
        }
        Returns: Json
      }
      refresh_package_rating: {
        Args: { p_package_id: string }
        Returns: undefined
      }
      resolve_booking_task: {
        Args: {
          p_resolution?: string
          p_resolved_by: string
          p_task_id: string
        }
        Returns: {
          assigned_to: string | null
          auto_resolve_reason: string | null
          booking_id: string
          context: Json
          created_at: string
          created_by: string
          fingerprint: string
          id: string
          priority: number
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          snoozed_until: string | null
          status: string
          task_type: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "booking_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resync_paid_amounts: { Args: never; Returns: number }
      resync_paid_amounts_with_ledger: { Args: never; Returns: Json }
      reverse_land_settlement: {
        Args: {
          p_reason?: string
          p_reversed_by?: string
          p_settlement_id: string
        }
        Returns: Json
      }
      search_customer_facts_semantic: {
        Args: {
          match_limit?: number
          min_similarity?: number
          p_conversation_id?: string
          p_customer_id?: string
          p_tenant_id?: string
          query_embedding: string
        }
        Returns: {
          category: string
          fact_id: string
          fact_text: string
          importance: number
          score: number
          similarity: number
        }[]
      }
      search_similar_customers: {
        Args: { p_limit?: number; p_query: string; p_threshold?: number }
        Returns: {
          id: string
          name: string
          score: number
        }[]
      }
      search_travel_packages_semantic: {
        Args: {
          match_limit?: number
          min_similarity?: number
          p_tenant_id?: string
          query_embedding: string
        }
        Returns: {
          destination: string
          duration: number
          package_id: string
          price: number
          similarity: number
          title: string
        }[]
      }
      seed_ledger_from_current_balances: { Args: never; Returns: Json }
      set_jarvis_request_context: {
        Args: { p_tenant_id: string; p_user_id: string; p_user_role: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      snooze_booking_task: {
        Args: { p_actor: string; p_snoozed_until: string; p_task_id: string }
        Returns: {
          assigned_to: string | null
          auto_resolve_reason: string | null
          booking_id: string
          context: Json
          created_at: string
          created_by: string
          fingerprint: string
          id: string
          priority: number
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          snoozed_until: string | null
          status: string
          task_type: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "booking_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      supersede_booking_tasks: {
        Args: { p_booking_id: string; p_reason?: string }
        Returns: number
      }
      update_booking_ledger: {
        Args: {
          p_booking_id: string
          p_created_by?: string
          p_idempotency_key?: string
          p_memo?: string
          p_paid_delta?: number
          p_payout_delta?: number
          p_source?: string
          p_source_ref_id?: string
        }
        Returns: {
          auto_status_changed: boolean
          booking_status: string
          paid_amount: number
          payment_status: string
          total_paid_out: number
        }[]
      }
      upsert_error_pattern: {
        Args: {
          p_bad_example?: Json
          p_category: string
          p_description?: string
          p_embedding?: string
          p_error_code: string
          p_good_fix?: Json
          p_related_package_id?: string
          p_severity?: string
          p_source?: string
          p_title: string
          p_trigger_keywords?: string[]
        }
        Returns: string
      }
      wake_snoozed_tasks: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
