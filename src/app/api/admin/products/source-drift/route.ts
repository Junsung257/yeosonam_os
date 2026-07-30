import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import {
  inspectOptionalTourSource,
  isPublicPackage,
  SOURCE_REGION_OPTIONS,
  type SourceDriftPackage,
} from '@/lib/product-source-drift';
import { sourceEvidenceAuditPayload } from '@/lib/product-registration/source-evidence-contract';

const PACKAGE_FIELDS = 'id,internal_code,title,destination,status,publication_state,raw_text,raw_text_hash,optional_tours,itinerary_data,audit_report';

async function fetchPackages() {
  const rows: SourceDriftPackage[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabaseAdmin
      .from('travel_packages')
      .select(PACKAGE_FIELDS)
      .not('optional_tours', 'is', null)
      .range(offset, offset + 499);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as SourceDriftPackage[]));
    if (data.length < 500) break;
  }
  return rows;
}

async function getHandler() {
  try {
    const packages = await fetchPackages();
    const items = packages.flatMap(inspectOptionalTourSource);
    const evidenceContracts = packages.map(sourceEvidenceAuditPayload);
    const publicItems = items.filter(item => isPublicPackage(item));
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      summary: {
        packages: new Set(items.map(item => item.package_id)).size,
        entries: items.length,
        source_context_candidates: items.filter(item => item.confidence === 'source_context').length,
        itinerary_candidates: items.filter(item => item.confidence === 'itinerary').length,
        needs_review: items.filter(item => item.confidence === 'needs_review').length,
        normalized_name_matches: items.filter(item => item.normalized_name_match).length,
        public_entries: publicItems.length,
        evidence_contract_blocked: evidenceContracts.filter(item => item.status === 'blocked').length,
        evidence_contract_review: evidenceContracts.filter(item => item.status === 'review').length,
        evidence_contract_pass: evidenceContracts.filter(item => item.status === 'pass').length,
      },
      region_options: SOURCE_REGION_OPTIONS,
      items,
    });
  } catch (error) {
    console.error('[admin/products/source-drift] GET failed', error);
    return NextResponse.json({ error: '원문 검수 큐를 불러오지 못했습니다.' }, { status: 503 });
  }
}

async function postHandler(req: NextRequest) {
  try {
    const body = await req.json() as {
      package_id?: string;
      tour_index?: number;
      decision?: 'approve' | 'defer';
      region?: string | null;
      reviewer_note?: string | null;
    };
    const packageId = body.package_id;
    const tourIndex = body.tour_index;
    const decision = body.decision;
    const reviewerNote = typeof body.reviewer_note === 'string' ? body.reviewer_note.trim() : '';
    if (!packageId || typeof tourIndex !== 'number' || !Number.isInteger(tourIndex) || tourIndex < 0 || !decision) {
      return NextResponse.json({ error: 'package_id, tour_index, decision이 필요합니다.' }, { status: 400 });
    }
    if (reviewerNote.length < 5) {
      return NextResponse.json({ error: '원문 검수 메모를 5자 이상 입력해 주세요.' }, { status: 400 });
    }
    if (decision === 'approve' && (!body.region || !SOURCE_REGION_OPTIONS.includes(body.region as typeof SOURCE_REGION_OPTIONS[number]))) {
      return NextResponse.json({ error: '승인할 지역을 선택해 주세요.' }, { status: 400 });
    }

    const { data: pkg, error: fetchError } = await supabaseAdmin
      .from('travel_packages')
      .select(`${PACKAGE_FIELDS}`)
      .eq('id', packageId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!pkg) return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
    if (isPublicPackage(pkg as SourceDriftPackage)) {
      return NextResponse.json({ error: '공개 상품은 이 큐에서 수정할 수 없습니다.' }, { status: 409 });
    }

    const tours = Array.isArray(pkg.optional_tours) ? [...pkg.optional_tours] : [];
    const tour = tours[tourIndex];
    if (!tour || typeof tour !== 'object') return NextResponse.json({ error: '선택관광 항목을 찾을 수 없습니다.' }, { status: 404 });
    const evidence = inspectOptionalTourSource(pkg as SourceDriftPackage).find(item => item.tour_index === tourIndex);
    if (!evidence) return NextResponse.json({ error: '현재 검수 대상이 아닌 항목입니다.' }, { status: 409 });

    const previousAudit = pkg.audit_report && typeof pkg.audit_report === 'object' && !Array.isArray(pkg.audit_report)
      ? pkg.audit_report as Record<string, unknown>
      : {};
    const previousReviews = Array.isArray(previousAudit.optional_tour_region_reviews)
      ? previousAudit.optional_tour_region_reviews
      : [];
    const review = {
      package_id: packageId,
      tour_index: tourIndex,
      name: evidence.name,
      decision,
      region: decision === 'approve' ? body.region : null,
      confidence: evidence.confidence,
      raw_text_hash: pkg.raw_text_hash ?? null,
      reviewer_note: reviewerNote,
      reviewed_at: new Date().toISOString(),
    };
    const nextReviews = [...previousReviews.filter((row) => {
      if (!row || typeof row !== 'object') return true;
      const candidate = row as { package_id?: string; tour_index?: number };
      return !(candidate.package_id === packageId && candidate.tour_index === tourIndex);
    }), review];
    const nextPackage = decision === 'approve'
      ? { ...(pkg as SourceDriftPackage), optional_tours: tours }
      : pkg as SourceDriftPackage;
    const auditReport = {
      ...previousAudit,
      optional_tour_region_reviews: nextReviews,
      optional_tour_source_evidence: sourceEvidenceAuditPayload(nextPackage),
    };

    const update: Record<string, unknown> = { audit_report: auditReport, updated_at: new Date().toISOString() };
    if (decision === 'approve') {
      tours[tourIndex] = { ...(tour as Record<string, unknown>), region: body.region };
      update.optional_tours = tours;
    }
    const { error: updateError } = await supabaseAdmin.from('travel_packages').update(update).eq('id', packageId);
    if (updateError) throw updateError;

    return NextResponse.json({ success: true, decision, package_id: packageId, tour_index: tourIndex });
  } catch (error) {
    console.error('[admin/products/source-drift] POST failed', error);
    return NextResponse.json({ error: '검수 결과를 저장하지 못했습니다.' }, { status: 503 });
  }
}

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
