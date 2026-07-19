import { NextRequest, NextResponse } from 'next/server';
import { getPublicInventoryBlocks, isSupabaseConfigured } from '@/lib/supabase';

// GET /api/packages/[id]/inventory?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ blocks: [] });
  }

  const { id } = params;
  const from = request.nextUrl.searchParams.get('from') ?? new Date().toISOString().slice(0, 10);
  // 기본 to: from 기준 3개월 후
  const defaultTo = new Date(new Date(from).getTime() + 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const to = request.nextUrl.searchParams.get('to') ?? defaultTo;

  const today = new Date().toISOString().slice(0, 10);
  try {
    const blocks = await getPublicInventoryBlocks(id, from < today ? today : from, to);
    if (!blocks) {
      return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
    }

    const publicBlocks = blocks.map((block) => ({
      date: block.date,
      available_seats: block.available_seats,
      ...(block.price_override == null ? {} : { price_override: block.price_override }),
    }));

    return NextResponse.json(
      { blocks: publicBlocks },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
    );
  } catch (error) {
    console.error('[public-inventory] lookup failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '재고 조회에 실패했습니다.' }, { status: 500 });
  }
}
