import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  createSharedItinerary,
  getSharedItinerary,
} from '@/lib/supabase';

// POST /api/share — 공유 링크 생성
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json();
  const {
    share_type,
    creator_name = '익명',
    // DYNAMIC
    items,
    search_query,
    // FIXED
    product_id,
    product_name,
    review_text,
  } = body as {
    share_type:    'DYNAMIC' | 'FIXED';
    creator_name?: string;
    items?:        unknown[];
    search_query?: string;
    product_id?:   string;
    product_name?: string;
    review_text?:  string;
  };

  if (!share_type || !['DYNAMIC', 'FIXED'].includes(share_type)) {
    return NextResponse.json({ error: 'share_type 필수 (DYNAMIC|FIXED)' }, { status: 400 });
  }
  if (share_type === 'DYNAMIC' && (!items || !items.length)) {
    return NextResponse.json({ error: 'DYNAMIC 공유는 items 필수' }, { status: 400 });
  }
  if (share_type === 'FIXED' && !product_id) {
    return NextResponse.json({ error: 'FIXED 공유는 product_id 필수' }, { status: 400 });
  }

  const shared = await createSharedItinerary({
    share_type,
    creator_name,
    items:        share_type === 'DYNAMIC' ? (items as import('@/lib/supabase').CartItem[]) : undefined,
    search_query: share_type === 'DYNAMIC' ? search_query : undefined,
    product_id:   share_type === 'FIXED' ? product_id : undefined,
    product_name: share_type === 'FIXED' ? product_name : undefined,
    review_text:  share_type === 'FIXED' ? review_text : undefined,
  });

  if (!shared) {
    return NextResponse.json({ error: '공유 링크 생성 실패' }, { status: 500 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? '';
  const share_url = `${baseUrl}/share/${shared.share_code}`;

  return NextResponse.json({ share_code: shared.share_code, share_url });
}

// GET /api/share?code=XXXXXXXX — 공유 조회
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.json({ error: 'code 파라미터 필수' }, { status: 400 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const shared = await getSharedItinerary(code);
  if (!shared) {
    return NextResponse.json({ error: '존재하지 않거나 만료된 링크입니다.' }, { status: 404 });
  }

  return NextResponse.json({ shared });
}
