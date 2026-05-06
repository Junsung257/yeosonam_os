import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin, getCardNewsById } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';
import { insertBlogTopicQueue } from '@/lib/card-news/blog-topic-queue';

function resolveAppOriginForInternalFetch(): string {
  const u = getSecret('NEXT_PUBLIC_APP_URL') || getSecret('NEXT_PUBLIC_BASE_URL');
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

    // CONFIRMED 요청 시: renders 존재 여부로 게이팅
    // renders 없음 → RENDERING으로 전환, render-v2 kick → render 완료 후 자동 CONFIRMED
    // renders 있음 → 바로 CONFIRMED 허용
    if (patch.status === 'CONFIRMED') {
      const { count: renderCount } = await supabaseAdmin
        .from('card_news_renders')
        .select('id', { count: 'exact', head: true })
        .eq('card_news_id', params.id);
      if (!renderCount || renderCount === 0) {
        patch.status = 'RENDERING';
      }
    }

    const { data, error } = await supabaseAdmin
      .from('card_news')
      .update(patch as never)
      .eq('id', params.id)
      .select()
      .single();
    if (error) throw error;

    // RENDERING 전환 시: 렌더 kick (render-v2 완료 후 자동 CONFIRMED + blog_topic_queue 처리)
    if (patch.status === 'RENDERING' && data) {
      const cn = data as Record<string, unknown>;
      const isHtml =
        cn.template_family === 'html' &&
        typeof cn.html_generated === 'string' &&
        (cn.html_generated as string).trim().length > 0;
      const hasSlides =
        Array.isArray(cn.slides) && (cn.slides as unknown[]).length > 0;

      const origin = resolveAppOriginForInternalFetch();
      if (isHtml) {
        fetch(`${origin}/api/card-news/${params.id}/render-html-to-png`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }).catch((e) =>
          console.warn(`[CardNews Hook] render-html-to-png 트리거 실패 ${params.id}:`, e),
        );
      } else if (hasSlides) {
        fetch(`${origin}/api/card-news/render-v2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ card_news_id: params.id, formats: ['1x1'] }),
        }).catch((e) =>
          console.warn(`[CardNews Hook] render-v2 트리거 실패 ${params.id}:`, e),
        );
      }
    }

    // CONFIRMED 전환 시 (renders 이미 존재하는 경우): blog_topic_queue 직접 insert
    if (patch.status === 'CONFIRMED' && data) {
      try {
        await insertBlogTopicQueue(params.id, 'card_news_confirm_hook');
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
