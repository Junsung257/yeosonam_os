import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import {
  supabaseAdmin,
  isSupabaseConfigured,
  insertTrafficLog,
  insertSearchLog,
  insertEngagementLog,
  insertConversionLog,
  getLatestTrafficBySession,
  getFirstTrafficBySession,
  mergeSessionToUser,
} from '@/lib/supabase';
import { shouldSkipPublicDbReadsForResourceSaver } from '@/lib/cron-resource-saver';

// ── 타입 ─────────────────────────────────────────────────────

type TrackingPayload =
  | {
      type: 'traffic';
      session_id: string;
      user_id?: string;
      consent_agreed: boolean;
      source?: string;
      medium?: string;
      campaign_name?: string;
      keyword?: string;
      gclid?: string;
      gbraid?: string;
      wbraid?: string;
      fbclid?: string;
      n_keyword?: string;
      current_cpc?: number;
      landing_page?: string;
      ad_landing_mapping_id?: string;
      content_creative_id?: string;
      visitor_uid?: string;
      is_returning?: boolean;
      device_type?: string;
      device_os?: string;
      browser_name?: string;
      viewport_w?: number;
      viewport_h?: number;
    }
  | {
      type: 'search';
      session_id: string;
      user_id?: string;
      search_query?: string;
      search_category?: string;
      result_count?: number;
      lead_time_days?: number;
      visitor_uid?: string;
    }
  | {
      type: 'engagement';
      session_id: string;
      user_id?: string;
      /** page_view, scroll_25 … 등 — DB는 text 컬럼 */
      event_type: string;
      product_id?: string;
      product_name?: string;
      page_url?: string;
      event_source?: string | null;
      destination?: string | null;
      intent?: string | null;
      budget?: string | null;
      party_type?: string | null;
      selected_products?: string[] | null;
      metadata?: Record<string, unknown>;
      cart_added?: boolean;
      lead_time_days?: number;
      visitor_uid?: string;
      time_on_page_ms?: number;
      max_scroll_pct?: number;
      interaction_count?: number;
      /** 콘텐츠 어트리뷰션: 카드뉴스·블로그 방문/클릭 이벤트 */
      content_id?: string;
      content_type?: 'card_news' | 'blog' | 'email';
      ad_landing_mapping_id?: string;
      tenant_id?: string;
      utm_source?: string;
      utm_medium?: string;
      utm_campaign?: string;
      utm_term?: string;
    }
  | {
      type: 'conversion';
      session_id: string;
      user_id?: string;
      booking_id?: string;
      final_sales_price: number;
      base_cost: number;
    }
  | {
      type: 'merge';
      session_id: string;
      user_id: string;
    };

async function resolveAdLandingMappingId(input: {
  explicitId?: string | null;
  contentCreativeId?: string | null;
  utmSource?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
}): Promise<string | null> {
  if (input.explicitId) return input.explicitId;
  if (!input.contentCreativeId || !input.utmCampaign) return null;

  let query = supabaseAdmin
    .from('ad_landing_mappings')
    .select('id')
    .eq('content_creative_id', input.contentCreativeId)
    .eq('utm_campaign', input.utmCampaign)
    .limit(1);

  if (input.utmSource) query = query.eq('utm_source', input.utmSource);
  if (input.utmTerm) query = query.eq('utm_term', input.utmTerm);

  const { data } = await query;
  return data?.[0]?.id ?? null;
}

async function incrementMappingMetric(
  id: string | null,
  metric: 'clicks' | 'cta_clicks' | 'conversions',
  value = 0,
) {
  if (!id) return;
  const metricColumns = {
    clicks: 'last_click_at',
    cta_clicks: 'last_cta_click_at',
    conversions: 'last_conversion_at',
  } as const;
  const selectColumns = metric === 'conversions' ? `${metric}, conversion_value_krw` : metric;
  const { data } = await supabaseAdmin
    .from('ad_landing_mappings')
    .select(selectColumns)
    .eq('id', id)
    .maybeSingle();
  if (!data) return;
  const row = data as unknown as Record<string, number | null>;

  const patch: Record<string, unknown> = {
    [metric]: Number(row[metric] || 0) + 1,
    [metricColumns[metric]]: new Date().toISOString(),
  };
  if (metric === 'conversions') {
    patch.conversion_value_krw = Number(row.conversion_value_krw || 0) + Math.max(0, Math.round(value));
  }
  await supabaseAdmin.from('ad_landing_mappings').update(patch).eq('id', id);
}

function normalizeSource(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isPaidTraffic(traffic?: {
  source?: string | null;
  medium?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  fbclid?: string | null;
  n_keyword?: string | null;
} | null): boolean {
  if (!traffic) return false;
  const source = normalizeSource(traffic.source);
  const medium = normalizeSource(traffic.medium);
  return Boolean(
    traffic.gclid ||
      traffic.gbraid ||
      traffic.wbraid ||
      traffic.fbclid ||
      traffic.n_keyword ||
      ['google', 'naver', 'facebook', 'meta', 'kakao'].includes(source) ||
      ['cpc', 'ppc', 'paid', 'paid_search', 'display', 'social_paid'].includes(medium),
  );
}

function classifyPaidSource(traffic?: {
  source?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  fbclid?: string | null;
  n_keyword?: string | null;
} | null): string {
  if (!traffic) return 'organic';
  const source = normalizeSource(traffic.source);
  if (traffic.gclid || traffic.gbraid || traffic.wbraid || source === 'google') return 'google';
  if (traffic.n_keyword || source === 'naver') return 'naver';
  if (traffic.fbclid || source === 'facebook' || source === 'meta') return 'meta';
  if (source === 'kakao') return 'kakao';
  return source || 'organic';
}

function isOrganicLikeTraffic(traffic?: { source?: string | null; medium?: string | null } | null): boolean {
  if (!traffic) return true;
  const source = normalizeSource(traffic.source);
  const medium = normalizeSource(traffic.medium);
  if (isPaidTraffic(traffic)) return false;
  return medium === 'organic' || medium === 'content' || source.includes('google') || source.includes('naver') || !source;
}

// ── POST /api/tracking ────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: TrackingPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body?.type || !body?.session_id) {
    return NextResponse.json({ error: 'type and session_id are required' }, { status: 400 });
  }

  // Supabase 미설정 시 202 즉시 반환 (개발/테스트 환경)
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: true, mock: true }, { status: 202 });
  }

  if (shouldSkipPublicDbReadsForResourceSaver()) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'db_resource_saver_mode' }, { status: 202 });
  }

  switch (body.type) {
    // ── traffic ──────────────────────────────────────────────
    case 'traffic': {
      const consent = body.consent_agreed === true;
      const adLandingMappingId = await resolveAdLandingMappingId({
        explicitId: body.ad_landing_mapping_id ?? null,
        contentCreativeId: body.content_creative_id ?? null,
        utmSource: body.source ?? null,
        utmCampaign: body.campaign_name ?? null,
        utmTerm: body.keyword ?? null,
      });
      // PIPA: 동의 없으면 개인식별 클릭 ID NULL 처리
      void insertTrafficLog({
        session_id: body.session_id,
        user_id: body.user_id ?? null,
        source: body.source ?? null,
        medium: body.medium ?? null,
        campaign_name: body.campaign_name ?? null,
        keyword: body.keyword ?? null,
        gclid: consent ? (body.gclid ?? null) : null,
        gbraid: consent ? (body.gbraid ?? null) : null,
        wbraid: consent ? (body.wbraid ?? null) : null,
        fbclid: consent ? (body.fbclid ?? null) : null,
        n_keyword: body.n_keyword ?? null,
        current_cpc: body.current_cpc ?? null,
        consent_agreed: consent,
        landing_page: body.landing_page ?? null,
        ad_landing_mapping_id: adLandingMappingId,
        content_creative_id: body.content_creative_id ?? null,
        visitor_uid: body.visitor_uid ?? null,
        is_returning: body.is_returning ?? null,
        device_type: body.device_type ?? null,
        device_os: body.device_os ?? null,
        browser_name: body.browser_name ?? null,
        viewport_w: body.viewport_w ?? null,
        viewport_h: body.viewport_h ?? null,
      });
      void incrementMappingMetric(adLandingMappingId, 'clicks');
      // 내부 조회수 원자적 증가 (어드민 대시보드 용)
      if (body.content_creative_id) {
        const creativeId = body.content_creative_id as string;
        supabaseAdmin.rpc('increment_content_view_count', {
          p_creative_id: creativeId,
        }).then(async (res: { error: unknown }) => {
          if (res.error) {
            // RPC 없으면 fallback: 현재값 +1 (race condition 허용 — 통계 용도)
            const { data } = await supabaseAdmin
              .from('content_creatives')
              .select('view_count')
              .eq('id', creativeId)
              .limit(1);
            const current = ((data?.[0] as { view_count?: number } | undefined)?.view_count) ?? 0;
            await supabaseAdmin
              .from('content_creatives')
              .update({ view_count: current + 1 })
              .eq('id', creativeId);
          }
        });
      }
      return NextResponse.json({ ok: true }, { status: 202 });
    }

    // ── search ───────────────────────────────────────────────
    case 'search': {
      void insertSearchLog({
        session_id: body.session_id,
        user_id: body.user_id ?? null,
        search_query: body.search_query ?? null,
        search_category: body.search_category ?? null,
        result_count: body.result_count ?? 0,
        lead_time_days: body.lead_time_days ?? null,
        visitor_uid: body.visitor_uid ?? null,
      });
      return NextResponse.json({ ok: true }, { status: 202 });
    }

    // ── engagement ───────────────────────────────────────────
    case 'engagement': {
      const baseMetadata = normalizeMetadata(body.metadata);
      const metadata: Record<string, unknown> = {
        ...baseMetadata,
        ...(body.intent ? { intent: body.intent } : {}),
        ...(body.budget ? { budget: body.budget } : {}),
        ...(body.party_type ? { party_type: body.party_type } : {}),
        ...(body.selected_products ? { selected_products: body.selected_products } : {}),
      };
      const eventSource = nonEmptyString(body.event_source) ?? nonEmptyString(baseMetadata.source);

      void insertEngagementLog({
        session_id: body.session_id,
        user_id: body.user_id ?? null,
        event_type: body.event_type,
        product_id: body.product_id ?? null,
        product_name: body.product_name ?? null,
        event_source: eventSource,
        destination: nonEmptyString(body.destination),
        metadata,
        cart_added: body.cart_added ?? false,
        page_url: body.page_url ?? null,
        lead_time_days: body.lead_time_days ?? null,
        visitor_uid: body.visitor_uid ?? null,
        time_on_page_ms: body.time_on_page_ms ?? null,
        max_scroll_pct: body.max_scroll_pct ?? null,
        interaction_count: body.interaction_count ?? null,
      });
      // 콘텐츠 어트리뷰션: view/click 이벤트만 기록
      if (
        body.content_id &&
        body.content_type &&
        (body.event_type === 'view' || body.event_type === 'click' || body.event_type === 'inquiry')
      ) {
        const attrEventType =
          body.event_type === 'inquiry' ? 'inquiry' :
          body.event_type === 'click' ? 'click' : 'view';
        const adLandingMappingId = await resolveAdLandingMappingId({
          explicitId: body.ad_landing_mapping_id ?? null,
          contentCreativeId: body.content_id,
          utmSource: body.utm_source ?? null,
          utmCampaign: body.utm_campaign ?? null,
          utmTerm: body.utm_term ?? null,
        });
        void supabaseAdmin.from('content_attribution_events').insert({
          tenant_id: body.tenant_id ?? null,
          content_id: body.content_id,
          content_type: body.content_type,
          ad_landing_mapping_id: adLandingMappingId,
          session_id: body.session_id,
          utm_source: body.utm_source ?? null,
          utm_medium: body.utm_medium ?? null,
          utm_campaign: body.utm_campaign ?? null,
          event_type: attrEventType,
        });
        if (attrEventType === 'click') void incrementMappingMetric(adLandingMappingId, 'cta_clicks');
      }
      return NextResponse.json({ ok: true }, { status: 202 });
    }

    // ── conversion (순이익 자동 연산 + dual attribution) ────────
    case 'conversion': {
      const { session_id, user_id, booking_id, final_sales_price, base_cost } = body;

      // Last-touch: 가장 최근 트래픽
      const traffic = await getLatestTrafficBySession(session_id);
      // First-touch: 가장 첫 트래픽
      const firstTraffic = await getFirstTrafficBySession(session_id);

      let allocated_ad_spend = 0;
      let attributed_source = 'organic';
      let attributed_gclid: string | null = null;
      let attributed_gbraid: string | null = null;
      let attributed_wbraid: string | null = null;
      let attributed_fbclid: string | null = null;

      if (traffic?.gclid || traffic?.gbraid || traffic?.wbraid) {
        attributed_source = 'google';
        attributed_gclid = traffic.gclid ?? null;
        attributed_gbraid = traffic.gbraid ?? null;
        attributed_wbraid = traffic.wbraid ?? null;
        allocated_ad_spend = traffic.current_cpc ?? 0;
      } else if (traffic?.fbclid) {
        attributed_source = 'meta';
        attributed_fbclid = traffic.fbclid;
        allocated_ad_spend = traffic.current_cpc ?? 0;
      } else if (traffic?.n_keyword) {
        attributed_source = 'naver';
        allocated_ad_spend = traffic.current_cpc ?? 0;
      } else if (traffic?.source) {
        attributed_source = traffic.source;
      }

      // First-touch 귀속 데이터
      const first_touch_source = firstTraffic?.source || attributed_source;
      const first_touch_keyword = firstTraffic?.keyword || firstTraffic?.n_keyword || null;
      const first_touch_landing_page = firstTraffic?.landing_page || null;
      const first_touch_creative_id = firstTraffic?.content_creative_id || null;
      const first_touch_at = firstTraffic?.created_at || null;
      const first_touch_ad_landing_mapping_id = firstTraffic?.ad_landing_mapping_id || null;
      const first_touch_gclid = firstTraffic?.gclid || null;
      const first_touch_gbraid = firstTraffic?.gbraid || null;
      const first_touch_wbraid = firstTraffic?.wbraid || null;
      const first_touch_fbclid = firstTraffic?.fbclid || null;
      const first_touch_n_keyword = firstTraffic?.n_keyword || null;
      // Last-touch 콘텐츠 귀속
      const content_creative_id = traffic?.content_creative_id || null;
      const ad_landing_mapping_id = traffic?.ad_landing_mapping_id || null;
      const firstTouchPaid = isPaidTraffic(firstTraffic);
      const lastTouchPaid = isPaidTraffic(traffic);
      const paid_assisted_organic = firstTouchPaid && !lastTouchPaid && isOrganicLikeTraffic(traffic);
      const attribution_path = `${classifyPaidSource(firstTraffic)}>${classifyPaidSource(traffic)}`;

      // net_profit는 DB GENERATED ALWAYS 컬럼 — insertConversionLog에서 제외됨
      void insertConversionLog({
        session_id,
        user_id: user_id ?? null,
        final_booking_id: booking_id ?? null,
        final_sales_price,
        base_cost,
        allocated_ad_spend,
        attributed_source,
        attributed_gclid,
        attributed_gbraid,
        attributed_wbraid,
        attributed_fbclid,
        first_touch_source,
        first_touch_keyword,
        first_touch_landing_page,
        first_touch_creative_id,
        first_touch_at,
        first_touch_ad_landing_mapping_id,
        first_touch_gclid,
        first_touch_gbraid,
        first_touch_wbraid,
        first_touch_fbclid,
        first_touch_n_keyword,
        paid_assisted_organic,
        attribution_path,
        content_creative_id,
        ad_landing_mapping_id,
      });
      void incrementMappingMetric(ad_landing_mapping_id, 'conversions', final_sales_price);

      // ── Postback (fire-and-forget) ──────────────────────
      // 외부 광고 플랫폼 전환 통보. await 차단으로 응답 지연 방지 — 실패해도 Conversion DB 기록은 이미 적재됨.
      // Google Ads 전환 Postback (5s timeout — fire-and-forget이지만 행 시 lambda 점유 방어)
      if (attributed_gclid && getSecret('GOOGLE_CONVERSION_ID')) {
        fetch(
          `https://www.googleadservices.com/pagead/conversion/${getSecret('GOOGLE_CONVERSION_ID')}/?gclid=${attributed_gclid}&value=${final_sales_price}&currency_code=KRW`,
          { signal: AbortSignal.timeout(5000) },
        )
          .then(() => console.log('[Postback] Google Ads 전환 완료'))
          .catch(e => console.warn('[Postback] Google Ads 실패:', e instanceof Error ? e.message : e));
      }

      // Meta Conversions API Postback
      const metaPixelId = getSecret('META_PIXEL_ID');
      const metaAccessToken = getSecret('META_ACCESS_TOKEN');
      if (attributed_fbclid && metaPixelId && metaAccessToken) {
        fetch(`https://graph.facebook.com/v18.0/${metaPixelId}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: [{ event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000),
              user_data: { fbclid: attributed_fbclid },
              custom_data: { value: final_sales_price, currency: 'KRW' } }],
            access_token: metaAccessToken,
          }),
          signal: AbortSignal.timeout(5000),
        })
          .then(() => console.log('[Postback] Meta CAPI 전환 완료'))
          .catch(e => console.warn('[Postback] Meta CAPI 실패:', e instanceof Error ? e.message : e));
      }

      // Naver SearchAd 전환 포스트백
      // 네이버 전환추적 픽셀(서버사이드) — n_keyword가 있으면 네이버 검색광고 전환 신호
      const naverAnalyticsId = getSecret('NEXT_PUBLIC_NAVER_ANALYTICS_ID');
      if (attributed_source === 'naver' && naverAnalyticsId) {
        const naverPostbackUrl = `https://wcs.naver.net/wcsc.con?wo=${naverAnalyticsId}&co=${final_sales_price}&rc=100&gr=booking`;
        fetch(naverPostbackUrl, { signal: AbortSignal.timeout(5000) })
          .then(() => console.log('[Postback] Naver 전환 완료'))
          .catch(e => console.warn('[Postback] Naver 실패:', e instanceof Error ? e.message : e));
      }

      // 콘텐츠 → 예약 어트리뷰션 기록
      if (content_creative_id) {
        void supabaseAdmin.from('content_attribution_events').insert({
          content_id: content_creative_id,
          content_type: 'blog',
          ad_landing_mapping_id,
          session_id,
          event_type: 'booking',
          utm_source: attributed_source,
        });
      }

      const net_profit = final_sales_price - base_cost - allocated_ad_spend;
      return NextResponse.json({ ok: true, net_profit, attributed_source }, { status: 202 });
    }

    // ── merge (session → user 병합) ───────────────────────────
    case 'merge': {
      void mergeSessionToUser(body.session_id, body.user_id);
      return NextResponse.json({ ok: true }, { status: 202 });
    }

    default:
      return NextResponse.json({ error: 'unknown type' }, { status: 400 });
  }
}
