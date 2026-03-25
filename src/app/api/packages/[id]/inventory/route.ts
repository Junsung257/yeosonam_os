import { NextRequest, NextResponse } from 'next/server';
import { getInventoryBlocks, isSupabaseConfigured } from '@/lib/supabase';

// GET /api/packages/[id]/inventory?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

  const blocks = await getInventoryBlocks(id, from, to);

  // OPEN 상태 + available_seats > 0 인 미래 날짜만 필터
  const today = new Date().toISOString().slice(0, 10);
  const available = blocks.filter(b => b.date >= today && b.status === 'OPEN' && b.available_seats > 0);

  return NextResponse.json({ blocks: available });
}
