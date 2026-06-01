import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { revalidateLandingPagesForPackage } from '@/lib/revalidate-lp-package';
import type { MarketingCopy } from '@/lib/ai';
import { recomputeGroupForPackage } from '@/lib/scoring/recommend';
import { indexPackage } from '@/lib/jarvis/rag/indexer';
import { sendVaContentPackage } from '@/lib/va-email';
import { getSecret } from '@/lib/secret-registry';
import type { SourceEvidenceMap } from '@/lib/source-evidence';
import { evaluateCustomerDeliveryReadiness } from '@/lib/customer-delivery-check';

interface ApproveBody {
  action: 'approve' | 'reject';
  title?: string;
  summary?: string;
  selectedCopyType?: string;
  /** audit_status === 'warnings' 상품을 강제 승인할 때 true */
  force?: boolean;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
    .select('*')
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
    const force = body.force === true;

    const { data: latestQualityLog } = await supabaseAdmin
      .from('ai_quality_log')
      .select('failed_checks')
      .eq('package_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const failedChecks = Array.isArray((latestQualityLog as { failed_checks?: unknown[] } | null)?.failed_checks)
      ? ((latestQualityLog as { failed_checks: Array<{ id?: string; severity?: string; message?: string; passed?: boolean }> }).failed_checks)
      : [];

    const { data: latestIntake } = await supabaseAdmin
      .from('normalized_intakes')
      .select('ir')
      .eq('package_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const sourceEvidence = ((latestIntake as { ir?: { sourceEvidence?: unknown } } | null)?.ir?.sourceEvidence ?? null) as SourceEvidenceMap | null;
    const delivery = evaluateCustomerDeliveryReadiness({
      pkg: pkg as Parameters<typeof evaluateCustomerDeliveryReadiness>[0]['pkg'],
      failedChecks,
      sourceEvidence,
      requireCompletedAudit: true,
    });
    const publishGate = delivery.publishGate;
    /*
    if (!sourceEvidence || Object.keys(sourceEvidence).length === 0) {
      const fallback = pkgToIntake(pkg as Parameters<typeof pkgToIntake>[0], {
        landOperatorName: (pkg as { land_operator?: string | null }).land_operator ?? undefined,
      });
      sourceEvidence = fallback.ir.sourceEvidence;
    }
    const renderCoverage = evaluateRenderClaimCoverage(pkg as Parameters<typeof evaluateRenderClaimCoverage>[0], sourceEvidence);
    const finalRenderFailedChecks = renderCoverage.unsupported.map((claim) => ({
      id: `final_render_unsupported:${claim.id}`,
      severity: 'critical',
      passed: false,
      message: `고객 노출 문구 원문 근거 없음: ${claim.value}`,
    }));

    const publishGate = evaluateProductPublishGate({
      auditStatus: (pkg as { audit_status?: string | null }).audit_status ?? null,
      auditReport: (pkg as { audit_report?: unknown }).audit_report ?? null,
      failedChecks: [...failedChecks, ...finalRenderFailedChecks],
      sourceEvidence,
      requiredEvidenceFields: [...REQUIRED_PACKAGE_EVIDENCE_FIELDS],
      minEvidenceCoverage: MIN_PACKAGE_EVIDENCE_COVERAGE,
      requireCompletedAudit: true,
    });

    */
    if (publishGate.decision === 'block') {
      return NextResponse.json(
        {
          error: '출판 게이트 차단 상태입니다. 원문/품질 검증 실패를 수정한 뒤 재검증해야 승인할 수 있습니다.',
          publish_gate: publishGate,
          render_claim_coverage: {
            total: delivery.renderClaimCoverage.total,
            supported: delivery.renderClaimCoverage.supported,
            ratio: delivery.renderClaimCoverage.ratio,
            unsupported: delivery.renderClaimCoverage.unsupported.slice(0, 20),
          },
          source_evidence_origin: delivery.sourceEvidenceOrigin,
          customer_deliverable: delivery.customerDeliverable,
          audit_status: (pkg as { audit_status?: string | null }).audit_status ?? null,
          audit_report: publishGate.auditReport ?? null,
        },
        { status: 409 },
      );
    }

    if (publishGate.decision === 'force_required' && !force) {
      return NextResponse.json(
        {
          error: '경고가 있는 상품입니다. 감사/품질 리포트를 확인한 뒤 force=true 로 재호출하세요.',
          publish_gate: publishGate,
          audit_status: (pkg as { audit_status?: string | null }).audit_status ?? null,
          audit_report: publishGate.auditReport ?? null,
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

    // 2026-05-18 박제 (ERR-approve-silent-fail): post-approve fail-soft 단계를 admin_alerts 로 가시화.
    //   PR #119 가 upload backfill 만 박았고 approve 후속 처리(MRT/점수/RAG) 는 silent 였음.
    //   사장님이 "승인 OK 인 줄 알았는데 RAG 0건" 같은 거짓 신호 받던 사고 영구 차단.
    const postApproveWarnings: Array<{ phase: string; message: string }> = [];
    async function alertWarn(phase: string, e: unknown): Promise<void> {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[Approve API] ${phase} 실패 (비중단):`, msg);
      postApproveWarnings.push({ phase, message: msg.slice(0, 500) });
      if (!isSupabaseConfigured) return;
      await supabaseAdmin.from('admin_alerts').insert({
        category: 'approve-post-processing',
        severity: 'warning',
        title: `${phase} 실패: ${id.slice(0, 8)}`,
        message: msg.slice(0, 500),
        ref_type: 'travel_package',
        ref_id: id,
        meta: { phase, error: msg.slice(0, 500) },
      }).then(() => {}, () => {});
    }

    // ── MRT 호텔 인텔 동기화 (일정 호텔만 — 점수·자비스 FAQ용 DB 캐시) ──
    //   2026-05-18 박제: 중복 호출(2회) 제거.
    try {
      const { syncPackageHotelIntelByPackageId } = await import('@/lib/mrt-hotel-intel');
      await syncPackageHotelIntelByPackageId(id);
    } catch (e) {
      await alertWarn('mrt-hotel-sync', e);
    }

    // ── 점수 그룹 자동 재계산 (신상품 등록 시 기존 상품 점수 자동 하락 보장) ──
    let scoreInfo: { group_size: number; group_key: string } | null = null;
    try {
      const result = await recomputeGroupForPackage(id);
      scoreInfo = { group_size: result.group_size, group_key: result.group_key };
    } catch (e) {
      // 점수 산출 실패해도 approve 자체는 성공 (안전망: 새벽 cron 이 처리)
      await alertWarn('score-recompute', e);
    }

    // ── 🆕 자비스 RAG 자동 인덱싱 (v5, 2026-04-30) ──
    // 상품 승인 즉시 자비스가 학습. 실패해도 approve 자체 흐름 막지 않음 (cron 보호)
    let ragInfo: { inserted: number; skipped: number; failed: number } | null = null;
    try {
      ragInfo = await indexPackage(id);
    } catch (e) {
      await alertWarn('rag-index', e);
    }

    // ISR 캐시 즉시 무효화 — 모바일 /packages 즉시 반영
    try {
      revalidatePath('/packages');
      revalidatePath(`/packages/${id}`);
      revalidateLandingPagesForPackage(
        id,
        (pkg as { short_code?: string | null }).short_code ?? null,
      );
    } catch (e) {
      await alertWarn('revalidate-path', e);
    }

    // ── 🆕 정책 기반 자동 트리거 ──
    let dripInfo: { queued: number; angles: string[] } | null = null;
    let cardNewsInfo: { triggered: boolean; reason?: string } | null = null;
    let orchestratorInfo: { triggered: boolean; reason?: string } | null = null;
    let searchAdsInfo: {
      triggered: boolean;
      saved?: number;
      keywords?: number;
      scenarios?: number;
      blog_actions?: number;
      reason?: string;
    } | null = null;

    // 정책 조회
    const { getBlogPublishingPolicy } = await import('@/lib/blog-scheduler');
    const policy = await getBlogPublishingPolicy('global').catch(() => null);

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
      await alertWarn('multi-angle-drip', e);
    }

    // 2) 카드뉴스 자동 변형 (정책 ON 시 + DEEPSEEK_API_KEY 있을 때)
    // HTTP로 /api/card-news/generate-variants 를 치면 rawText 필수 + 어드민 인증이 필요해 항상 실패함.
    // 오케스트레이터와 동일: agent_actions 에 적재 → /api/cron/agent-executor 가 executeGenerateVariantsJob 실행.
    if (policy?.auto_trigger_card_news && getSecret('DEEPSEEK_API_KEY')) {
      try {
        const { data: pkgRow, error: pkgRowErr } = await supabaseAdmin
          .from('travel_packages')
          .select('title, destination, product_summary, product_highlights')
          .eq('id', id)
          .single();

        if (pkgRowErr || !pkgRow) {
          cardNewsInfo = { triggered: false, reason: pkgRowErr?.message ?? '상품 재조회 실패' };
        } else {
          const rawText = [
            pkgRow.title,
            pkgRow.product_summary ?? '',
            ...((pkgRow.product_highlights as string[]) ?? []),
          ]
            .map(s => (typeof s === 'string' ? s.trim() : ''))
            .filter(Boolean)
            .join('\n\n');

          if (!rawText.trim()) {
            cardNewsInfo = { triggered: false, reason: '카드뉴스용 원문이 비어 있음(제목·요약·하이라이트)' };
          } else {
            const { error: actionErr } = await supabaseAdmin.from('agent_actions').insert({
              agent_type: 'package_approval',
              action_type: 'generate_card_news_variants',
              payload: {
                rawText,
                productMeta: { title: pkgRow.title, destination: pkgRow.destination ?? undefined },
                package_id: id,
                count: 5,
                skipCritic: false,
              },
              status: 'approved',
            });
            cardNewsInfo = actionErr
              ? { triggered: false, reason: actionErr.message }
              : { triggered: true };
          }
        }
      } catch (e) {
        cardNewsInfo = { triggered: false, reason: e instanceof Error ? e.message : 'unknown' };
      }
    } else if (policy && !policy.auto_trigger_card_news) {
      cardNewsInfo = { triggered: false, reason: 'policy disabled — /admin/blog/policy에서 활성' };
    }

    // 3) 7플랫폼 orchestrator (정책 ON 시 + GOOGLE_AI_API_KEY 있을 때 — 건당 ~$0.02)
    if (policy?.auto_trigger_orchestrator && getSecret('GOOGLE_AI_API_KEY')) {
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

    // 4) Ad OS product autopilot: 시나리오, 블로그 진화 큐, 검색광고 키워드 플랜 자동 생성.
    //    guarded+apply는 내부 DB 후보만 만들고 외부 광고비를 쓰지 않는다.
    try {
      const { runAdOsProductAutopilot } = await import('@/lib/ad-os-product-autopilot');
      const plan = await runAdOsProductAutopilot({
        packageId: id,
        mode: 'guarded',
        apply: true,
        source: 'package_approve_detail',
      });
      searchAdsInfo = {
        triggered: true,
        saved: plan.search_ads.saved,
        keywords: plan.search_ads.keywords,
        scenarios: plan.scenarios.saved,
        blog_actions: plan.scenarios.queued_blog_actions,
      };
    } catch (e) {
      searchAdsInfo = { triggered: false, reason: e instanceof Error ? e.message : 'unknown' };
      await alertWarn('ad-os-product-autopilot', e);
    }

    // VA 이메일 알림 — fire-and-forget (비중단)
    const vaNotification = await sendVaContentPackage(id).catch(e => {
      console.warn('[Approve] VA email failed (non-blocking):', e instanceof Error ? e.message : e);
      return { sent: false, reason: 'error' };
    });

    return NextResponse.json({
      ok: true,
      status: 'active',
      internal_code: pkg.internal_code,
      score: scoreInfo,
      rag: ragInfo,
      drip: dripInfo,
      card_news: cardNewsInfo,
      orchestrator: orchestratorInfo,
      search_ads: searchAdsInfo,
      va_notification: vaNotification,
      // 2026-05-18 박제: post-approve fail-soft 단계 실패 가시화 (admin_alerts 와 일치)
      warnings: postApproveWarnings.length > 0 ? postApproveWarnings : undefined,
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
    revalidateLandingPagesForPackage(
      id,
      (pkg as { short_code?: string | null }).short_code ?? null,
    );
  } catch (e) {
    console.warn('[Reject API] 점수 캐시 정리 실패 (비중단):', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ ok: true, status: 'draft' });
}
