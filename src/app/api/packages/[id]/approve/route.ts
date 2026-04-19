import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import type { MarketingCopy } from '@/lib/ai';

interface ApproveBody {
  action: 'approve' | 'reject';
  title?: string;
  summary?: string;
  selectedCopyType?: string;
  /** audit_status === 'warnings' 상품을 강제 승인할 때 true */
  force?: boolean;
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
    .select('id, internal_code, marketing_copies, status, title, audit_status, audit_report')
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
    // 🆕 감사 게이트 (ERR-FUK-rawtext-pollution 재발 방지)
    // audit_status === 'blocked' → 승인 차단. 수정 후 재감사 필요.
    // audit_status === 'warnings' → force=true 필요. 감사 리포트 확인했다는 명시적 신호.
    // 레거시 상품(audit_status === null)은 기존 동작 유지.
    const force = body.force === true;
    if ((pkg as { audit_status?: string }).audit_status === 'blocked') {
      return NextResponse.json(
        {
          error: '감사 차단 상태입니다. 수정 후 post_register_audit.js 재실행 후에 승인할 수 있습니다.',
          audit_status: 'blocked',
          audit_report: (pkg as { audit_report?: unknown }).audit_report ?? null,
        },
        { status: 409 },
      );
    }
    if ((pkg as { audit_status?: string }).audit_status === 'warnings' && !force) {
      return NextResponse.json(
        {
          error: '경고가 있는 상품입니다. 감사 리포트를 확인한 뒤 force=true 로 재호출하세요.',
          audit_status: 'warnings',
          audit_report: (pkg as { audit_report?: unknown }).audit_report ?? null,
        },
        { status: 409 },
      );
    }
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
