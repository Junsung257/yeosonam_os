import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getCardNewsById, upsertCardNews } from '@/lib/supabase';

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();

    const updated = await upsertCardNews({
      id: params.id,
      title: body.title ?? '제목 없음',
      ...body,
    });

    return NextResponse.json({ card_news: updated });
  } catch (error) {
    console.error('카드뉴스 수정 실패:', error);
    return NextResponse.json({ error: '수정 실패' }, { status: 500 });
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
    const updated = await upsertCardNews({
      id: params.id,
      title: '',
      status: 'ARCHIVED',
    });
    return NextResponse.json({ card_news: updated });
  } catch (error) {
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
