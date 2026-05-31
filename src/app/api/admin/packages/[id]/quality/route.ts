import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  type SourceEvidenceMap,
} from '@/lib/source-evidence';
import { type PublishGateFailedCheck } from '@/lib/product-publish-gate';
import { evaluateCustomerDeliveryReadiness } from '@/lib/customer-delivery-check';

type RouteContext = { params?: Promise<{ id: string }> };

function getSourceEvidence(ir: unknown): SourceEvidenceMap | null {
  if (!ir || typeof ir !== 'object') return null;
  const evidence = (ir as { sourceEvidence?: unknown }).sourceEvidence;
  if (!evidence || typeof evidence !== 'object') return null;
  return evidence as SourceEvidenceMap;
}

export const GET = withAdminGuard(async (_req: NextRequest, ctx?: RouteContext) => {
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({ error: 'no_db' }, { status: 503 });
  }

  const params = await ctx?.params;
  const id = params?.id;
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });

  const { data: pkg, error: pkgErr } = await supabaseAdmin
    .from('travel_packages')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (pkgErr || !pkg) {
    return NextResponse.json({ error: pkgErr?.message ?? 'package_not_found' }, { status: 404 });
  }

  const [{ data: qualityLog }, { data: intake }] = await Promise.all([
    supabaseAdmin
      .from('ai_quality_log')
      .select('confidence, failed_checks, cove_warnings, attraction_matched_count, attraction_unmatched_count, created_at')
      .eq('package_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('normalized_intakes')
      .select('ir, created_at')
      .eq('package_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const sourceEvidence = getSourceEvidence((intake as { ir?: unknown } | null)?.ir);
  const failedChecks: PublishGateFailedCheck[] = Array.isArray((qualityLog as { failed_checks?: unknown } | null)?.failed_checks)
    ? ((qualityLog as { failed_checks?: PublishGateFailedCheck[] }).failed_checks ?? [])
    : [];
  const delivery = evaluateCustomerDeliveryReadiness({
    pkg: pkg as Parameters<typeof evaluateCustomerDeliveryReadiness>[0]['pkg'],
    failedChecks,
    sourceEvidence,
    requireCompletedAudit: true,
  });

  return NextResponse.json({
    ok: true,
    quality: {
      audit_status: (pkg as { audit_status?: string | null }).audit_status ?? null,
      quality_log_created_at: (qualityLog as { created_at?: string | null } | null)?.created_at ?? null,
      confidence: (qualityLog as { confidence?: number | null } | null)?.confidence ?? null,
      failed_checks: failedChecks,
      cove_warnings: (qualityLog as { cove_warnings?: unknown } | null)?.cove_warnings ?? [],
      attraction_matched_count: (qualityLog as { attraction_matched_count?: number | null } | null)?.attraction_matched_count ?? null,
      attraction_unmatched_count: (qualityLog as { attraction_unmatched_count?: number | null } | null)?.attraction_unmatched_count ?? null,
      source_evidence_created_at: (intake as { created_at?: string | null } | null)?.created_at ?? null,
      source_evidence_origin: delivery.sourceEvidenceOrigin,
      customer_deliverable: delivery.customerDeliverable,
      source_evidence_coverage: delivery.sourceEvidenceCoverage,
      render_claim_coverage: delivery.renderClaimCoverage
        ? {
            total: delivery.renderClaimCoverage.total,
            supported: delivery.renderClaimCoverage.supported,
            ratio: delivery.renderClaimCoverage.ratio,
            unsupported: delivery.renderClaimCoverage.unsupported,
          }
        : null,
      publish_gate: delivery.publishGate,
    },
  });
});
