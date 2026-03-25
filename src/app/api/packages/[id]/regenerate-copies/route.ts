import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateMarketingCopies } from '@/lib/ai';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params;

  if (!id) {
    return NextResponse.json({ error: 'id 파라미터가 필요합니다.' }, { status: 400 });
  }

  const { data: pkg, error: fetchError } = await supabaseAdmin
    .from('travel_packages')
    .select('id, title, destination, price, product_highlights, inclusions, product_summary')
    .eq('id', id)
    .single();

  if (fetchError || !pkg) {
    return NextResponse.json(
      { error: fetchError?.message ?? '상품을 찾을 수 없습니다.' },
      { status: 404 },
    );
  }

  let marketing_copies;
  try {
    marketing_copies = await generateMarketingCopies({
      destination:  pkg.destination ?? '',
      duration:     5,
      price:        pkg.price ?? 0,
      highlights:   Array.isArray(pkg.product_highlights) ? pkg.product_highlights : [],
      inclusions:   Array.isArray(pkg.inclusions) ? pkg.inclusions : [],
      rawText:      pkg.product_summary ?? pkg.title ?? '',
    });
  } catch (err) {
    return NextResponse.json(
      { error: `AI 생성 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}` },
      { status: 500 },
    );
  }

  const { error: updateError } = await supabaseAdmin
    .from('travel_packages')
    .update({ marketing_copies, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (updateError) {
    return NextResponse.json(
      { error: `DB 업데이트 실패: ${updateError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, marketing_copies });
}
