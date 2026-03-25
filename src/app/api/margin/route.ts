import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ margin: null });
  }

  const { searchParams } = new URL(request.url);
  const packageId = searchParams.get('packageId');

  if (!packageId) {
    return NextResponse.json({ error: 'packageId가 필요합니다.' }, { status: 400 });
  }

  try {
    const { data, error } = await supabase
      .from('margin_settings')
      .select('*')
      .eq('package_id', packageId)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
    return NextResponse.json({ margin: data || null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '조회 실패' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }

  try {
    const { packageId, basePrice, vipMargin, regularMargin, bulkMargin } = await request.json();

    if (!packageId || basePrice === undefined) {
      return NextResponse.json({ error: 'packageId와 basePrice가 필요합니다.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('margin_settings')
      .upsert(
        {
          package_id: packageId,
          base_price: basePrice,
          vip_margin_percent: vipMargin ?? 10,
          regular_margin_percent: regularMargin ?? 15,
          bulk_margin_percent: bulkMargin ?? 20,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'package_id' }
      )
      .select();

    if (error) throw error;
    return NextResponse.json({ success: true, margin: data?.[0] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '저장 실패' },
      { status: 500 }
    );
  }
}
