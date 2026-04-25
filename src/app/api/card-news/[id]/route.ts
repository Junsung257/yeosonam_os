import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin, getCardNewsById } from '@/lib/supabase';

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
