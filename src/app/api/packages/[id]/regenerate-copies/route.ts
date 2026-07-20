import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { supabaseAdmin } from '@/lib/supabase';
import { generateMarketingCopies } from '@/lib/ai';
import { loadPublicContentPackageForGeneration } from '@/lib/content-public-package';

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  const params = await props.params;
  const { id } = params;

  if (!id) {
    return NextResponse.json({ error: 'id 파라미터가 필요합니다.' }, { status: 400 });
  }

  const pkg = await loadPublicContentPackageForGeneration(id);

  if (!pkg) {
    return NextResponse.json(
      { error: '고객 공개 승인된 상품만 고객용 문구를 재생성할 수 있습니다.' },
      { status: 404 },
    );
  }
  if (!pkg.destination || typeof pkg.duration !== 'number' || typeof pkg.price !== 'number') {
    return NextResponse.json(
      { error: '목적지, 기간, 가격이 공개 승인된 상품만 고객용 문구를 재생성할 수 있습니다.' },
      { status: 422 },
    );
  }

  let marketing_copies;
  try {
    marketing_copies = await generateMarketingCopies({
      destination:  pkg.destination,
      duration:     pkg.duration,
      price:        pkg.price,
      highlights:   Array.isArray(pkg.product_highlights) ? pkg.product_highlights : [],
      inclusions:   Array.isArray(pkg.inclusions) ? pkg.inclusions : [],
      rawText:      pkg.product_summary ?? pkg.title,
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
