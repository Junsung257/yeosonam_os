import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { buildStandardNoticeCustomerSavePayload, type StandardNoticeReviewSaveRow } from '@/lib/product-registration-v3/admin-review';
import { evaluateProductRegistrationV3Gate } from '@/lib/product-registration-v3/gate';
import type { LatestV3DraftForPackage } from '@/lib/product-registration-v3/customer-payload';
import { collectStructuredFactsFromLedger } from '@/lib/product-registration-v3/structured-facts';
import type { V3DraftLedger, V3GateResult } from '@/lib/product-registration-v3/types';

type RouteContext = { params?: Promise<{ id: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeRows(value: unknown): StandardNoticeReviewSaveRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is StandardNoticeReviewSaveRow => {
    if (!isRecord(row)) return false;
    return (
      typeof row.source_text === 'string' &&
      typeof row.category === 'string' &&
      typeof row.template_key === 'string' &&
      typeof row.standard_text === 'string' &&
      typeof row.visibility === 'string' &&
      typeof row.risk_level === 'string' &&
      typeof row.review_status === 'string' &&
      isRecord(row.values) &&
      Array.isArray(row.evidence)
    );
  });
}

function replaceLedgerStandardNotices(ledger: V3DraftLedger, rows: StandardNoticeReviewSaveRow[]): V3DraftLedger {
  const variants = Array.isArray(ledger.variants) ? ledger.variants : [];
  if (variants.length === 0) return ledger;
  const rowsByVariant = new Map<string, StandardNoticeReviewSaveRow[]>();
  const fallbackRows: StandardNoticeReviewSaveRow[] = [];

  for (const row of rows) {
    const variantKey = (row as StandardNoticeReviewSaveRow & { variant_key?: string }).variant_key;
    if (typeof variantKey === 'string' && variantKey) {
      rowsByVariant.set(variantKey, [...(rowsByVariant.get(variantKey) ?? []), row]);
    } else {
      fallbackRows.push(row);
    }
  }

  return {
    ...ledger,
    variants: variants.map((variant, index) => ({
      ...variant,
      standard_notices: rowsByVariant.get(variant.variant_key)
        ?? (index === 0 ? fallbackRows : variant.standard_notices),
    })),
  };
}

export const PATCH = withAdminGuard(async (req: NextRequest, ctx?: RouteContext) => {
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return NextResponse.json({ error: 'no_db' }, { status: 503 });
  }

  const params = await ctx?.params;
  const packageId = params?.id;
  if (!packageId) return NextResponse.json({ error: 'missing_id' }, { status: 400 });

  const body = await req.json().catch(() => null);
  const rows = normalizeRows((body as { rows?: unknown } | null)?.rows);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'standard_notice_rows_required' }, { status: 400 });
  }

  const built = buildStandardNoticeCustomerSavePayload(packageId, rows);
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });

  const { data: draftRow, error: draftErr } = await supabaseAdmin
    .from('product_registration_drafts')
    .select('id, package_id, ledger, gate_result, status, created_at, structure_plan, match_summary')
    .eq('package_id', packageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (draftErr) return NextResponse.json({ error: draftErr.message }, { status: 500 });
  if (!draftRow) return NextResponse.json({ error: 'v3_draft_not_found' }, { status: 404 });

  const draft = draftRow as LatestV3DraftForPackage & {
    structure_plan?: unknown;
    match_summary?: unknown;
  };
  const ledger = draft.ledger as V3DraftLedger | null;
  if (!ledger || !Array.isArray(ledger.variants)) {
    return NextResponse.json({ error: 'invalid_v3_ledger' }, { status: 400 });
  }

  const nextLedger = replaceLedgerStandardNotices(ledger, rows);
  let nextGateResult: V3GateResult | null = draft.gate_result;
  if (draft.structure_plan) {
    nextGateResult = evaluateProductRegistrationV3Gate(
      draft.structure_plan as Parameters<typeof evaluateProductRegistrationV3Gate>[0],
      nextLedger,
      draft.match_summary as Parameters<typeof evaluateProductRegistrationV3Gate>[2],
    );
  }
  const nextStatus = nextGateResult?.status ?? draft.status ?? 'needs_review';

  const { error: updateDraftErr } = await supabaseAdmin
    .from('product_registration_drafts')
    .update({
      ledger: nextLedger,
      gate_result: nextGateResult,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', draft.id);
  if (updateDraftErr) return NextResponse.json({ error: updateDraftErr.message }, { status: 500 });

  const { data: currentPackage } = await supabaseAdmin
    .from('travel_packages')
    .select('category_attrs')
    .eq('id', packageId)
    .maybeSingle();
  const currentCategoryAttrs = isRecord((currentPackage as { category_attrs?: unknown } | null)?.category_attrs)
    ? ((currentPackage as { category_attrs?: Record<string, unknown> }).category_attrs ?? {})
    : {};

  const { data: pkg, error: packageErr } = await supabaseAdmin
    .from('travel_packages')
    .update({
      notices_parsed: built.payload.notices_parsed,
      customer_notes: built.payload.customer_notes,
      category_attrs: {
        ...currentCategoryAttrs,
        structured_facts: Object.fromEntries(
          collectStructuredFactsFromLedger(nextLedger).map(fact => [fact.category, fact.values]),
        ),
      },
      status: nextStatus === 'ready_to_publish' ? 'pending' : 'pending_review',
      updated_at: new Date().toISOString(),
    })
    .eq('id', packageId)
    .select('id, short_code')
    .single();
  if (packageErr) return NextResponse.json({ error: packageErr.message }, { status: 500 });

  revalidatePath(`/packages/${packageId}`);
  revalidatePath('/packages');
  if ((pkg as { short_code?: string | null } | null)?.short_code) {
    revalidatePath(`/lp/${(pkg as { short_code?: string }).short_code}`);
  }

  return NextResponse.json({
    ok: true,
    payload: built.payload,
    draft: {
      id: draft.id,
      status: nextStatus,
      gate_result: nextGateResult,
    },
  });
});
