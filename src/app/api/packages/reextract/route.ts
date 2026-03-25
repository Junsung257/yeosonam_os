/**
 * POST /api/packages/reextract
 * body: { packageId: string }
 *
 * DB에 저장된 raw_text로 itinerary_data를 재추출해 업데이트.
 * PDF 재업로드 없이 AI 일정표 재생성 가능.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { extractItineraryData } from '@/lib/parser';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
  }

  const { packageId } = await request.json();
  if (!packageId) {
    return NextResponse.json({ error: 'packageId 필요' }, { status: 400 });
  }

  // 저장된 raw_text 조회
  const { data: pkg, error: fetchError } = await supabase
    .from('travel_packages')
    .select('id, raw_text')
    .eq('id', packageId)
    .single();

  if (fetchError || !pkg) {
    return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });
  }

  const rawText = (pkg as { raw_text?: string }).raw_text || '';
  if (!rawText) {
    return NextResponse.json({ error: '저장된 텍스트가 없습니다. PDF를 재업로드해주세요.' }, { status: 400 });
  }

  // AI로 일정표 재추출
  const itineraryData = await extractItineraryData(rawText);

  if (!itineraryData) {
    return NextResponse.json({ error: 'AI 일정표 추출 실패. Google AI API 키를 확인하세요.' }, { status: 500 });
  }

  // DB 업데이트
  const { error: updateError } = await supabase
    .from('travel_packages')
    .update({ itinerary_data: itineraryData, updated_at: new Date().toISOString() })
    .eq('id', packageId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, days: itineraryData.days?.length ?? 0 });
}
