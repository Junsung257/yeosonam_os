import type { SupabaseClient } from '@supabase/supabase-js';

import type { AttractionData } from '@/lib/attraction-matcher';
import { runAutoMobileQA } from '@/lib/auto-mobile-qa';
import { evaluateCustomerDeliveryReadiness } from '@/lib/customer-delivery-check';
import { evaluateCustomerMobileProof } from '@/lib/customer-mobile-proof';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  evaluateV3CustomerNoticeGate,
  hasSupplierRemarkRawLeakRisk,
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
import { buildSourceBackedPriceDateRepair } from '@/lib/source-price-date-repair';
import { buildSourceBackedTermsRepair } from '@/lib/source-terms-repair';
import { runUploadVerify, evaluateVerifyChecks } from '@/lib/upload-verify';
import { buildCustomerSourceRawText } from './source-evidence-raw-text';

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
    .select('id,title,internal_code,status,audit_status,audit_report,updated_at,raw_text,airline,duration,nights,price,display_title,hero_tagline,trip_style,itinerary_data,accommodations,inclusions,excludes,optional_tours,price_dates,price_list,departure_days,surcharges,notices_parsed,customer_notes')
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
    updates.price_dates = priceRepair.priceDates;
    const prices = priceRepair.priceDates
      .map(row => row.price)
      .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0);
    if (prices.length > 0) updates.price = Math.min(...prices);
    repairs.push(`price_dates:${priceRepair.reason}`);
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
    .select('id,title,internal_code,status,audit_status,audit_report,updated_at,raw_text,airline,duration,nights,price,display_title,hero_tagline,trip_style,itinerary_data,accommodations,inclusions,excludes,optional_tours,price_dates,price_list,departure_days,surcharges,notices_parsed,customer_notes')
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
    .select('id,title,internal_code,status,audit_status,audit_report,updated_at,raw_text,airline,duration,nights,price,display_title,hero_tagline,trip_style,itinerary_data,accommodations,inclusions,excludes,optional_tours,price_dates,price_list,departure_days,surcharges,notices_parsed,customer_notes')
    .eq('id', packageId)
    .single();
  if (error) throw error;
  return data as UploadToOpenAutopilotPackage;
}

async function rebuildV3DraftFromCurrentPackage(input: {
  supabase: SupabaseClient;
  pkg: UploadToOpenAutopilotPackage;
}): Promise<string[]> {
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
  if (!mobileProof.ok && mobileProof.reason !== 'actual /packages mobile browser proof is missing') {
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
      .update({ status: 'active', updated_at: openedAt })
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
