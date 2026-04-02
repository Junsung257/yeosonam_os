import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  insertTrafficLog,
  insertSearchLog,
  insertEngagementLog,
  insertConversionLog,
  getLatestTrafficBySession,
  mergeSessionToUser,
} from '@/lib/supabase';

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
      fbclid?: string;
      n_keyword?: string;
      current_cpc?: number;
    }
  | {
      type: 'search';
      session_id: string;
      user_id?: string;
      search_query?: string;
      search_category?: string;
      result_count?: number;
      lead_time_days?: number;
    }
  | {
      type: 'engagement';
      session_id: string;
      user_id?: string;
      event_type: string;
      product_id?: string;
      product_name?: string;
      page_url?: string;
      cart_added?: boolean;
      lead_time_days?: number;
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

  switch (body.type) {
    // ── traffic ──────────────────────────────────────────────
    case 'traffic': {
      const consent = body.consent_agreed === true;
      // PIPA: 동의 없으면 개인식별 클릭 ID NULL 처리
      void insertTrafficLog({
        session_id: body.session_id,
        user_id: body.user_id ?? null,
        source: body.source ?? null,
        medium: body.medium ?? null,
        campaign_name: body.campaign_name ?? null,
        keyword: body.keyword ?? null,
        gclid: consent ? (body.gclid ?? null) : null,
        fbclid: consent ? (body.fbclid ?? null) : null,
        n_keyword: body.n_keyword ?? null,
        current_cpc: body.current_cpc ?? null,
        consent_agreed: consent,
      });
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
      });
      return NextResponse.json({ ok: true }, { status: 202 });
    }

    // ── engagement ───────────────────────────────────────────
    case 'engagement': {
      void insertEngagementLog({
        session_id: body.session_id,
        user_id: body.user_id ?? null,
        event_type: body.event_type as 'page_view' | 'product_view' | 'cart_added' | 'checkout_start',
        product_id: body.product_id ?? null,
        product_name: body.product_name ?? null,
        cart_added: body.cart_added ?? false,
        page_url: body.page_url ?? null,
        lead_time_days: body.lead_time_days ?? null,
      });
      return NextResponse.json({ ok: true }, { status: 202 });
    }

    // ── conversion (순이익 자동 연산) ─────────────────────────
    case 'conversion': {
      const { session_id, user_id, booking_id, final_sales_price, base_cost } = body;

      // TrafficLog 역추적으로 광고 귀속 결정
      const traffic = await getLatestTrafficBySession(session_id);

      let allocated_ad_spend = 0;
      let attributed_source = 'organic';
      let attributed_gclid: string | null = null;
      let attributed_fbclid: string | null = null;

      if (traffic?.gclid) {
        attributed_source = 'google';
        attributed_gclid = traffic.gclid;
        allocated_ad_spend = traffic.current_cpc ?? 0;
      } else if (traffic?.fbclid) {
        attributed_source = 'facebook';
        attributed_fbclid = traffic.fbclid;
        allocated_ad_spend = traffic.current_cpc ?? 0;
      } else if (traffic?.n_keyword) {
        attributed_source = 'naver';
        allocated_ad_spend = traffic.current_cpc ?? 0;
      } else if (traffic?.source) {
        attributed_source = traffic.source;
      }

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
        attributed_fbclid,
      });

      // ── Postback ──────────────────────────────────────
      // Google Ads 전환 Postback
      if (attributed_gclid && process.env.GOOGLE_CONVERSION_ID) {
        try {
          await fetch(
            `https://www.googleadservices.com/pagead/conversion/${process.env.GOOGLE_CONVERSION_ID}/?gclid=${attributed_gclid}&value=${final_sales_price}&currency_code=KRW`
          );
          console.log(`[Postback] Google Ads 전환: gclid=${attributed_gclid}, value=${final_sales_price}`);
        } catch (e) {
          console.warn('[Postback] Google Ads 실패:', e instanceof Error ? e.message : e);
        }
      }

      // Meta Conversions API Postback
      if (attributed_fbclid && process.env.META_PIXEL_ID && process.env.META_ACCESS_TOKEN) {
        try {
          await fetch(`https://graph.facebook.com/v18.0/${process.env.META_PIXEL_ID}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: [{ event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000),
                user_data: { fbclid: attributed_fbclid },
                custom_data: { value: final_sales_price, currency: 'KRW' } }],
              access_token: process.env.META_ACCESS_TOKEN,
            }),
          });
          console.log(`[Postback] Meta CAPI 전환: fbclid=${attributed_fbclid}, value=${final_sales_price}`);
        } catch (e) {
          console.warn('[Postback] Meta CAPI 실패:', e instanceof Error ? e.message : e);
        }
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
