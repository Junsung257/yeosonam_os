import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { revalidateLandingPagesForPackage } from '@/lib/revalidate-lp-package';
import type { MarketingCopy } from '@/lib/ai';
import { recomputeGroupForPackage } from '@/lib/scoring/recommend';
import { indexPackage } from '@/lib/jarvis/rag/indexer';
import { sendVaContentPackage } from '@/lib/va-email';
import { getSecret } from '@/lib/secret-registry';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import type { SourceEvidenceMap } from '@/lib/source-evidence';
import { evaluateCustomerDeliveryReadiness } from '@/lib/customer-delivery-check';
import { evaluateVerifyChecks } from '@/lib/upload-verify';
import { buildSourceBackedPriceDateRepair } from '@/lib/source-price-date-repair';
import { withAdminGuard } from '@/lib/admin-guard';
import { evaluateCustomerMobileProof } from '@/lib/customer-mobile-proof';
import { buildSourceBackedFieldRepair } from '@/lib/source-package-field-repair';
import { buildSourceBackedTermsRepair } from '@/lib/source-terms-repair';
import {
  evaluateV3CustomerNoticeGate,
  hasSupplierRemarkRawLeakRisk,
  loadLatestV3DraftForPackage,
} from '@/lib/product-registration-v3/customer-payload';
import { calculateProductRegistrationTrustScore } from '@/lib/product-registration-trust-score';

interface ApproveBody {
  action: 'approve' | 'reject';
  title?: string;
  summary?: string;
  selectedCopyType?: string;
  /** Allows approval when the publish gate requires an explicit warning override. */
  force?: boolean;
}

async function patchHandler(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;

  if (!id) {
    return NextResponse.json({ error: 'Package id is required.' }, { status: 400 });
  }

  let body: ApproveBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body is not valid JSON.' }, { status: 400 });
  }

  const { action, title, summary, selectedCopyType } = body;

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve or reject.' }, { status: 400 });
  }

  // ?? ?꾩옱 ?⑦궎吏 議고쉶 (internal_code + marketing_copies ?꾩슂) ????????????????

  const { data: pkg, error: fetchError } = await supabaseAdmin
    .from('travel_packages')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !pkg) {
    return NextResponse.json(
      { error: fetchError?.message ?? 'Package was not found.' },
      { status: 404 },
    );
  }

  // ?? ?뱀씤 泥섎━ ?????????????????????????????????????????????????????????????

  if (action === 'approve') {
    const force = body.force === true;
    const sourcePriceDateRepair = buildSourceBackedPriceDateRepair(pkg as Parameters<typeof buildSourceBackedPriceDateRepair>[0]);
    const sourceTermsRepair = buildSourceBackedTermsRepair(pkg);
    const sourceFieldRepair = buildSourceBackedFieldRepair(pkg);
    const pkgForSourceVerify = {
      ...(pkg as Record<string, unknown>),
      ...(sourceFieldRepair.status === 'repaired' && sourceFieldRepair.airline ? { airline: sourceFieldRepair.airline } : {}),
      ...(sourcePriceDateRepair.status === 'repaired' ? { price_dates: sourcePriceDateRepair.priceDates } : {}),
      ...(sourceTermsRepair.status === 'repaired' && sourceTermsRepair.inclusions ? { inclusions: sourceTermsRepair.inclusions } : {}),
      ...(sourceTermsRepair.status === 'repaired' && sourceTermsRepair.excludes ? { excludes: sourceTermsRepair.excludes } : {}),
    };
    const sourceVerify = evaluateVerifyChecks({
      ...pkgForSourceVerify,
      status: 'active',
      audit_status: 'clean',
    } as Parameters<typeof evaluateVerifyChecks>[0]);
    const sourceAuditReport = {
      checks: sourceVerify.checks,
      fixable: sourceVerify.fixable,
      source: 'approve-source-verify',
      version: 3,
      source_price_date_repair: sourcePriceDateRepair,
      source_terms_repair: sourceTermsRepair,
      source_field_repair: sourceFieldRepair,
    };
    const sourceRepairUpdates: Record<string, unknown> = {};
    const sourceRepairActions: string[] = [];
    if (sourcePriceDateRepair.status === 'repaired') {
      sourceRepairUpdates.price_dates = sourcePriceDateRepair.priceDates;
      sourceRepairActions.push('price_dates');
    }
    if (sourceFieldRepair.status === 'repaired' && sourceFieldRepair.airline) {
      sourceRepairUpdates.airline = sourceFieldRepair.airline;
      sourceRepairActions.push('airline');
    }
    if (sourceTermsRepair.status === 'repaired' && sourceTermsRepair.inclusions) {
      sourceRepairUpdates.inclusions = sourceTermsRepair.inclusions;
      sourceRepairActions.push('inclusions');
    }
    if (sourceTermsRepair.status === 'repaired' && sourceTermsRepair.excludes) {
      sourceRepairUpdates.excludes = sourceTermsRepair.excludes;
      sourceRepairActions.push('excludes');
    }
    if (sourceRepairActions.length > 0) {
      await supabaseAdmin
        .from('travel_packages')
        .update({
          ...sourceRepairUpdates,
          audit_status: 'blocked',
          audit_report: {
            ...sourceAuditReport,
            mobile_browser_proof_required: {
              status: 'fail',
              reason: `source-backed approval repair changed customer-visible data (${sourceRepairActions.join(', ')}); rerun mobile/A4 proof before publication`,
              checked_at: new Date().toISOString(),
            },
          },
          audit_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      return NextResponse.json(
        {
          error: 'Source-backed repair was applied. Rerun mobile/A4 proof before customer publication.',
          code: 'SOURCE_REPAIR_REQUIRES_MOBILE_REPROOF',
          repaired_fields: sourceRepairActions,
          source_verify: sourceVerify,
          source_repairs: {
            price_dates: sourcePriceDateRepair,
            field: sourceFieldRepair,
            terms: sourceTermsRepair,
          },
        },
        { status: 409 },
      );
    }
    if (sourceVerify.status === 'blocked') {
      await supabaseAdmin
        .from('travel_packages')
        .update({
          audit_status: 'blocked',
          audit_report: sourceAuditReport,
          audit_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      return NextResponse.json(
        {
          error: 'Customer publishing is blocked. The latest source-vs-saved audit failed before approval.',
          source_verify: sourceVerify,
        },
        { status: 409 },
      );
    }
    if (sourceVerify.status === 'warnings' && !force) {
      await supabaseAdmin
        .from('travel_packages')
        .update({
          audit_status: 'warnings',
          audit_report: sourceAuditReport,
          audit_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      return NextResponse.json(
        {
          error: 'This package has source audit warnings. Review them and retry with force=true only if acceptable.',
          source_verify: sourceVerify,
        },
        { status: 409 },
      );
    }
    const verifiedPkgForDelivery = {
      ...pkgForSourceVerify,
      status: 'active',
      audit_status: sourceVerify.status === 'clean' ? 'clean' : sourceVerify.status,
      audit_report: sourceAuditReport,
    };

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
      pkg: verifiedPkgForDelivery as Parameters<typeof evaluateCustomerDeliveryReadiness>[0]['pkg'],
      failedChecks,
      sourceEvidence,
      requireCompletedAudit: true,
    });
    const latestV3Draft = await loadLatestV3DraftForPackage(supabaseAdmin, id);
    const v3NoticeGate = evaluateV3CustomerNoticeGate(id, latestV3Draft);
    const latestLedger = latestV3Draft?.ledger;
    const latestVariants = Array.isArray(latestLedger?.variants) ? latestLedger.variants : [];
    const countLatestV3Rows = (key: 'standard_notices' | 'structured_facts') =>
      latestVariants.reduce((sum, variant) => {
        const rows = (variant as unknown as Record<string, unknown>)[key];
        return sum + (Array.isArray(rows) ? rows.length : 0);
      }, 0);
    const approvalTrustScore = calculateProductRegistrationTrustScore({
      savedProductCount: 1,
      priceDatesCount: Array.isArray((pkg as { price_dates?: unknown }).price_dates) ? ((pkg as { price_dates: unknown[] }).price_dates).length : 0,
      priceRowsSaved: Array.isArray((pkg as { price_tiers?: unknown }).price_tiers) ? ((pkg as { price_tiers: unknown[] }).price_tiers).length : 0,
      itineraryDaysCount: Array.isArray((pkg as { itinerary_data?: { days?: unknown[] } }).itinerary_data?.days)
        ? (pkg as { itinerary_data: { days: unknown[] } }).itinerary_data.days.length
        : 0,
      standardNoticeCount: countLatestV3Rows('standard_notices'),
      structuredFactCount: countLatestV3Rows('structured_facts'),
      rawNoticeLeakRisk: hasSupplierRemarkRawLeakRisk(pkg),
      v3Status: v3NoticeGate.draftStatus ?? 'none',
      highRiskReviewNeededCount: v3NoticeGate.blockReasons.length,
      renderAuditStatus: delivery.publishGate.decision === 'block' ? 'fail' : delivery.publishGate.decision === 'force_required' ? 'warn' : 'pass',
    });
    if (v3NoticeGate.blocksApproval) {
      return NextResponse.json(
        {
          error: 'Product Registration V3 gate is not ready. Review the latest draft before approval.',
          trust_score: approvalTrustScore,
          v3_gate: {
            draft_id: latestV3Draft?.id ?? null,
            status: v3NoticeGate.draftStatus,
            reasons: v3NoticeGate.blockReasons,
          },
        },
        { status: 409 },
      );
    }
    if (v3NoticeGate.payloadError) {
      return NextResponse.json(
        {
          error: 'Product Registration V3 standard notice payload could not be built.',
          trust_score: approvalTrustScore,
          v3_gate: {
            draft_id: latestV3Draft?.id ?? null,
            status: v3NoticeGate.draftStatus,
            payload_error: v3NoticeGate.payloadError,
          },
        },
        { status: 409 },
      );
    }
    if (!latestV3Draft && hasSupplierRemarkRawLeakRisk(pkg)) {
      return NextResponse.json(
        {
          error: 'Supplier REMARK-like notice text is not allowed in customer-visible fields. Re-run Product Registration V3 or approve standard notices first.',
          trust_score: approvalTrustScore,
          v3_gate: {
            draft_id: null,
            status: 'missing',
            reasons: ['customer notice fields contain supplier REMARK-like text without V3 standard notice metadata'],
          },
        },
        { status: 409 },
      );
    }
    const publishGate = delivery.publishGate;
    const mobileProof = evaluateCustomerMobileProof({
      auditReport: (pkg as { audit_report?: unknown }).audit_report ?? sourceAuditReport,
      packageUpdatedAt: (pkg as { updated_at?: string | null }).updated_at ?? null,
    });
    if (!mobileProof.ok) {
      await supabaseAdmin
        .from('travel_packages')
        .update({
          audit_status: 'blocked',
          audit_report: {
            ...sourceAuditReport,
            mobile_browser_proof: mobileProof.proof,
            mobile_browser_proof_required: {
              status: 'fail',
              reason: mobileProof.reason,
              checked_at: new Date().toISOString(),
            },
          },
          audit_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      return NextResponse.json(
        {
          error: 'Customer publishing is blocked. Actual /packages mobile browser proof is required before approval.',
          trust_score: approvalTrustScore,
          mobile_browser_proof: mobileProof,
          source_verify: sourceVerify,
        },
        { status: 409 },
      );
    }
    if (publishGate.decision === 'block') {
      return NextResponse.json(
        {
          error: 'Customer publishing is blocked. Fix the source/mobile/A4 audit failures before approval.',
          trust_score: approvalTrustScore,
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
          error: 'This package has warnings. Review the audit report and retry with force=true only if the warnings are acceptable.',
          trust_score: approvalTrustScore,
          publish_gate: publishGate,
          audit_status: (pkg as { audit_status?: string | null }).audit_status ?? null,
          audit_report: publishGate.auditReport ?? null,
        },
        { status: 409 },
      );
    }
    // Update the selected flag on marketing copy variants.
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
        ...(v3NoticeGate.payload ? {
          notices_parsed: v3NoticeGate.payload.notices_parsed,
          customer_notes: v3NoticeGate.payload.customer_notes,
        } : {}),
        marketing_copies: updatedCopies,
        ...(sourceFieldRepair.status === 'repaired' && sourceFieldRepair.airline ? { airline: sourceFieldRepair.airline } : {}),
        ...(sourcePriceDateRepair.status === 'repaired' ? { price_dates: sourcePriceDateRepair.priceDates } : {}),
        ...(sourceTermsRepair.status === 'repaired' && sourceTermsRepair.inclusions ? { inclusions: sourceTermsRepair.inclusions } : {}),
        ...(sourceTermsRepair.status === 'repaired' && sourceTermsRepair.excludes ? { excludes: sourceTermsRepair.excludes } : {}),
        audit_status: sourceVerify.status === 'clean' ? 'clean' : sourceVerify.status,
        audit_report: {
          ...sourceAuditReport,
          mobile_browser_proof: mobileProof.proof,
          approved_from_mobile_browser_proof_at: mobileProof.proof?.checked_at ?? null,
        },
        audit_checked_at: new Date().toISOString(),
        updated_at:       new Date().toISOString(),
      })
      .eq('id', id);

    if (pkgError) {
      return NextResponse.json(
        { error: `travel_packages ?낅뜲?댄듃 ?ㅽ뙣: ${pkgError.message}` },
        { status: 500 },
      );
    }

    // products ?뚯씠釉붾룄 active濡??숆린??(FK ?곌껐??寃쎌슦)
    if (pkg.internal_code) {
      const { error: productError } = await supabaseAdmin
        .from('products')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('internal_code', pkg.internal_code);

      if (productError) {
        // products ?낅뜲?댄듃 ?ㅽ뙣??寃쎄퀬留???travel_packages 諛고룷???좎?
        console.warn('[Approve API] products ?곹깭 ?낅뜲?댄듃 ?ㅽ뙣 (鍮꾩쨷??:', productError.message);
      }
    }

    // 2026-05-18 諛뺤젣 (ERR-approve-silent-fail): post-approve fail-soft ?④퀎瑜?admin_alerts 濡?媛?쒗솕.
    //   PR #119 媛 upload backfill 留?諛뺤븯怨?approve ?꾩냽 泥섎━(MRT/?먯닔/RAG) ??silent ???
    //   ?ъ옣?섏씠 "?뱀씤 OK ??以??뚯븯?붾뜲 RAG 0嫄? 媛숈? 嫄곗쭞 ?좏샇 諛쏅뜕 ?ш퀬 ?곴뎄 李⑤떒.
    const postApproveWarnings: Array<{ phase: string; message: string }> = [];
    async function alertWarn(phase: string, e: unknown): Promise<void> {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[Approve API] ${phase} ?ㅽ뙣 (鍮꾩쨷??:`, msg);
      postApproveWarnings.push({ phase, message: msg.slice(0, 500) });
      if (!isSupabaseConfigured) return;
      await supabaseAdmin.from('admin_alerts').insert({
        category: 'approve-post-processing',
        severity: 'warning',
        title: `${phase} ?ㅽ뙣: ${id.slice(0, 8)}`,
        message: msg.slice(0, 500),
        ref_type: 'travel_package',
        ref_id: id,
        meta: { phase, error: msg.slice(0, 500) },
      }).then(() => {}, () => {});
    }

    // ?? MRT ?명뀛 ?명뀛 ?숆린??(?쇱젙 ?명뀛留????먯닔쨌?먮퉬??FAQ??DB 罹먯떆) ??
    //   2026-05-18 諛뺤젣: 以묐났 ?몄텧(2?? ?쒓굅.
    try {
      const { syncPackageHotelIntelByPackageId } = await import('@/lib/mrt-hotel-intel');
      await syncPackageHotelIntelByPackageId(id);
    } catch (e) {
      await alertWarn('mrt-hotel-sync', e);
    }

    // ?? ?먯닔 洹몃９ ?먮룞 ?ш퀎??(?좎긽???깅줉 ??湲곗〈 ?곹뭹 ?먯닔 ?먮룞 ?섎씫 蹂댁옣) ??
    let scoreInfo: { group_size: number; group_key: string } | null = null;
    try {
      const result = await recomputeGroupForPackage(id);
      scoreInfo = { group_size: result.group_size, group_key: result.group_key };
    } catch (e) {
      // ?먯닔 ?곗텧 ?ㅽ뙣?대룄 approve ?먯껜???깃났 (?덉쟾留? ?덈꼍 cron ??泥섎━)
      await alertWarn('score-recompute', e);
    }

    // ?? ?넅 ?먮퉬??RAG ?먮룞 ?몃뜳??(v5, 2026-04-30) ??
    // ?곹뭹 ?뱀씤 利됱떆 ?먮퉬?ㅺ? ?숈뒿. ?ㅽ뙣?대룄 approve ?먯껜 ?먮쫫 留됱? ?딆쓬 (cron 蹂댄샇)
    let ragInfo: { inserted: number; skipped: number; failed: number } | null = null;
    try {
      ragInfo = await indexPackage(id);
    } catch (e) {
      await alertWarn('rag-index', e);
    }

    // ISR 罹먯떆 利됱떆 臾댄슚????紐⑤컮??/packages 利됱떆 諛섏쁺
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

    // ?? ?넅 ?뺤콉 湲곕컲 ?먮룞 ?몃━嫄???
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

    // ?뺤콉 議고쉶
    const { getBlogPublishingPolicy } = await import('@/lib/blog-scheduler');
    const policy = await getBlogPublishingPolicy('global').catch(() => null);

    // 1) Multi-angle drip (?뺤콉怨?臾닿? ????긽 ON, 媛?깅퉬 醫뗭쓬)
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

    // 2) 移대뱶?댁뒪 ?먮룞 蹂??(?뺤콉 ON ??+ DEEPSEEK_API_KEY ?덉쓣 ??
    // HTTP濡?/api/card-news/generate-variants 瑜?移섎㈃ rawText ?꾩닔 + ?대뱶誘??몄쬆???꾩슂????긽 ?ㅽ뙣??
    // ?ㅼ??ㅽ듃?덉씠?곗? ?숈씪: agent_actions ???곸옱 ??/api/cron/agent-executor 媛 executeGenerateVariantsJob ?ㅽ뻾.
    if (policy?.auto_trigger_card_news && getSecret('DEEPSEEK_API_KEY')) {
      try {
        const { data: pkgRow, error: pkgRowErr } = await supabaseAdmin
          .from('travel_packages')
          .select('title, destination, product_summary, product_highlights')
          .eq('id', id)
          .single();

        if (pkgRowErr || !pkgRow) {
          cardNewsInfo = { triggered: false, reason: pkgRowErr?.message ?? '?곹뭹 ?ъ“???ㅽ뙣' };
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
            cardNewsInfo = { triggered: false, reason: '移대뱶?댁뒪???먮Ц??鍮꾩뼱 ?덉쓬(?쒕ぉ쨌?붿빟쨌?섏씠?쇱씠??' };
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
      cardNewsInfo = { triggered: false, reason: 'policy disabled ??/admin/blog/policy?먯꽌 ?쒖꽦' };
    }

    // 3) 7?뚮옯??orchestrator (?뺤콉 ON ??+ GOOGLE_AI_API_KEY ?덉쓣 ????嫄대떦 ~$0.02)
    if (policy?.auto_trigger_orchestrator && getSecret('GOOGLE_AI_API_KEY')) {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        // 鍮꾨룞湲??몃━嫄????묐떟 ??湲곕떎由?(orchestrator??30~120s ?뚯슂)
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
      orchestratorInfo = { triggered: false, reason: 'policy disabled ??/admin/blog/policy?먯꽌 ?쒖꽦' };
    }

    // 4) Ad OS product autopilot: ?쒕굹由ъ삤, 釉붾줈洹?吏꾪솕 ?? 寃?됯킅怨??ㅼ썙???뚮옖 ?먮룞 ?앹꽦.
    //    guarded+apply???대? DB ?꾨낫留?留뚮뱾怨??몃? 愿묎퀬鍮꾨? ?곗? ?딅뒗??
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

    // VA ?대찓???뚮┝ ??fire-and-forget (鍮꾩쨷??
    const vaNotification = await sendVaContentPackage(id).catch(e => {
      console.warn('[Approve] VA email failed (non-blocking):', sanitizeDbError(e));
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
      // 2026-05-18 諛뺤젣: post-approve fail-soft ?④퀎 ?ㅽ뙣 媛?쒗솕 (admin_alerts ? ?쇱튂)
      warnings: postApproveWarnings.length > 0 ? postApproveWarnings : undefined,
    });
  }

  // ?? 諛섎젮 泥섎━ ?????????????????????????????????????????????????????????????

  const { error: rejectError } = await supabaseAdmin
    .from('travel_packages')
    .update({
      status:     'draft',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (rejectError) {
    return NextResponse.json(
      { error: `Reject failed: ${rejectError.message}` },
      { status: 500 },
    );
  }

  if (pkg.internal_code) {
    await supabaseAdmin
      .from('products')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('internal_code', pkg.internal_code);
  }

  // ?? reject: ?먯닔 罹먯떆?먯꽌 利됱떆 ?쒓굅 (洹몃９ ???ㅻⅨ ?곹뭹???ㅼ쓬 cron?먯꽌 ?먮룞 ?ш퀎?? ??
  try {
    await supabaseAdmin.from('package_scores').delete().eq('package_id', id);
    revalidatePath('/packages');
    revalidateLandingPagesForPackage(
      id,
      (pkg as { short_code?: string | null }).short_code ?? null,
    );
  } catch (e) {
    console.warn('[Reject API] ?먯닔 罹먯떆 ?뺣━ ?ㅽ뙣 (鍮꾩쨷??:', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ ok: true, status: 'draft' });
}

export const PATCH = withAdminGuard(patchHandler);
