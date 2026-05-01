import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import type { MarketingCopy } from '@/lib/ai';
import { recomputeGroupForPackage } from '@/lib/scoring/recommend';
import { indexPackage } from '@/lib/jarvis/rag/indexer';

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

    // ── 점수 그룹 자동 재계산 (신상품 등록 시 기존 상품 점수 자동 하락 보장) ──
    let scoreInfo: { group_size: number; group_key: string } | null = null;
    try {
      const result = await recomputeGroupForPackage(id);
      scoreInfo = { group_size: result.group_size, group_key: result.group_key };
    } catch (e) {
      // 점수 산출 실패해도 approve 자체는 성공 (안전망: 새벽 cron 이 처리)
      console.warn('[Approve API] 점수 그룹 재계산 실패 (비중단):', e instanceof Error ? e.message : e);
    }

    // ── 🆕 자비스 RAG 자동 인덱싱 (v5, 2026-04-30) ──
    // 상품 승인 즉시 자비스가 학습. 실패해도 approve 자체 흐름 막지 않음 (cron 보호)
    let ragInfo: { inserted: number; skipped: number; failed: number } | null = null;
    try {
      ragInfo = await indexPackage(id);
    } catch (e) {
      console.warn('[Approve API] RAG 인덱싱 실패 (비중단):', e instanceof Error ? e.message : e);
    }

    // ISR 캐시 즉시 무효화 — 모바일 /packages 즉시 반영
    try {
      revalidatePath('/packages');
      revalidatePath(`/packages/${id}`);
    } catch (e) {
      console.warn('[Approve API] revalidatePath 실패 (비중단):', e instanceof Error ? e.message : e);
    }

    // ── 🆕 정책 기반 자동 트리거 ──
    let dripInfo: { queued: number; angles: string[] } | null = null;
    let cardNewsInfo: { triggered: boolean; reason?: string } | null = null;
    let orchestratorInfo: { triggered: boolean; reason?: string } | null = null;

    // 정책 조회
    const { getActivePolicy } = await import('@/lib/blog-scheduler');
    const policy = await getActivePolicy('global').catch(() => null);

    // 1) Multi-angle drip (정책과 무관 — 항상 ON, 가성비 좋음)
    try {
      const { enqueueMultiAngleDrip } = await import('@/lib/multi-angle-drip');
      const drip = await enqueueMultiAngleDrip(id);
      dripInfo = {
        queued: drip.queued,
        angles: drip.schedule.map(s => s.angle),
      };
      const { assignPublishSlots } = await import('@/lib/blog-scheduler');
      await assignPublishSlots();
    } catch (e) {
      console.warn('[Approve API] multi-angle drip 실패 (비중단):', e instanceof Error ? e.message : e);
    }

    // 2) 카드뉴스 자동 변형 (정책 ON 시 + ANTHROPIC_API_KEY 있을 때 — 건당 ~$0.05)
    if (policy?.auto_trigger_card_news && process.env.ANTHROPIC_API_KEY) {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const res = await fetch(`${baseUrl}/api/card-news/generate-variants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ package_id: id, count: 5, async: true }),
          signal: AbortSignal.timeout(8000),  // 비동기 트리거만 — 결과 안 기다림
        });
        cardNewsInfo = { triggered: res.ok };
      } catch (e) {
        cardNewsInfo = { triggered: false, reason: e instanceof Error ? e.message : 'unknown' };
      }
    } else if (policy && !policy.auto_trigger_card_news) {
      cardNewsInfo = { triggered: false, reason: 'policy disabled — /admin/blog/policy에서 활성' };
    }

    // 3) 7플랫폼 orchestrator (정책 ON 시 + GOOGLE_AI_API_KEY 있을 때 — 건당 ~$0.02)
    if (policy?.auto_trigger_orchestrator && process.env.GOOGLE_AI_API_KEY) {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        // 비동기 트리거 — 응답 안 기다림 (orchestrator는 30~120s 소요)
        fetch(`${baseUrl}/api/orchestrator/auto-publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: id, dryRun: false, publishNow: false }),
        }).catch(() => { /* fire-and-forget */ });
        orchestratorInfo = { triggered: true };
      } catch (e) {
        orchestratorInfo = { triggered: false, reason: e instanceof Error ? e.message : 'unknown' };
      }
    } else if (policy && !policy.auto_trigger_orchestrator) {
      orchestratorInfo = { triggered: false, reason: 'policy disabled — /admin/blog/policy에서 활성' };
    }

    return NextResponse.json({
      ok: true,
      status: 'active',
      internal_code: pkg.internal_code,
      score: scoreInfo,
      rag: ragInfo,
      drip: dripInfo,
      card_news: cardNewsInfo,
      orchestrator: orchestratorInfo,
    });
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

  // ── reject: 점수 캐시에서 즉시 제거 (그룹 내 다른 상품들 다음 cron에서 자동 재계산) ──
  try {
    await supabaseAdmin.from('package_scores').delete().eq('package_id', id);
    revalidatePath('/packages');
  } catch (e) {
    console.warn('[Reject API] 점수 캐시 정리 실패 (비중단):', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ ok: true, status: 'draft' });
}
