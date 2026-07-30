export type ConsentGrant = 'granted' | 'denied';

export interface AnalyticsConsentState {
  analytics_storage: ConsentGrant;
  ad_storage: ConsentGrant;
  ad_user_data: ConsentGrant;
  ad_personalization: ConsentGrant;
  decided: boolean;
  updatedAt: string | null;
}

export interface ConsentPreferences {
  analytics: boolean;
  advertising: boolean;
}

export interface AnalyticsItem {
  item_id: string;
  item_name: string;
  item_category: 'travel_package';
  item_category2?: string;
  item_category3?: string;
  item_variant?: string;
  price?: number;
  quantity?: number;
  index?: number;
}

interface PackageContext {
  package_id?: string;
  package_name?: string;
  destination?: string;
  departure_city?: string;
  departure_date?: string;
}

export interface AnalyticsEventMap {
  page_view: {
    page_type: string;
    page_path: string;
    page_title?: string;
  };
  view_item_list: {
    item_list_id: string;
    item_list_name: string;
    items: AnalyticsItem[];
  };
  select_item: {
    item_list_id?: string;
    item_list_name?: string;
    items: [AnalyticsItem];
  };
  view_item: PackageContext & {
    currency: 'KRW';
    value?: number;
    price_type?: string;
    items: [AnalyticsItem];
  };
  view_promotion: {
    promotion_id: string;
    promotion_name: string;
    creative_slot?: string;
  };
  select_promotion: {
    promotion_id: string;
    promotion_name: string;
    creative_slot?: string;
  };
  ysn_price_view: PackageContext & {
    price_type: string;
    displayed_price?: number;
    currency: 'KRW';
  };
  ysn_schedule_view: PackageContext;
  ysn_inclusions_view: PackageContext;
  ysn_departure_select: PackageContext;
  ysn_room_option_select: PackageContext & {
    room_option?: string;
    adult_count?: number;
    child_count?: number;
  };
  ysn_kakao_click: PackageContext & {
    cta_location: string;
    page_type: string;
    outbound_host: 'pf.kakao.com' | 'open.kakao.com';
  };
  ysn_phone_click: PackageContext & {
    cta_location: string;
    page_type: string;
  };
  ysn_outbound_click: {
    outbound_host: string;
    link_type: string;
    cta_location?: string;
  };
  begin_checkout: PackageContext & {
    currency: 'KRW';
    value?: number;
    items?: AnalyticsItem[];
  };
  add_payment_info: PackageContext & {
    currency: 'KRW';
    value?: number;
    payment_type?: string;
    items?: AnalyticsItem[];
  };
  generate_lead: PackageContext & {
    lead_source: 'website';
    lead_type: 'package_inquiry';
    currency?: 'KRW';
    value?: number;
  };
  purchase: {
    transaction_id: string;
    currency: 'KRW';
    value: number;
    items: AnalyticsItem[];
  };
  refund: {
    transaction_id: string;
    currency: 'KRW';
    value?: number;
    items?: AnalyticsItem[];
  };
  ysn_booking_confirmed: PackageContext & {
    transaction_id: string;
    currency: 'KRW';
    value?: number;
  };
}

export type AnalyticsEventName = keyof AnalyticsEventMap;

export interface AttributionTouch {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  landingPath?: string;
  referrerHost?: string;
  occurredAt?: string;
}

export interface AttributionClickIds {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  nclid?: string;
}

export interface AttributionSnapshot {
  version: 1;
  attributionSessionId: string;
  firstTouch?: AttributionTouch;
  lastTouch?: AttributionTouch;
  clickIds?: AttributionClickIds;
  gaClientId?: string;
  expiresAt: string;
}

export type AnalyticsScalar = string | number | boolean | null;
export type AnalyticsValue =
  | AnalyticsScalar
  | AnalyticsValue[]
  | { [key: string]: AnalyticsValue };

export interface DataLayerEvent {
  event: AnalyticsEventName | 'ysn_consent_update';
  [key: string]: AnalyticsValue | undefined;
}
