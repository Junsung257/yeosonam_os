/**
 * POST /api/content/generate-all
 *
 * Orchestrator — 1개 상품으로 여러 플랫폼 아웃풋 병렬 생성.
 *
 * Body:
 *   {
 *     product_id: string,
 *     platforms?: Array<'instagram_caption'|'threads_post'|'card_news'>,  // 기본 전체
 *     card_news_id?: string,   // 기존 카드뉴스 연계 시
 *   }
 *
 * 비용 최적화:
 *   - Brief 는 한 번만 생성해 모든 에이전트가 공유 (중복 LLM 호출 회피)
 *   - 플랫폼별 에이전트는 Promise.all 병렬
 *
 * Response:
 *   {
 *     brief: ContentBrief (생성된 공용 brief),
 *     results: {
 *       instagram_caption?: { distribution_id, payload },
 *       threads_post?:      { distribution_id, payload },
 *       card_news?:         { card_news_id },
 *     },
 *     errors: { [platform]: string }
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { generateContentBrief } from '@/lib/content-pipeline/content-brief';
import { generateInstagramCaption } from '@/lib/content-pipeline/agents/instagram-caption';
import { generateThreadsPost } from '@/lib/content-pipeline/agents/threads-post';
import { generateMetaAds } from '@/lib/content-pipeline/agents/meta-ads';
import { generateGoogleAdsRSA } from '@/lib/content-pipeline/agents/google-ads-rsa';
import { generateKakaoChannelMessage } from '@/lib/content-pipeline/agents/kakao-channel';
import { generateBlogBody } from '@/lib/content-pipeline/blog-body';
import type { ContentBrief } from '@/lib/validators/content-brief';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Platform =
  | 'instagram_caption'
  | 'threads_post'
  | 'meta_ads'
  | 'google_ads_rsa'
  | 'kakao_channel'
  | 'blog_body'
  | 'card_news';

interface RequestBody {
  product_id: string;
  platforms?: Platform[];
  card_news_id?: string;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = (await request.json()) as RequestBody;
    if (!body.product_id) {
      return NextResponse.json({ error: 'product_id 필수' }, { status: 400 });
    }

    const platforms: Platform[] = body.platforms ?? [
      'instagram_caption',
      'threads_post',
      'meta_ads',
      'google_ads_rsa',
      'kakao_channel',
      'blog_body',
    ];

    // 1. Product 조회
    const { data: pkg, error: pkgErr } = await supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, duration, nights, price, airline, departure_airport, product_summary, product_highlights, inclusions, itinerary, special_notes')
      .eq('id', body.product_id)
      .single();
    if (pkgErr || !pkg) {
      return NextResponse.json({ error: '상품 조회 실패' }, { status: 404 });
    }
    const product = pkg as never;

    // 2. Brief 1회만 생성 (모든 에이전트 공유)
    const brief: ContentBrief = await generateContentBrief({
      mode: 'product',
      slideCount: 6,
      product,
    });

    // 3. 플랫폼별 병렬 실행
    const errors: Record<string, string> = {};
    const results: Record<string, unknown> = {};

    const tasks: Array<Promise<void>> = [];

    if (platforms.includes('instagram_caption')) {
      tasks.push((async () => {
        try {
          const caption = await generateInstagramCaption({ brief, product });
          const { data: existing } = await supabaseAdmin
            .from('content_distributions')
            .select('id')
            .eq('product_id', body.product_id)
            .eq('platform', 'instagram_caption')
            .maybeSingle();

          const row = {
            product_id: body.product_id,
            card_news_id: body.card_news_id ?? null,
            platform: 'instagram_caption',
            payload: caption,
            status: 'draft',
            generation_agent: 'instagram-caption-v1',
            generation_config: { brief },
            updated_at: new Date().toISOString(),
          };

          let id: string;
          if (existing?.id) {
            await supabaseAdmin.from('content_distributions').update(row).eq('id', existing.id);
            id = existing.id as string;
          } else {
            const { data: ins } = await supabaseAdmin
              .from('content_distributions')
              .insert(row)
              .select('id')
              .single();
            id = ins?.id as string;
          }
          results.instagram_caption = { distribution_id: id, payload: caption };
        } catch (err) {
          errors.instagram_caption = err instanceof Error ? err.message : String(err);
        }
      })());
    }

    if (platforms.includes('threads_post')) {
      tasks.push((async () => {
        try {
          const post = await generateThreadsPost({ brief, product });
          const { data: existing } = await supabaseAdmin
            .from('content_distributions')
            .select('id')
            .eq('product_id', body.product_id)
            .eq('platform', 'threads_post')
            .maybeSingle();

          const row = {
            product_id: body.product_id,
            card_news_id: body.card_news_id ?? null,
            platform: 'threads_post',
            payload: post,
            status: 'draft',
            generation_agent: 'threads-post-v1',
            generation_config: { brief },
            updated_at: new Date().toISOString(),
          };

          let id: string;
          if (existing?.id) {
            await supabaseAdmin.from('content_distributions').update(row).eq('id', existing.id);
            id = existing.id as string;
          } else {
            const { data: ins } = await supabaseAdmin
              .from('content_distributions')
              .insert(row)
              .select('id')
              .single();
            id = ins?.id as string;
          }
          results.threads_post = { distribution_id: id, payload: post };
        } catch (err) {
          errors.threads_post = err instanceof Error ? err.message : String(err);
        }
      })());
    }

    // Meta Ads
    if (platforms.includes('meta_ads')) {
      tasks.push((async () => {
        try {
          const ads = await generateMetaAds({ brief, product });
          const { data: existing } = await supabaseAdmin
            .from('content_distributions').select('id')
            .eq('product_id', body.product_id).eq('platform', 'meta_ads').maybeSingle();
          const row = {
            product_id: body.product_id, card_news_id: body.card_news_id ?? null,
            platform: 'meta_ads', payload: ads, status: 'draft',
            generation_agent: 'meta-ads-v1', generation_config: { brief },
            updated_at: new Date().toISOString(),
          };
          let id: string;
          if (existing?.id) {
            await supabaseAdmin.from('content_distributions').update(row).eq('id', existing.id);
            id = existing.id as string;
          } else {
            const { data: ins } = await supabaseAdmin.from('content_distributions').insert(row).select('id').single();
            id = ins?.id as string;
          }
          results.meta_ads = { distribution_id: id, payload: ads };
        } catch (err) {
          errors.meta_ads = err instanceof Error ? err.message : String(err);
        }
      })());
    }

    // Google Ads RSA
    if (platforms.includes('google_ads_rsa')) {
      tasks.push((async () => {
        try {
          const rsa = await generateGoogleAdsRSA({ brief, product });
          const { data: existing } = await supabaseAdmin
            .from('content_distributions').select('id')
            .eq('product_id', body.product_id).eq('platform', 'google_ads_rsa').maybeSingle();
          const row = {
            product_id: body.product_id, card_news_id: body.card_news_id ?? null,
            platform: 'google_ads_rsa', payload: rsa, status: 'draft',
            generation_agent: 'google-ads-rsa-v1', generation_config: { brief },
            updated_at: new Date().toISOString(),
          };
          let id: string;
          if (existing?.id) {
            await supabaseAdmin.from('content_distributions').update(row).eq('id', existing.id);
            id = existing.id as string;
          } else {
            const { data: ins } = await supabaseAdmin.from('content_distributions').insert(row).select('id').single();
            id = ins?.id as string;
          }
          results.google_ads_rsa = { distribution_id: id, payload: rsa };
        } catch (err) {
          errors.google_ads_rsa = err instanceof Error ? err.message : String(err);
        }
      })());
    }

    // Kakao Channel
    if (platforms.includes('kakao_channel')) {
      tasks.push((async () => {
        try {
          const msg = await generateKakaoChannelMessage({ brief, product });
          const { data: existing } = await supabaseAdmin
            .from('content_distributions').select('id')
            .eq('product_id', body.product_id).eq('platform', 'kakao_channel').maybeSingle();
          const row = {
            product_id: body.product_id, card_news_id: body.card_news_id ?? null,
            platform: 'kakao_channel', payload: msg, status: 'draft',
            generation_agent: 'kakao-channel-v1', generation_config: { brief },
            updated_at: new Date().toISOString(),
          };
          let id: string;
          if (existing?.id) {
            await supabaseAdmin.from('content_distributions').update(row).eq('id', existing.id);
            id = existing.id as string;
          } else {
            const { data: ins } = await supabaseAdmin.from('content_distributions').insert(row).select('id').single();
            id = ins?.id as string;
          }
          results.kakao_channel = { distribution_id: id, payload: msg };
        } catch (err) {
          errors.kakao_channel = err instanceof Error ? err.message : String(err);
        }
      })());
    }

    // Blog Body
    if (platforms.includes('blog_body')) {
      tasks.push((async () => {
        try {
          const markdown = await generateBlogBody({ brief, productContext: product });
          const payload = {
            markdown,
            word_count: markdown.split(/\s+/).length,
            seo: brief.seo,
          };
          const { data: existing } = await supabaseAdmin
            .from('content_distributions').select('id')
            .eq('product_id', body.product_id).eq('platform', 'blog_body').maybeSingle();
          const row = {
            product_id: body.product_id, card_news_id: body.card_news_id ?? null,
            platform: 'blog_body', payload, status: 'draft',
            generation_agent: 'blog-body-v1', generation_config: { brief },
            updated_at: new Date().toISOString(),
          };
          let id: string;
          if (existing?.id) {
            await supabaseAdmin.from('content_distributions').update(row).eq('id', existing.id);
            id = existing.id as string;
          } else {
            const { data: ins } = await supabaseAdmin.from('content_distributions').insert(row).select('id').single();
            id = ins?.id as string;
          }
          results.blog_body = { distribution_id: id, payload };
        } catch (err) {
          errors.blog_body = err instanceof Error ? err.message : String(err);
        }
      })());
    }

    await Promise.all(tasks);

    return NextResponse.json({
      brief,
      results,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[generate-all] 실패:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  // 상품의 기존 distributions 조회
  if (!isSupabaseConfigured) return NextResponse.json({ distributions: [] });
  const product_id = request.nextUrl.searchParams.get('product_id');
  if (!product_id) return NextResponse.json({ error: 'product_id 필수' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('content_distributions')
    .select('id, platform, payload, status, scheduled_for, published_at, updated_at')
    .eq('product_id', product_id)
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ distributions: data ?? [] });
}
