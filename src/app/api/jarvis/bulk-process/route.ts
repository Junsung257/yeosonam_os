/**
 * POST /api/jarvis/bulk-process
 * 자비스 대량 예약 일괄 처리 엔드포인트
 * Body: { items: BulkItem[] }
 * Returns: { total, success_count, failed_count, success_list, failed_list }
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { processBulkReservations, type BulkItem } from '@/lib/bulk-reservations';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  let items: BulkItem[];
  try {
    const body = await request.json();
    items = body.items;
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items 배열이 필요합니다' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식' }, { status: 400 });
  }

  const result = await processBulkReservations(items);
  return NextResponse.json(result);
}
