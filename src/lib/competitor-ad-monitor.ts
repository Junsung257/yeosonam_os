import { supabaseAdmin } from "@/lib/supabase";

export interface CompetitorCreative {
  platform: "meta" | "google" | "naver";
  advertiserName: string;
  headline: string;
  description: string;
  destination?: string;
  estimatedSpend?: string;
  firstSeen: Date;
  lastSeen: Date;
}

export interface CompetitorMonitorConfig {
  keywords: string[];
  advertisers: string[]; // 경쟁사 브랜드명
  platforms: ("meta" | "google" | "naver")[];
}

/**
 * 설정된 키워드와 경쟁사 목록을 기반으로 각 플랫폼의 광고를 스캔한다.
 *
 * 현재 각 플랫폼 연동은 Stub 상태이며, 실제 API 키 발급 시 연동이 필요하다.
 * 각 stub은 1-2개의 mock 결과를 반환하고, 실제 호출될 API 정보를 로그에 남긴다.
 *
 * @param config 모니터링 설정 (키워드, 경쟁사, 플랫폼)
 * @returns 수집된 경쟁사 광고 목록
 */
export async function scanCompetitorAds(
  config: CompetitorMonitorConfig
): Promise<CompetitorCreative[]> {
  const results: CompetitorCreative[] = [];
  const today = new Date();

  for (const platform of config.platforms) {
    switch (platform) {
      case "meta":
        results.push(...(await scanMetaAds(config, today)));
        break;
      case "google":
        results.push(...(await scanGoogleAds(config, today)));
        break;
      case "naver":
        results.push(...(await scanNaverAds(config, today)));
        break;
    }
  }

  return results;
}

/**
 * Meta Ad Library API 스캔 (Stub)
 *
 * 실제 구현 시 호출해야 할 API:
 *   GET https://graph.facebook.com/v22.0/ads_archive
 *   ?ad_reactive_countries=['KR']
 *   &search_terms=['keyword1','keyword2']
 *   &ad_delivery_date_max=2026-05-24
 *   &access_token={META_ADS_LIBRARY_TOKEN}
 *
 * 환경 변수: META_ADS_LIBRARY_TOKEN
 */
async function scanMetaAds(
  config: CompetitorMonitorConfig,
  today: Date
): Promise<CompetitorCreative[]> {
  console.log(
    "[competitor-ad-monitor] Meta Ad Library API 호출 (stub):",
    JSON.stringify({
      endpoint: "https://graph.facebook.com/v22.0/ads_archive",
      searchTerms: config.keywords,
      advertisers: config.advertisers,
      note: "META_ADS_LIBRARY_TOKEN 환경 변수가 필요합니다",
    })
  );

  // Mock 데이터: 광고주당 1건씩
  return config.advertisers.slice(0, 2).map((advertiser, idx) => ({
    platform: "meta" as const,
    advertiserName: advertiser,
    headline: `[${advertiser}] ${config.keywords[0] ?? "여행"} 특가 이벤트`,
    description: `지금 ${advertiser}에서 ${config.keywords[0] ?? "특가"} 여행 상품을 만나보세요! 한정된 기간 동안 특별 할인 혜택을 제공합니다.`,
    destination: `https://example.com/${advertiser.toLowerCase()}/campaign-${idx}`,
    estimatedSpend: `₩${(idx + 1) * 500_000} - ₩${(idx + 1) * 1_000_000}`,
    firstSeen: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000),
    lastSeen: today,
  }));
}

/**
 * Google Ads Transparency Center 스캔 (Stub)
 *
 * 실제 구현 시 호출해야 할 API:
 *   https://adstransparency.google.com/ (공식 API 없음, 웹 크롤링 필요)
 *   또는 Google Ads API의 AdGroupAd 서비스를 통해 자사 계정 경쟁사 광고 수집
 *
 * 환경 변수: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID
 */
async function scanGoogleAds(
  config: CompetitorMonitorConfig,
  today: Date
): Promise<CompetitorCreative[]> {
  console.log(
    "[competitor-ad-monitor] Google Ads Transparency Center 조회 (stub):",
    JSON.stringify({
      method: "웹 크롤링 또는 Google Ads API",
      searchTerms: config.keywords,
      advertisers: config.advertisers,
      note: "Google Ads Developer Token이 필요합니다",
    })
  );

  // Mock 데이터
  return config.advertisers.slice(0, 2).map((advertiser, idx) => ({
    platform: "google" as const,
    advertiserName: advertiser,
    headline: `${advertiser} ${config.keywords[0] ?? "해외여행"} 베스트 딜`,
    description: `${advertiser}의 엄선된 ${config.keywords[0] ?? "여행"} 상품. 최저가 보장, 24시간 고객 지원, 간편 예약 시스템. 지금 바로 확인하세요.`,
    destination: `https://www.google.com/ads/${advertiser.toLowerCase()}`,
    estimatedSpend: undefined,
    firstSeen: new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000),
    lastSeen: today,
  }));
}

/**
 * Naver Ad Library 스캔 (Stub)
 *
 * 실제 구현 시 호출해야 할 API:
 *   https://manage.searchad.naver.com/customers/{customerId}/adgroup
 *   또는 Naver 검색광고 API (https://api.naver.com)
 *
 * 환경 변수: NAVER_AD_API_KEY, NAVER_AD_CUSTOMER_ID
 */
async function scanNaverAds(
  config: CompetitorMonitorConfig,
  today: Date
): Promise<CompetitorCreative[]> {
  console.log(
    "[competitor-ad-monitor] Naver Ad Library 조회 (stub):",
    JSON.stringify({
      api: "Naver Search Ad API",
      searchTerms: config.keywords,
      advertisers: config.advertisers,
      note: "NAVER_AD_API_KEY, NAVER_AD_CUSTOMER_ID 환경 변수가 필요합니다",
    })
  );

  // Mock 데이터
  return config.advertisers.slice(0, 1).map((advertiser) => ({
    platform: "naver" as const,
    advertiserName: advertiser,
    headline: `[네이버] ${advertiser} ${config.keywords[0] ?? "여행"} 패키지`,
    description: `${advertiser}가 추천하는 ${config.keywords[0] ?? "인기 여행"} 코스. 네이버 예약 시 특별 혜택 증정!`,
    destination: `https://search.naver.com/search.naver?query=${encodeURIComponent(advertiser + " " + (config.keywords[0] ?? "여행"))}`,
    estimatedSpend: `₩300,000 - ₩800,000`,
    firstSeen: new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000),
    lastSeen: today,
  }));
}

/**
 * 수집된 경쟁사 광고 데이터를 DB에 저장한다.
 *
 * 중복 방지를 위해 동일 플랫폼+광고주+헤드라인 조합이 이미 존재하면
 * last_seen만 갱신한다.
 *
 * @param creatives 저장할 경쟁사 광고 목록
 */
export async function storeCompetitorCreatives(
  creatives: CompetitorCreative[]
): Promise<void> {
  if (creatives.length === 0) {
    console.log(
      "[competitor-ad-monitor] 저장할 경쟁사 광고 데이터가 없습니다."
    );
    return;
  }

  for (const creative of creatives) {
    // 중복 확인: 같은 플랫폼 + 광고주 + 헤드라인이면 last_seen 업데이트
    const { data: existing } = await supabaseAdmin
      .from("competitor_ads")
      .select("id, last_seen, raw_data")
      .eq("platform", creative.platform)
      .eq("advertiser_name", creative.advertiserName)
      .eq("headline", creative.headline)
      .limit(1);

    if (existing && existing.length > 0) {
      // 기존 레코드 갱신
      await supabaseAdmin
        .from("competitor_ads")
        .update({
          last_seen: creative.lastSeen.toISOString().split("T")[0],
          raw_data: {
            ...((existing[0] as any).raw_data ?? {}),
            last_description: creative.description,
            last_destination: creative.destination,
            updated_at: new Date().toISOString(),
          },
        })
        .eq("id", (existing[0] as any).id);

      console.log(
        `[competitor-ad-monitor] 기존 광고 갱신: ${creative.platform} / ${creative.advertiserName} / ${creative.headline}`
      );
    } else {
      // 신규 삽입
      await supabaseAdmin.from("competitor_ads").insert({
        platform: creative.platform,
        advertiser_name: creative.advertiserName,
        headline: creative.headline,
        description: creative.description,
        destination: creative.destination ?? null,
        estimated_spend: creative.estimatedSpend ?? null,
        first_seen: creative.firstSeen.toISOString().split("T")[0],
        last_seen: creative.lastSeen.toISOString().split("T")[0],
        raw_data: {
          crawled_at: new Date().toISOString(),
        },
      } as never);

      console.log(
        `[competitor-ad-monitor] 신규 광고 저장: ${creative.platform} / ${creative.advertiserName} / ${creative.headline}`
      );
    }
  }

  console.log(
    `[competitor-ad-monitor] 경쟁사 광고 데이터 저장 완료: ${creatives.length}건`
  );
}
