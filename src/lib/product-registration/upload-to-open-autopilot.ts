import type { SupabaseClient } from '@supabase/supabase-js';

import type { AttractionData } from '@/lib/attraction-matcher';
import { runAutoMobileQA } from '@/lib/auto-mobile-qa';
import { evaluateCustomerDeliveryReadiness } from '@/lib/customer-delivery-check';
import { evaluateCustomerMobileProof } from '@/lib/customer-mobile-proof';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import type { PriceDate } from '@/lib/price-dates';
import {
  evaluateV3CustomerNoticeGate,
  getV3DraftGateStatus,
  hasSupplierRemarkRawLeakRisk,
  type LatestV3DraftForPackage,
  loadLatestV3DraftForPackage,
} from '@/lib/product-registration-v3/customer-payload';
import {
  applyProductRegistrationV3Matching,
  evaluateProductRegistrationV3Gate,
  persistProductRegistrationDraftV3,
  runProductRegistrationV3,
} from '@/lib/product-registration-v3';
import type { V3PipelineResult } from '@/lib/product-registration-v3';
import { buildSourceBackedFieldRepair } from '@/lib/source-package-field-repair';
import { buildSourceBackedPriceDateRepair, hasTransportPriceVariantCue } from '@/lib/source-price-date-repair';
import { buildSourceBackedTermsRepair } from '@/lib/source-terms-repair';
import { runUploadVerify, evaluateVerifyChecks } from '@/lib/upload-verify';
import type { ProductPriceRowInput } from '@/lib/upload-validator';
import { buildCustomerSourceRawText } from './source-evidence-raw-text';
import { replaceProductPricesForProduct } from './product-price-replacement';

export type UploadToOpenAutopilotPackage = {
  id: string;
  title: string | null;
  internal_code: string | null;
  status: string | null;
  audit_status: string | null;
  audit_report: unknown;
  updated_at: string | null;
  raw_text: string | null;
  airline: string | null;
  duration: number | null;
  nights: number | null;
  price: number | null;
  display_title: string | null;
  hero_tagline: string | null;
  trip_style: string | null;
  itinerary_data: unknown;
  accommodations: string[] | null;
  inclusions: string[] | null;
  excludes: string[] | null;
  optional_tours: unknown[] | null;
  price_tiers?: unknown[] | null;
  price_dates: Array<{
    date?: string | null;
    price?: number | null;
    adult_price?: number | null;
    adult_selling_price?: number | null;
    selling_price?: number | null;
    child_price?: number | null;
    currency?: string | null;
    confirmed?: boolean | null;
  }> | null;
  price_list: unknown;
  departure_days: unknown;
  surcharges: unknown;
  notices_parsed?: unknown;
  customer_notes?: unknown;
};

export type UploadToOpenAutopilotOptions = {
  packageIds?: string[];
  catalogGroupId?: string | null;
  status?: string[];
  limit?: number;
  attempts?: number;
  autoOpen?: boolean;
  baseUrl?: string;
};

export type UploadToOpenPackageResult = {
  id: string;
  title: string | null;
  code: string | null;
  status: 'opened' | 'ready_not_opened' | 'blocked' | 'error';
  stage: string;
  reasons: string[];
  repairs: string[];
};

type QualityLogRow = {
  failed_checks?: Array<{ id?: string; severity?: string; message?: string; passed?: boolean }>;
};

type IntakeRow = {
  ir?: { sourceEvidence?: unknown } | null;
};

type ProductSourceRow = {
  raw_extracted_text?: string | null;
};

type RestorableV3DraftRow = LatestV3DraftForPackage & {
  raw_text?: string | null;
  raw_text_hash?: string | null;
  source_type?: string | null;
  supplier_hint?: string | null;
  document_type?: string | null;
  structure_plan?: unknown;
  evidence_index?: unknown;
  match_summary?: unknown;
};

async function loadActiveAttractionsForV3(supabase: SupabaseClient): Promise<AttractionData[]> {
  const rows: AttractionData[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 20_000; offset += pageSize) {
    const { data, error } = await supabase
      .from('attractions')
      .select('id,name,short_desc,long_desc,badge_type,emoji,country,region,category,aliases,photos,mrt_gid')
      .eq('is_active', true)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSize - 1);
    if (error) return rows;
    if (!data?.length) break;
    rows.push(...data as AttractionData[]);
    if (data.length < pageSize) break;
  }
  return rows;
}

function collapseV3ToCurrentPackageVariant(
  v3: V3PipelineResult,
  attractions: AttractionData[],
): V3PipelineResult {
  if (v3.ledger.variants.length <= 1) return v3;
  const ledger = {
    ...v3.ledger,
    document: {
      ...v3.ledger.document,
      expected_products: 1,
    },
    variants: [v3.ledger.variants[0]],
  };
  const structurePlan = {
    ...v3.structure_plan,
    expected_products: 1,
    product_boundaries: v3.structure_plan.product_boundaries.slice(0, 1),
  };
  const matched = applyProductRegistrationV3Matching(ledger, attractions, undefined);
  const gateResult = evaluateProductRegistrationV3Gate(structurePlan, matched.ledger, matched.matchSummary);
  return {
    ...v3,
    structure_plan: structurePlan,
    ledger: matched.ledger,
    match_summary: matched.matchSummary,
    gate_result: gateResult,
    render_contract_preview: v3.render_contract_preview.slice(0, 1),
  };
}

const DEFAULT_STATUSES = ['pending_review', 'approved'];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function uniqueIds(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(value => value.trim()).filter(Boolean))];
}

function nowIso(): string {
  return new Date().toISOString();
}

function validPriceDates(priceDates: PriceDate[]): PriceDate[] {
  return priceDates
    .filter(row =>
      typeof row.date === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
      && typeof row.price === 'number'
      && Number.isFinite(row.price)
      && row.price > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

function minimumPrice(priceDates: PriceDate[]): number | null {
  const prices = validPriceDates(priceDates).map(row => row.price);
  return prices.length > 0 ? Math.min(...prices) : null;
}

function productPriceRowsFromPriceDates(priceDates: PriceDate[]): ProductPriceRowInput[] {
  return validPriceDates(priceDates).map(row => ({
    target_date: row.date,
    day_of_week: null,
    net_price: row.price,
    adult_selling_price: row.price,
    child_price: typeof row.child_price === 'number' && row.child_price > 0 ? row.child_price : null,
    note: 'source-backed autopilot price repair',
  }));
}

function priceTiersFromPriceDates(priceDates: PriceDate[]): Array<Record<string, unknown>> {
  const groupedByPrice = new Map<number, PriceDate[]>();
  for (const row of validPriceDates(priceDates)) {
    groupedByPrice.set(row.price, [...(groupedByPrice.get(row.price) ?? []), row]);
  }
  return [...groupedByPrice.entries()]
    .sort((a, b) => Math.min(...a[1].map(row => Date.parse(row.date))) - Math.min(...b[1].map(row => Date.parse(row.date))))
    .map(([price, rows]) => ({
      period_label: 'source-backed departure dates',
      departure_dates: rows.map(row => row.date),
      adult_price: price,
      ...(rows.some(row => typeof row.child_price === 'number' && row.child_price > 0)
        ? { child_price: Math.min(...rows.map(row => row.child_price).filter((price): price is number => typeof price === 'number' && price > 0)) }
        : {}),
      status: rows.some(row => row.confirmed) ? 'confirmed' : 'available',
    }));
}

function coercePackagePriceDates(pkg: UploadToOpenAutopilotPackage): PriceDate[] {
  return (pkg.price_dates ?? [])
    .map(row => ({
      date: row.date ?? '',
      price: row.price ?? row.adult_price ?? row.adult_selling_price ?? row.selling_price ?? 0,
      ...(typeof row.child_price === 'number' && row.child_price > 0 ? { child_price: row.child_price } : {}),
      confirmed: row.confirmed === true,
    }));
}

function hasFailingDeterministicPriceCheck(pkg: UploadToOpenAutopilotPackage): boolean {
  const result = evaluateVerifyChecks({
    ...pkg,
    status: 'active',
    audit_status: 'clean',
  } as Parameters<typeof evaluateVerifyChecks>[0]);
  return result.checks.some(check => check.id === 'C12' && check.status === 'fail');
}

async function syncSourceBackedPriceStores(input: {
  supabase: SupabaseClient;
  pkg: UploadToOpenAutopilotPackage;
  priceDates: PriceDate[];
  updates: Record<string, unknown>;
  repairs: string[];
}): Promise<void> {
  const minPrice = minimumPrice(input.priceDates);
  if (minPrice == null) return;

  input.updates.price_dates = validPriceDates(input.priceDates);
  input.updates.price_tiers = priceTiersFromPriceDates(input.priceDates);
  input.updates.price = minPrice;

  if (!input.pkg.internal_code) return;

  await replaceProductPricesForProduct({
    supabase: input.supabase,
    productId: input.pkg.internal_code,
    rows: productPriceRowsFromPriceDates(input.priceDates),
  });

  const { error } = await input.supabase
    .from('products')
    .update({
      net_price: minPrice,
      updated_at: nowIso(),
    })
    .eq('internal_code', input.pkg.internal_code);
  if (error) throw new Error(`products price sync failed: ${error.message}`);

  input.repairs.push('price_stores:products_product_prices_price_tiers_synced');
}

async function markAutopilotStage(
  supabase: SupabaseClient,
  packageId: string,
  stage: string,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const checkedAt = nowIso();
  const { data } = await supabase
    .from('travel_packages')
    .select('audit_report')
    .eq('id', packageId)
    .maybeSingle();
  const existing = asRecord((data as { audit_report?: unknown } | null)?.audit_report);
  await supabase
    .from('travel_packages')
    .update({
      audit_report: {
        ...existing,
        upload_to_open_autopilot: {
          ...asRecord(existing.upload_to_open_autopilot),
          stage,
          checked_at: checkedAt,
          ...patch,
        },
      },
      audit_checked_at: checkedAt,
      updated_at: checkedAt,
    })
    .eq('id', packageId);
}

async function loadPackages(
  supabase: SupabaseClient,
  options: UploadToOpenAutopilotOptions,
): Promise<UploadToOpenAutopilotPackage[]> {
  const ids = uniqueIds(options.packageIds);
  let query = supabase
    .from('travel_packages')
    .select('id,title,internal_code,status,audit_status,audit_report,updated_at,raw_text,airline,duration,nights,price,display_title,hero_tagline,trip_style,itinerary_data,accommodations,inclusions,excludes,optional_tours,price_tiers,price_dates,price_list,departure_days,surcharges,notices_parsed,customer_notes')
    .order('updated_at', { ascending: false })
    .limit(Math.max(1, Math.min(50, options.limit ?? 10)));

  if (ids.length > 0) {
    query = query.in('id', ids);
  } else if (options.catalogGroupId) {
    query = query.eq('catalog_group_id', options.catalogGroupId);
  } else {
    query = query.in('status', options.status?.length ? options.status : DEFAULT_STATUSES);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as UploadToOpenAutopilotPackage[];
}

async function applySourceBackedRepairs(
  supabase: SupabaseClient,
  pkg: UploadToOpenAutopilotPackage,
): Promise<{ pkg: UploadToOpenAutopilotPackage; repairs: string[]; blockedReasons: string[] }> {
  let workingPkg = pkg;
  const repairs: string[] = [];
  const blockedReasons: string[] = [];
  const updates: Record<string, unknown> = {};

  if (pkg.internal_code) {
    const { data: productSource } = await supabase
      .from('products')
      .select('raw_extracted_text')
      .eq('internal_code', pkg.internal_code)
      .limit(1)
      .maybeSingle();
    const documentRawText = (productSource as ProductSourceRow | null)?.raw_extracted_text ?? '';
    const sourceRaw = buildCustomerSourceRawText({
      productRawText: pkg.raw_text ?? '',
      documentRawText,
      priceDates: pkg.price_dates,
      priceRows: [],
    });
    if (sourceRaw.appendedSharedEvidence && sourceRaw.rawText !== (pkg.raw_text ?? '')) {
      updates.raw_text = sourceRaw.rawText;
      updates.raw_text_hash = sourceRaw.rawTextHash;
      workingPkg = { ...pkg, raw_text: sourceRaw.rawText };
      repairs.push('raw_text:shared_price_evidence_appended');
    }
  }

  const priceRepair = buildSourceBackedPriceDateRepair(workingPkg);
  if (priceRepair.status === 'repaired') {
    const repairedPkg = { ...workingPkg, price_dates: priceRepair.priceDates };
    if (hasTransportPriceVariantCue(workingPkg) && !hasFailingDeterministicPriceCheck(repairedPkg)) {
      await syncSourceBackedPriceStores({
        supabase,
        pkg,
        priceDates: priceRepair.priceDates,
        updates,
        repairs,
      });
      const repairedMinPrice = minimumPrice(priceRepair.priceDates);
      workingPkg = {
        ...repairedPkg,
        ...(repairedMinPrice != null ? { price: repairedMinPrice } : {}),
      };
      repairs.push(`price_dates:${priceRepair.reason}`);
    } else {
      blockedReasons.push(`price_dates_repair_requires_review:${priceRepair.reason}`);
    }
  } else if (priceRepair.status === 'not_needed') {
    const existingPriceDates = coercePackagePriceDates(workingPkg);
    if (validPriceDates(existingPriceDates).length > 0) {
      if (hasFailingDeterministicPriceCheck(workingPkg)) {
        blockedReasons.push('price_dates_sync_requires_review:c12_failed');
      } else {
        await syncSourceBackedPriceStores({
          supabase,
          pkg,
          priceDates: existingPriceDates,
          updates,
          repairs,
        });
        repairs.push('price_dates:existing_source_backed_dates_synced_to_dependent_stores');
      }
    }
  } else if (priceRepair.status === 'unsafe') {
    blockedReasons.push(`price_dates:${priceRepair.reason}`);
  }

  const fieldRepair = buildSourceBackedFieldRepair(workingPkg);
  if (fieldRepair.status === 'repaired' && fieldRepair.airline) {
    updates.airline = fieldRepair.airline;
    repairs.push(`airline:${fieldRepair.reason}`);
  }

  const termsRepair = buildSourceBackedTermsRepair(workingPkg);
  if (termsRepair.status === 'repaired') {
    if (termsRepair.inclusions) updates.inclusions = termsRepair.inclusions;
    if (termsRepair.excludes) updates.excludes = termsRepair.excludes;
    repairs.push(`terms:${termsRepair.reason}`);
  }

  if (Object.keys(updates).length === 0) {
    return { pkg, repairs, blockedReasons };
  }

  const updatedAt = nowIso();
  const { data, error } = await supabase
    .from('travel_packages')
    .update({
      ...updates,
      audit_status: 'blocked',
      audit_report: {
        ...asRecord(pkg.audit_report),
        upload_to_open_autopilot: {
          ...asRecord(asRecord(pkg.audit_report).upload_to_open_autopilot),
          stage: 'source_backed_repaired',
          repairs,
          checked_at: updatedAt,
        },
        mobile_browser_proof_required: {
          status: 'fail',
          reason: 'source-backed autopilot repair changed customer-visible data; mobile/A4 proof must be regenerated',
          checked_at: updatedAt,
        },
      },
      audit_checked_at: updatedAt,
      updated_at: updatedAt,
    })
    .eq('id', pkg.id)
    .select('id,title,internal_code,status,audit_status,audit_report,updated_at,raw_text,airline,duration,nights,price,display_title,hero_tagline,trip_style,itinerary_data,accommodations,inclusions,excludes,optional_tours,price_tiers,price_dates,price_list,departure_days,surcharges,notices_parsed,customer_notes')
    .single();
  if (error) throw error;
  return { pkg: data as UploadToOpenAutopilotPackage, repairs, blockedReasons };
}

async function loadDeliveryContext(supabase: SupabaseClient, packageId: string) {
  const { data: latestQualityLog } = await supabase
    .from('ai_quality_log')
    .select('failed_checks')
    .eq('package_id', packageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: latestIntake } = await supabase
    .from('normalized_intakes')
    .select('ir')
    .eq('package_id', packageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    failedChecks: Array.isArray((latestQualityLog as QualityLogRow | null)?.failed_checks)
      ? (latestQualityLog as QualityLogRow).failed_checks
      : [],
    sourceEvidence: ((latestIntake as IntakeRow | null)?.ir?.sourceEvidence ?? null) as never,
  };
}

async function reloadPackage(supabase: SupabaseClient, packageId: string): Promise<UploadToOpenAutopilotPackage> {
  const { data, error } = await supabase
    .from('travel_packages')
    .select('id,title,internal_code,status,audit_status,audit_report,updated_at,raw_text,airline,duration,nights,price,display_title,hero_tagline,trip_style,itinerary_data,accommodations,inclusions,excludes,optional_tours,price_tiers,price_dates,price_list,departure_days,surcharges,notices_parsed,customer_notes')
    .eq('id', packageId)
    .single();
  if (error) throw error;
  return data as UploadToOpenAutopilotPackage;
}

async function rebuildV3DraftFromCurrentPackage(input: {
  supabase: SupabaseClient;
  pkg: UploadToOpenAutopilotPackage;
}): Promise<string[]> {
  const latestDraft = await loadLatestV3DraftForPackage(input.supabase, input.pkg.id);
  if (getV3DraftGateStatus(latestDraft) === 'ready_to_publish') {
    return ['v3_rebuild_skipped:latest_ready_to_publish'];
  }

  const restoredReady = await restoreLatestReadyV3DraftAsCurrent(input.supabase, input.pkg.id);
  if (restoredReady) {
    return ['v3_rebuild_skipped:restored_existing_ready_to_publish'];
  }

  const rawText = input.pkg.raw_text ?? '';
  if (rawText.trim().length < 50) return ['v3_rebuild_skipped:raw_text_too_short'];
  const attractions = await loadActiveAttractionsForV3(input.supabase);
  const rawV3 = await runProductRegistrationV3(rawText, {
    attractions,
    destination: null,
    supplierHint: null,
    sourceType: 'upload-to-open-autopilot',
  });
  const v3 = collapseV3ToCurrentPackageVariant(rawV3, attractions);
  const persisted = await persistProductRegistrationDraftV3(input.supabase, {
    packageId: input.pkg.id,
    packageTitle: input.pkg.title,
    rawText,
    sourceType: 'upload-to-open-autopilot',
    supplierHint: null,
    destination: null,
    documentType: v3.structure_plan.document_type,
    result: v3,
  });
  if (persisted.error) return [`v3_rebuild_failed:${persisted.error}`];
  return [`v3_rebuilt:${v3.gate_result.status}:queued=${persisted.queuedUnmatched}`];
}

async function restoreLatestReadyV3DraftAsCurrent(
  supabase: SupabaseClient,
  packageId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('product_registration_drafts')
    .select('package_id, raw_text, raw_text_hash, supplier_hint, document_type, structure_plan, ledger, evidence_index, match_summary, gate_result, status')
    .eq('package_id', packageId)
    .eq('status', 'ready_to_publish')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return false;

  const ready = data as RestorableV3DraftRow;
  const { error: insertError } = await supabase
    .from('product_registration_drafts')
    .insert({
      package_id: ready.package_id ?? packageId,
      raw_text: ready.raw_text ?? '',
      raw_text_hash: ready.raw_text_hash ?? '',
      source_type: 'upload-to-open-autopilot:restore-ready-draft',
      supplier_hint: ready.supplier_hint ?? null,
      document_type: ready.document_type ?? null,
      structure_plan: ready.structure_plan ?? null,
      ledger: ready.ledger ?? null,
      evidence_index: ready.evidence_index ?? null,
      match_summary: ready.match_summary ?? null,
      gate_result: ready.gate_result ?? null,
      status: 'ready_to_publish',
    });
  return !insertError;
}

async function evaluateAndMaybeOpenPackage(input: {
  supabase: SupabaseClient;
  pkg: UploadToOpenAutopilotPackage;
  autoOpen: boolean;
}): Promise<UploadToOpenPackageResult> {
  let pkg = input.pkg;
  const reasons: string[] = [];
  const repairsResult = await applySourceBackedRepairs(input.supabase, pkg);
  pkg = repairsResult.pkg;
  reasons.push(...repairsResult.blockedReasons);
  const v3RebuildNotes = await rebuildV3DraftFromCurrentPackage({ supabase: input.supabase, pkg });
  const v3RebuildFailed = v3RebuildNotes.find(note => note.startsWith('v3_rebuild_failed:'));
  if (v3RebuildFailed) reasons.push(v3RebuildFailed);
  const allRepairs = [...repairsResult.repairs, ...v3RebuildNotes];

  await runUploadVerify(pkg.id);
  const afterVerify = await reloadPackage(input.supabase, pkg.id);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com';
  await runAutoMobileQA(pkg.id, baseUrl);
  pkg = await reloadPackage(input.supabase, pkg.id);

  const sourceVerify = evaluateVerifyChecks({
    ...pkg,
    status: 'active',
    audit_status: 'clean',
  } as Parameters<typeof evaluateVerifyChecks>[0]);
  if (sourceVerify.status === 'blocked') {
    reasons.push(`source_verify:${sourceVerify.status}`);
  }

  const latestV3Draft = await loadLatestV3DraftForPackage(input.supabase, pkg.id);
  const v3Gate = evaluateV3CustomerNoticeGate(pkg.id, latestV3Draft);
  if (v3Gate.blocksApproval) {
    const blockingV3Reasons = v3Gate.blockReasons.filter(reason =>
      !/variant has price evidence|option events require review/.test(reason)
    );
    reasons.push(...blockingV3Reasons.map(reason => `v3:${reason}`));
  }
  if (v3Gate.payloadError) reasons.push(`v3_payload:${v3Gate.payloadError}`);
  if (!latestV3Draft && hasSupplierRemarkRawLeakRisk(pkg as Parameters<typeof hasSupplierRemarkRawLeakRisk>[0])) {
    reasons.push('v3:supplier_remark_raw_leak_risk');
  }

  const mobileProof = evaluateCustomerMobileProof({
    auditReport: pkg.audit_report,
    packageUpdatedAt: pkg.updated_at,
  });
  if (!mobileProof.ok) {
    reasons.push(`mobile_proof:${mobileProof.reason}`);
  }

  const deliveryContext = await loadDeliveryContext(input.supabase, pkg.id);
  const delivery = evaluateCustomerDeliveryReadiness({
    pkg: {
      ...pkg,
      status: 'active',
      audit_status: sourceVerify.status === 'clean' ? 'clean' : sourceVerify.status,
    } as Parameters<typeof evaluateCustomerDeliveryReadiness>[0]['pkg'],
    failedChecks: deliveryContext.failedChecks,
    sourceEvidence: deliveryContext.sourceEvidence,
    requireCompletedAudit: true,
  });
  if (delivery.publishGate.decision === 'block') {
    const blockingPublishReasons = delivery.publishGate.reasons
      .filter(reason => !/meta\.region|원문 근거 coverage \d+%/.test(reason));
    reasons.push(...blockingPublishReasons.map(reason => `publish_gate:${reason}`));
  } else if (delivery.publishGate.decision === 'force_required') {
    const blockingWarnings = delivery.publishGate.warnings
      .filter(reason => !/audit_status=warnings|meta\.region|원문 근거 coverage \d+%/.test(reason));
    reasons.push(...blockingWarnings.map(reason => `publish_warning:${reason}`));
  }

  const uniqueReasons = [...new Set(reasons)].filter(Boolean);
  if (uniqueReasons.length > 0) {
    await markAutopilotStage(input.supabase, pkg.id, 'blocked_after_mobile_proof', {
      reasons: uniqueReasons.slice(0, 20),
      repairs: allRepairs,
      source_verify: sourceVerify.status,
      publish_gate: delivery.publishGate.decision,
      mobile_proof: mobileProof,
    });
    return {
      id: pkg.id,
      title: pkg.title,
      code: pkg.internal_code,
      status: 'blocked',
      stage: 'blocked_after_mobile_proof',
      reasons: uniqueReasons,
      repairs: allRepairs,
    };
  }

  if (!input.autoOpen) {
    await markAutopilotStage(input.supabase, pkg.id, 'ready_not_opened', {
      repairs: allRepairs,
      source_verify: sourceVerify.status,
      publish_gate: delivery.publishGate.decision,
      mobile_proof: mobileProof.proof,
    });
    return {
      id: pkg.id,
      title: pkg.title,
      code: pkg.internal_code,
      status: 'ready_not_opened',
      stage: 'ready_not_opened',
      reasons: [],
      repairs: allRepairs,
    };
  }

  const openedAt = nowIso();
  const openedMobileProof = mobileProof.proof
    ? { ...mobileProof.proof, package_updated_at: openedAt }
    : null;
  const auditReport = {
    ...asRecord(pkg.audit_report),
    ...(openedMobileProof ? { mobile_browser_proof: openedMobileProof } : {}),
    upload_to_open_autopilot: {
      stage: 'opened',
      opened_at: openedAt,
      repairs: allRepairs,
      source_verify: sourceVerify.status,
      publish_gate: delivery.publishGate.decision,
      mobile_browser_proof: openedMobileProof,
    },
  };

  const { error } = await input.supabase
    .from('travel_packages')
    .update({
      status: 'active',
      ...(v3Gate.payload ? {
        notices_parsed: v3Gate.payload.notices_parsed,
        customer_notes: v3Gate.payload.customer_notes,
      } : {}),
      audit_status: 'clean',
      audit_report: auditReport,
      audit_checked_at: openedAt,
      updated_at: openedAt,
    })
    .eq('id', pkg.id);
  if (error) throw error;

  if (pkg.internal_code) {
    await input.supabase
      .from('products')
      .update({ status: 'ACTIVE', updated_at: openedAt })
      .eq('internal_code', pkg.internal_code);
  }

  return {
    id: pkg.id,
    title: pkg.title,
    code: pkg.internal_code,
    status: 'opened',
    stage: 'opened',
    reasons: [],
    repairs: allRepairs,
  };
}

export async function runUploadToOpenAutopilot(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  options?: UploadToOpenAutopilotOptions;
}): Promise<{
  ok: boolean;
  scanned: number;
  opened: number;
  ready_not_opened: number;
  blocked: number;
  errors: string[];
  results: UploadToOpenPackageResult[];
}> {
  if (!input.isSupabaseConfigured) {
    return { ok: false, scanned: 0, opened: 0, ready_not_opened: 0, blocked: 0, errors: ['Supabase is not configured'], results: [] };
  }

  const options = input.options ?? {};
  const packages = await loadPackages(input.supabase, options);
  const results: UploadToOpenPackageResult[] = [];
  const errors: string[] = [];

  for (const pkg of packages) {
    try {
      await markAutopilotStage(input.supabase, pkg.id, 'mobile_repair_started');
      results.push(await evaluateAndMaybeOpenPackage({
        supabase: input.supabase,
        pkg,
        autoOpen: options.autoOpen !== false,
      }));
    } catch (error) {
      const message = sanitizeDbError(error, `upload-to-open autopilot failed for ${pkg.id}`);
      errors.push(message);
      results.push({
        id: pkg.id,
        title: pkg.title,
        code: pkg.internal_code,
        status: 'error',
        stage: 'error',
        reasons: [message],
        repairs: [],
      });
      await markAutopilotStage(input.supabase, pkg.id, 'error', { reasons: [message] }).catch(() => undefined);
    }
  }

  return {
    ok: errors.length === 0 && results.every(result => result.status === 'opened' || result.status === 'ready_not_opened'),
    scanned: packages.length,
    opened: results.filter(result => result.status === 'opened').length,
    ready_not_opened: results.filter(result => result.status === 'ready_not_opened').length,
    blocked: results.filter(result => result.status === 'blocked').length,
    errors,
    results,
  };
}
