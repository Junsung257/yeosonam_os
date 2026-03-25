import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import type { MarketingCopy } from '@/lib/ai';

interface ApproveBody {
  action: 'approve' | 'reject';
  title?: string;
  summary?: string;
  selectedCopyType?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params;

  if (!id) {
    return NextResponse.json({ error: 'id 파라미터가 필요합니다.' }, { status: 400 });
  }

  let body: ApproveBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 본문이 유효하지 않습니다.' }, { status: 400 });
  }

  const { action, title, summary, selectedCopyType } = body;

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action은 approve 또는 reject여야 합니다.' }, { status: 400 });
  }

  // ── 현재 패키지 조회 (internal_code + marketing_copies 필요) ────────────────

  const { data: pkg, error: fetchError } = await supabaseAdmin
    .from('travel_packages')
    .select('id, internal_code, marketing_copies, status')
    .eq('id', id)
    .single();

  if (fetchError || !pkg) {
    return NextResponse.json(
      { error: fetchError?.message ?? '상품을 찾을 수 없습니다.' },
      { status: 404 },
    );
  }

  // ── 승인 처리 ─────────────────────────────────────────────────────────────

  if (action === 'approve') {
    // marketing_copies에 selected 플래그 업데이트
    const updatedCopies: MarketingCopy[] = Array.isArray(pkg.marketing_copies)
      ? (pkg.marketing_copies as MarketingCopy[]).map(c => ({
          ...c,
          selected: c.type === selectedCopyType,
        }))
      : [];

    const { error: pkgError } = await supabaseAdmin
      .from('travel_packages')
      .update({
        status:           'active',
        title:            title?.trim() || pkg.title,
        product_summary:  summary?.trim() ?? null,
        marketing_copies: updatedCopies,
        updated_at:       new Date().toISOString(),
      })
      .eq('id', id);

    if (pkgError) {
      return NextResponse.json(
        { error: `travel_packages 업데이트 실패: ${pkgError.message}` },
        { status: 500 },
      );
    }

    // products 테이블도 active로 동기화 (FK 연결된 경우)
    if (pkg.internal_code) {
      const { error: productError } = await supabaseAdmin
        .from('products')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('internal_code', pkg.internal_code);

      if (productError) {
        // products 업데이트 실패는 경고만 — travel_packages 배포는 유지
        console.warn('[Approve API] products 상태 업데이트 실패 (비중단):', productError.message);
      }
    }

    return NextResponse.json({ ok: true, status: 'active', internal_code: pkg.internal_code });
  }

  // ── 반려 처리 ─────────────────────────────────────────────────────────────

  const { error: rejectError } = await supabaseAdmin
    .from('travel_packages')
    .update({
      status:     'draft',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (rejectError) {
    return NextResponse.json(
      { error: `반려 처리 실패: ${rejectError.message}` },
      { status: 500 },
    );
  }

  if (pkg.internal_code) {
    await supabaseAdmin
      .from('products')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('internal_code', pkg.internal_code);
  }

  return NextResponse.json({ ok: true, status: 'draft' });
}
