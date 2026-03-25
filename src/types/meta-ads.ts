// Meta Ads 도메인 TypeScript 인터페이스

export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type CampaignObjective = 'LINK_CLICKS' | 'CONVERSIONS' | 'REACH' | 'BRAND_AWARENESS';
export type CreativePlatform = 'thread' | 'instagram' | 'blog';
export type AiModel = 'openai' | 'claude' | 'gemini';

export interface AdCampaign {
  id: string;
  package_id: string | null;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_ad_id: string | null;
  name: string;
  status: CampaignStatus;
  objective: CampaignObjective;
  daily_budget_krw: number;
  total_spend_krw: number;
  started_at: string | null;
  ended_at: string | null;
  auto_pause_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // 조인 필드 (optional)
  package_title?: string;
  package_destination?: string;
  latest_roas?: number;
}

export interface AdCreative {
  id: string;
  package_id: string;
  campaign_id: string | null;
  platform: CreativePlatform;
  variant_index: number;
  headline: string | null;
  body_copy: string;
  image_path: string | null;
  meta_creative_id: string | null;
  is_deployed: boolean;
  performance_score: number | null;
  ai_model: AiModel;
  created_at: string;
}

export interface AdPerformanceSnapshot {
  id: string;
  campaign_id: string;
  snapshot_date: string;
  impressions: number;
  clicks: number;
  spend_krw: number;
  cpc_krw: number;
  attributed_bookings: number;
  attributed_margin: number;
  net_roas_pct: number;
  raw_meta_json: Record<string, unknown> | null;
  created_at: string;
}

export interface RoasResult {
  campaign_id: string;
  campaign_name: string;
  total_spend_krw: number;
  attributed_margin: number;
  net_roas_pct: number;
  attributed_booking_count: number;
  last_click_override_count: number; // UTM이 affiliate를 덮어쓴 예약 수
}

export interface MonthlyAdStats {
  month: string; // "2026-03"
  total_spend_krw: number;
  total_attributed_margin: number;
  net_roas_pct: number;
  total_impressions: number;
  total_clicks: number;
}

// Meta Graph API 응답 형식
export interface MetaApiResponse<T = unknown> {
  data?: T;
  id?: string;
  error?: {
    code: number;
    message: string;
    type: string;
    fbtrace_id?: string;
  };
}

export interface MetaInsightData {
  campaign_id: string;
  date_start: string;
  date_stop: string;
  spend: string;        // 문자열 (USD)
  impressions: string;
  clicks: string;
  cpc: string;          // 문자열 (USD)
}

// 캠페인 생성 요청
export interface CreateCampaignRequest {
  package_id: string;
  name: string;
  objective?: CampaignObjective;
  daily_budget_krw: number;
  targeting?: {
    age_min?: number;
    age_max?: number;
    geo_locations?: { countries: string[] };
  };
}

// 소재 생성 요청
export interface GenerateCreativesRequest {
  package_id: string;
  ai_model?: AiModel;
}

// 자동 최적화 결과
export interface OptimizeResult {
  processed: number;
  paused: { campaign_id: string; name: string; reason: string }[];
  scaled: { campaign_id: string; name: string; old_budget: number; new_budget: number }[];
  errors: { campaign_id: string; error: string }[];
  run_at: string;
}
