/**
 * POST /api/influencer/content
 *
 * 어필리에이터 포털 전용 콘텐츠 생성 API.
 *
 * Body:
 *   referral_code:  string  (PIN 인증 통과한 어필리에이터)
 *   product_id:     uuid
 *   platform:       'blog_body' | 'instagram_caption' | 'threads_post'
 *
 * 흐름:
 *   1. 어필리에이터 활성·승인 검증 (referral_code → affiliates.id)
 *   2. 상품 승인(approved) 검증
 *   3. ContentBrief 생성 → 플랫폼별 콘텐츠 생성
 *   4. payload에 co-branding 메타(affiliate.name/logo/handle) + 광고 표시 자동 주입
 *   5. content_distributions UPSERT (affiliate_id 포함)
 *
 * 반환: { distribution_id, payload, share_url }
 *   share_url 은 어필리에이터 자기 채널에 그대로 붙여넣을 referral 링크.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 90;

interface RequestBody {
  referral_code: string;
  /**
   * PIN 4자리 (어필리에이터 본인 인증 — referral_code 만으로는 무단 콘텐츠 생성 위험).
   * /api/influencer/dashboard 와 동일 인증 패턴.
   */
  pin: string;
  product_id: string;
  platform: 'blog_body' | 'instagram_caption' | 'threads_post';
}

const ALLOWED_PLATFORMS: ReadonlyArray<RequestBody['platform']> = [
  'blog_body',
  'instagram_caption',
  'threads_post',
];

const AD_DISCLOSURE = '여소남 제휴 콘텐츠 · 본 게시물은 추천 보상을 포함합니다 (광고)';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = (await request.json()) as RequestBody;
    if (!body.referral_code || !body.pin || !body.product_id || !body.platform) {
      return NextResponse.json({ error: 'referral_code, pin, product_id, platform 필수' }, { status: 400 });
    }
    if (!ALLOWED_PLATFORMS.includes(body.platform)) {
      return NextResponse.json({ error: '허용되지 않은 플랫폼' }, { status: 400 });
    }

    const { supabaseAdmin } = await import('@/lib/supabase');

    // 1. 어필리에이터 검증 + PIN 일치 + brute-force 방어
    // (LLM 비용이 발생하는 endpoint이므로 referral_code 단독 인증 금지 — /api/influencer/dashboard 와 동일 PIN 패턴)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const identifier = `content_${body.referral_code}_${ip}`;
    const PIN_WINDOW_MIN = 10;
    const PIN_MAX = 5;
    const windowStart = new Date(Date.now() - PIN_WINDOW_MIN * 60 * 1000).toISOString();
    const { count: attemptCount } = await supabaseAdmin
      .from('pin_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('identifier', identifier)
      .gte('attempted_at', windowStart);
    if (attemptCount && attemptCount >= PIN_MAX) {
      return NextResponse.json(
        { error: `시도 횟수 초과. ${PIN_WINDOW_MIN}분 후 재시도해주세요.` },
        { status: 429 },
      );
    }
    await supabaseAdmin.from('pin_attempts').insert({ identifier } as never);

    const { data: aff } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, referral_code, logo_url, channel_url, channel_type, grade_label, pin, phone, is_active')
      .eq('referral_code', body.referral_code)
      .maybeSingle();

    if (!aff || (aff as { is_active: boolean }).is_active !== true) {
      return NextResponse.json({ error: '어필리에이터를 찾을 수 없거나 비활성 상태' }, { status: 403 });
    }
    const a = aff as { id: string; pin: string | null; phone: string | null };
    const storedPin = a.pin || (a.phone ? a.phone.replace(/[^0-9]/g, '').slice(-4) : null);
    if (!storedPin || body.pin !== storedPin) {
      return NextResponse.json({ error: 'PIN 불일치' }, { status: 401 });
    }
    // 인증 성공 시 시도 기록 정리
    await supabaseAdmin.from('pin_attempts').delete().eq('identifier', identifier);
    const affiliate = aff as {
      id: string;
      name: string;
      referral_code: string;
      logo_url: string | null;
      channel_url: string | null;
      channel_type: string | null;
      grade_label: string | null;
      pin: string | null;
      phone: string | null;
      is_active: boolean;
    };

    // 2. 상품 검증 (approved만)
    const { data: pkg } = await supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, duration, nights, price, airline, departure_airport, inclusions, itinerary, status')
      .eq('id', body.product_id)
      .maybeSingle();

    if (!pkg || (pkg as { status?: string }).status !== 'approved') {
      return NextResponse.json({ error: '승인된 상품만 콘텐츠 생성 가능' }, { status: 404 });
    }

    // 3. brief + 플랫폼별 콘텐츠 생성
    const { generateContentBrief } = await import('@/lib/content-pipeline/content-brief');
    const product = { ...(pkg as Record<string, unknown>), product_id: body.product_id };
    const brief = await generateContentBrief({
      mode: 'product',
      slideCount: 6,
      product: product as never,
    });

    let generatedPayload: Record<string, unknown>;
    let agent = '';

    if (body.platform === 'blog_body') {
      const { generateBlogBody } = await import('@/lib/content-pipeline/blog-body');
      const md = await generateBlogBody({ brief, productContext: product as never });
      generatedPayload = {
        markdown: md,
        word_count: md.split(/\s+/).length,
        seo: brief.seo,
      };
      agent = 'blog-body-v1';
    } else if (body.platform === 'instagram_caption') {
      const { generateInstagramCaption } = await import('@/lib/content-pipeline/agents/instagram-caption');
      generatedPayload = (await generateInstagramCaption({ brief, product: product as never })) as Record<string, unknown>;
      agent = 'instagram-caption-v1';
    } else {
      // threads_post
      const { generateThreadsPost } = await import('@/lib/content-pipeline/agents/threads-post');
      generatedPayload = (await generateThreadsPost({ brief, product: product as never })) as Record<string, unknown>;
      agent = 'threads-post-v1';
    }

    // 4. Co-branding 메타 + 광고 표시 주입
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://yeosonam.co.kr';
    const shareUrl = `${baseUrl}/packages/${body.product_id}?ref=${affiliate.referral_code}`;

    const cobrand = {
      affiliate_id: affiliate.id,
      affiliate_name: affiliate.name,
      affiliate_handle: affiliate.referral_code,
      affiliate_logo_url: affiliate.logo_url,
      affiliate_channel_url: affiliate.channel_url,
      brand_name: '여소남',
      brand_url: baseUrl,
      share_url: shareUrl,
      ad_disclosure: AD_DISCLOSURE,
      generated_at: new Date().toISOString(),
    };

    // 공정위 추천·보증 심사지침: 본문 첫 줄·해시태그 모두에 "광고" 표시 강제 (메타에만 있으면 위반).
    if (body.platform === 'blog_body' && typeof generatedPayload.markdown === 'string') {
      const md = generatedPayload.markdown;
      const banner = `> **${AD_DISCLOSURE}**\n\n`;
      const footer = `\n\n---\n\n**발행:** ${affiliate.name}${affiliate.channel_url ? ` (${affiliate.channel_url})` : ''} × **여소남**\n\n[👉 이 상품 자세히 보기 / 예약하기](${shareUrl})\n\n*${AD_DISCLOSURE}*`;
      generatedPayload = {
        ...generatedPayload,
        markdown: banner + md + footer,
        word_count: (banner + md + footer).split(/\s+/).length,
      };
    } else if (body.platform === 'instagram_caption') {
      // 캡션 본문 첫 줄에 (광고) 강제 + 해시태그 #광고 #유료광고 강제 + 끝에 발행자 라인
      const caption = String(generatedPayload.caption || '');
      const captionWithAd = caption.startsWith('(광고)') ? caption : `(광고) ${caption}\n\n— ${affiliate.name} × 여소남\n${shareUrl}`;
      const tags = Array.isArray(generatedPayload.hashtags) ? (generatedPayload.hashtags as string[]) : [];
      const requiredTags = ['#광고', '#유료광고'];
      const merged = Array.from(new Set([...requiredTags, ...tags])).slice(0, 30);
      generatedPayload = { ...generatedPayload, caption: captionWithAd, hashtags: merged };
    } else if (body.platform === 'threads_post') {
      // 스레드 메인 첫 줄에 (광고) 강제 + 마지막 스레드에 발행자 라인 추가
      const main = String(generatedPayload.main || '');
      const mainWithAd = main.startsWith('(광고)') ? main : `(광고) ${main}`;
      const thread = Array.isArray(generatedPayload.thread) ? [...(generatedPayload.thread as string[])] : [];
      thread.push(`— ${affiliate.name} × 여소남\n${shareUrl}\n${AD_DISCLOSURE}`);
      generatedPayload = { ...generatedPayload, main: mainWithAd, thread };
    }

    const enrichedPayload = { ...generatedPayload, _cobrand: cobrand };

    // 5. content_distributions UPSERT
    const now = new Date().toISOString();
    const { data: existing } = await supabaseAdmin
      .from('content_distributions')
      .select('id')
      .eq('product_id', body.product_id)
      .eq('platform', body.platform)
      .eq('affiliate_id', affiliate.id)
      .maybeSingle();

    const row: Record<string, unknown> = {
      product_id: body.product_id,
      platform: body.platform,
      payload: enrichedPayload,
      affiliate_id: affiliate.id,
      is_co_branded: true,
      ad_disclosure: AD_DISCLOSURE,
      status: 'draft',
      generation_agent: agent,
      generation_config: { brief, by_affiliate: true },
      updated_at: now,
      created_by: `affiliate:${affiliate.referral_code}`,
    };

    let distribution_id: string;
    if (existing?.id) {
      const { error: upErr } = await supabaseAdmin
        .from('content_distributions')
        .update(row)
        .eq('id', existing.id);
      if (upErr) throw new Error(`업데이트 실패: ${upErr.message}`);
      distribution_id = existing.id as string;
    } else {
      const { data: ins, error: insErr } = await supabaseAdmin
        .from('content_distributions')
        .insert(row)
        .select('id')
        .single();
      if (insErr || !ins) throw new Error(`INSERT 실패: ${insErr?.message}`);
      distribution_id = (ins as { id: string }).id;
    }

    return NextResponse.json({
      distribution_id,
      payload: enrichedPayload,
      share_url: shareUrl,
      affiliate: {
        name: affiliate.name,
        referral_code: affiliate.referral_code,
        logo_url: affiliate.logo_url,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[influencer/content] 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// 어필리에이터의 콘텐츠 목록 조회
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ contents: [] });
  try {
    const { supabaseAdmin } = await import('@/lib/supabase');
    const { searchParams } = request.nextUrl;
    const code = searchParams.get('code');
    if (!code) return NextResponse.json({ error: 'code 필수' }, { status: 400 });

    const { data: aff } = await supabaseAdmin
      .from('affiliates')
      .select('id')
      .eq('referral_code', code)
      .maybeSingle();

    if (!aff) return NextResponse.json({ contents: [] });

    const { data, error } = await supabaseAdmin
      .from('content_distributions')
      .select('id, product_id, platform, status, payload, generation_agent, created_at, updated_at, published_at, external_url')
      .eq('affiliate_id', (aff as { id: string }).id)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return NextResponse.json({ contents: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '조회 실패' },
      { status: 500 },
    );
  }
}
