import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin, getCardNewsById } from '@/lib/supabase';

function resolveAppOriginForInternalFetch(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (u) return u.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://127.0.0.1:${process.env.PORT ?? 3000}`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const cardNews = await getCardNewsById(params.id);
    if (!cardNews) {
      return NextResponse.json({ error: '카드뉴스를 찾을 수 없습니다' }, { status: 404 });
    }
    return NextResponse.json({ card_news: cardNews });
  } catch (error) {
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }
}

/**
 * 부분 업데이트 전용 PATCH. body 에 포함된 필드만 UPDATE.
 * (기존 구현은 title 누락 시 "제목 없음" 으로 덮어씀 — 버그였음)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    // 쓰기 허용 필드 화이트리스트
    const ALLOWED = new Set([
      'title', 'slides', 'status', 'template_family', 'template_version',
      'brand_kit_id', 'generation_config', 'category_id', 'slide_image_urls',
      'linked_blog_id', 'ig_caption', 'ig_slide_urls',
      // HTML 모드 (Claude Sonnet 4.6 + Puppeteer)
      'html_raw', 'html_generated', 'html_thinking', 'html_usage',
    ]);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (ALLOWED.has(k)) patch[k] = v;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: '변경할 필드 없음' }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('card_news')
      .update(patch as never)
      .eq('id', params.id)
      .select()
      .single();
    if (error) throw error;

    // CONFIRMED 전환 시: PNG 자동 렌더 트리거(필요 시) + 블로그 큐 insert
    if (patch.status === 'CONFIRMED' && data) {
      try {
        const { count } = await supabaseAdmin
          .from('blog_topic_queue')
          .select('id', { count: 'exact', head: true })
          .eq('card_news_id', params.id)
          .neq('status', 'failed');
        if (count === 0) {
          const cn = data as Record<string, unknown>;
          const hasColUrls =
            Array.isArray(cn.slide_image_urls) && (cn.slide_image_urls as string[]).length > 0;

          const isHtml =
            cn.template_family === 'html' &&
            typeof cn.html_generated === 'string' &&
            (cn.html_generated as string).trim().length > 0;
          const slides = cn.slides as unknown[] | undefined;
          const hasSlides = Array.isArray(slides) && slides.length > 0;

          let autoRenderKicked = false;
          const origin = resolveAppOriginForInternalFetch();
          if (!hasColUrls && isHtml) {
            autoRenderKicked = true;
            fetch(`${origin}/api/card-news/${params.id}/render-html-to-png`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            }).catch((e) =>
              console.warn(`[CardNews Hook] render-html-to-png 트리거 실패 ${params.id}:`, e),
            );
          } else if (!hasColUrls && hasSlides) {
            autoRenderKicked = true;
            fetch(`${origin}/api/card-news/render-v2`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ card_news_id: params.id, formats: ['1x1'] }),
            }).catch((e) => console.warn(`[CardNews Hook] render-v2 트리거 실패 ${params.id}:`, e));
          }

          const { getEarliestBlogPublishEligibleMs } = await import('@/lib/card-news-render-readiness');
          const eligibleMs = await getEarliestBlogPublishEligibleMs(params.id);
          const minScheduleMs = Date.now() + 30 * 60 * 1000;
          const rawGrace = process.env.CARD_NEWS_CONFIRM_RENDER_GRACE_MS;
          const graceParsed = rawGrace ? parseInt(rawGrace, 10) : NaN;
          const renderGraceMs =
            Number.isFinite(graceParsed) && graceParsed >= 0 ? graceParsed : 20 * 60 * 1000;
          const renderGraceAt = Date.now() + renderGraceMs;
          const targetAt = new Date(
            autoRenderKicked
              ? Math.max(minScheduleMs, eligibleMs, renderGraceAt)
              : Math.max(minScheduleMs, eligibleMs),
          );

          await supabaseAdmin.from('blog_topic_queue').insert({
            source: 'card_news',
            card_news_id: params.id,
            topic: (cn.title as string) || '카드뉴스 블로그',
            priority: 90,
            category: 'card_news',
            primary_keyword: ((cn.title as string) || '').substring(0, 30),
            keyword_tier: 'mid',
            target_publish_at: targetAt.toISOString(),
            status: 'queued',
            meta: {
              auto_queued_by: 'card_news_confirm_hook',
              auto_render_kicked: autoRenderKicked,
            },
          });
        }
      } catch (hookErr) {
        console.error(`[CardNews Hook] blog_topic_queue insert 실패 card_news_id=${params.id}:`, hookErr);
      }
    }

    return NextResponse.json({ card_news: data });
  } catch (error) {
    console.error('카드뉴스 수정 실패:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('card_news')
      .update({ status: 'ARCHIVED', updated_at: new Date().toISOString() } as never)
      .eq('id', params.id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ card_news: data });
  } catch (error) {
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
