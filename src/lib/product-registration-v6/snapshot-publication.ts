import type { SupabaseClient } from '@supabase/supabase-js';

import { runAutoMobileQA } from '@/lib/auto-mobile-qa';
import { buildPublicPackageSnapshot } from '@/lib/package-publication/public-snapshot';
import { persistProductRegistrationV5ProofRun } from '@/lib/product-registration-v4/proof';
import { runProductRegistrationV6ChromeProof } from './browser-proof';
import { createProductRegistrationV6ProofToken } from './proof-token';
import type { ProductRegistrationV6Decision } from './types';
import type { ResolvedTransportForSnapshot } from './shared-fact-orchestrator';

type JsonObject = Record<string, unknown>;

export type ProductRegistrationV6CandidateSnapshot = {
  packageId: string;
  revisionId: string;
  snapshotId: string;
  snapshotHash: string;
  rendererBuildId: string;
};

function degradedPackageCopy(pkg: JsonObject, decision: ProductRegistrationV6Decision): JsonObject {
  if (decision.outcome !== 'degraded') return pkg;
  const notice = '항공 운항 시각·미정 호텔 등 일부 정보는 운항일 기준 상담 시 최종 확인해 드립니다.';
  const existingNotes = typeof pkg.customer_notes === 'string' ? pkg.customer_notes.trim() : '';
  return {
    ...pkg,
    customer_notes: existingNotes ? `${existingNotes}\n${notice}` : notice,
    product_registration_disclosure: {
      state: 'published_degraded',
      notice,
      reasons: decision.degradedReasons,
    },
  };
}

function applyResolvedTransport(
  pkg: JsonObject,
  packageId: string,
  resolvedTransport: ResolvedTransportForSnapshot[],
): JsonObject {
  const itinerary = pkg.itinerary_data && typeof pkg.itinerary_data === 'object' && !Array.isArray(pkg.itinerary_data)
    ? { ...(pkg.itinerary_data as JsonObject) }
    : null;
  if (!itinerary || !Array.isArray(itinerary.flight_segments)) return pkg;
  const segments = itinerary.flight_segments.map(segment => {
    if (!segment || typeof segment !== 'object' || Array.isArray(segment)) return segment;
    const row = segment as JsonObject;
    const leg = String(row.leg ?? '');
    const serviceNumber = String(row.flight_no ?? row.code ?? '').replace(/\s+/g, '').toUpperCase();
    const candidates = resolvedTransport.filter(item =>
      item.packageId === packageId
      && item.leg === leg
      && item.serviceNumber === serviceNumber
      && (item.state === 'source_confirmed' || item.state === 'corroborated')
      && item.departureLocalTime
      && item.arrivalLocalTime,
    );
    const variants = new Set(candidates.map(item => `${item.departureLocalTime}|${item.arrivalLocalTime}|${item.arrivalDayOffset}`));
    if (variants.size !== 1) return row;
    const resolved = candidates[0]!;
    return {
      ...row,
      dep_time: row.dep_time || resolved.departureLocalTime,
      arr_time: row.arr_time || resolved.arrivalLocalTime,
      arr_day_offset: row.arr_day_offset ?? resolved.arrivalDayOffset,
      v6_fact_state: resolved.state,
    };
  });
  return { ...pkg, itinerary_data: { ...itinerary, flight_segments: segments } };
}

export async function buildProductRegistrationV6CandidateSnapshots(input: {
  supabase: SupabaseClient;
  decision: ProductRegistrationV6Decision;
  resolvedTransport?: ResolvedTransportForSnapshot[];
}): Promise<ProductRegistrationV6CandidateSnapshot[]> {
  const pairs = input.decision.packageIds.map((packageId, index) => ({
    packageId,
    revisionId: input.decision.revisionIds[index] ?? input.decision.revisionIds[0],
  })).filter((pair): pair is { packageId: string; revisionId: string } => Boolean(pair.packageId && pair.revisionId));
  const results: ProductRegistrationV6CandidateSnapshot[] = [];
  for (const pair of pairs) {
    const { data: pkg, error: packageError } = await input.supabase
      .from('travel_packages')
      .select('*, products(internal_code, display_name, departure_region)')
      .eq('id', pair.packageId)
      .single();
    if (packageError || !pkg) throw packageError ?? new Error('V6_PACKAGE_NOT_FOUND');
    const { data: revision, error: revisionError } = await input.supabase
      .from('product_registration_v5_revisions')
      .select('id,payload_hash,revision_no,package_id')
      .eq('id', pair.revisionId)
      .eq('package_id', pair.packageId)
      .single();
    if (revisionError || !revision) throw revisionError ?? new Error('V6_REVISION_NOT_FOUND');

    const { data: copyResult, error: copyError } = await input.supabase.rpc('get_product_registration_v6_verified_copy', {
      p_revision_id: pair.revisionId,
      p_locale: 'ko-KR',
    });
    if (copyError || !copyResult || typeof copyResult !== 'object') {
      throw copyError ?? new Error('V6_VERIFIED_COPY_MISSING');
    }
    const copyPayload = (copyResult as JsonObject).copy_payload;
    if (!copyPayload || typeof copyPayload !== 'object' || Array.isArray(copyPayload)) {
      throw new Error('V6_VERIFIED_COPY_PAYLOAD_INVALID');
    }
    const copy = copyPayload as JsonObject;

    const source = degradedPackageCopy(
      applyResolvedTransport({
        ...(pkg as JsonObject),
        title: copy.title ?? pkg.title,
        product_summary: copy.summary ?? pkg.product_summary,
        product_highlights: copy.highlights ?? pkg.product_highlights,
        product_registration_copy: copy,
      }, pair.packageId, input.resolvedTransport ?? []),
      input.decision,
    );
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot({
      ...source,
      canonical_revision_id: pair.revisionId,
      canonical_payload_hash: revision.payload_hash,
      package_revision: revision.revision_no,
    });
    const rendererBuildId = process.env.VERCEL_GIT_COMMIT_SHA
      ?? process.env.NEXT_PUBLIC_BUILD_ID
      ?? 'local-v6-renderer';
    const row = {
      package_id: pair.packageId,
      package_revision: Number(revision.revision_no),
      canonical_revision_id: pair.revisionId,
      snapshot_hash: snapshotHash,
      snapshot_version: snapshot.snapshot_version,
      snapshot_json: snapshot,
      card_projection: snapshot.card_projection,
      lp_projection: snapshot.lp_projection,
      route_text_dump: snapshot.route_text_dump,
      source_raw_text_hash: typeof pkg.raw_text_hash === 'string' ? pkg.raw_text_hash : null,
      parser_revision: 'product-registration-v6',
      renderer_build_id: rendererBuildId,
      locale: 'ko-KR',
      projection_hashes: {
        card: snapshotHash,
        lp: snapshotHash,
      },
      app_build_id: rendererBuildId,
      status: 'candidate',
    };
    const { data: inserted, error: insertError } = await input.supabase
      .from('public_package_snapshots')
      .insert(row)
      .select('id')
      .maybeSingle();
    let snapshotId = typeof inserted?.id === 'string' ? inserted.id : null;
    if (insertError || !snapshotId) {
      const { data: existing, error: existingError } = await input.supabase
        .from('public_package_snapshots')
        .select('id,canonical_revision_id')
        .eq('package_id', pair.packageId)
        .eq('snapshot_hash', snapshotHash)
        .maybeSingle();
      if (existingError || !existing || existing.canonical_revision_id !== pair.revisionId) {
        throw insertError ?? existingError ?? new Error('V6_SNAPSHOT_INSERT_FAILED');
      }
      snapshotId = String(existing.id);
    }
    results.push({ packageId: pair.packageId, revisionId: pair.revisionId, snapshotId, snapshotHash, rendererBuildId });
  }
  return results;
}

export async function proveProductRegistrationV6Snapshot(input: {
  supabase: SupabaseClient;
  snapshot: ProductRegistrationV6CandidateSnapshot;
  baseUrl: string;
}): Promise<{ proofRunId: string; token: string }> {
  const token = createProductRegistrationV6ProofToken({
    snapshotId: input.snapshot.snapshotId,
    snapshotHash: input.snapshot.snapshotHash,
    packageId: input.snapshot.packageId,
  });
  const baseUrl = input.baseUrl.replace(/\/$/, '');
  const surfaceUrls = {
    packages: `${baseUrl}/__proof/packages/${input.snapshot.snapshotId}`,
    lp: `${baseUrl}/__proof/lp/${input.snapshot.snapshotId}`,
  };
  await runAutoMobileQA(input.snapshot.packageId, baseUrl, {
    includeLpForProof: true,
    proofToken: token,
    surfaceUrls,
  });
  const chromeProof = await runProductRegistrationV6ChromeProof({
    surfaceUrls,
    proofToken: token,
    expectedSnapshotHash: input.snapshot.snapshotHash,
  });
  const { data: pkg, error } = await input.supabase
    .from('travel_packages')
    .select('audit_report')
    .eq('id', input.snapshot.packageId)
    .single();
  if (error) throw error;
  const auditReport = pkg?.audit_report && typeof pkg.audit_report === 'object'
    ? pkg.audit_report as JsonObject
    : {};
  const proof = auditReport.mobile_browser_proof && typeof auditReport.mobile_browser_proof === 'object'
    ? auditReport.mobile_browser_proof as JsonObject
    : null;
  const surfaces = Array.isArray(proof?.surface_results) ? proof.surface_results : [];
  const passed = chromeProof.status === 'passed'
    && proof?.status === 'pass'
    && ['packages', 'lp'].every(surface => surfaces.some(item =>
      item && typeof item === 'object' && (item as JsonObject).surface === surface && (item as JsonObject).status === 'pass'
    ));
  const persisted = await persistProductRegistrationV5ProofRun({
    supabase: input.supabase,
    proof: {
      packageId: input.snapshot.packageId,
      revisionId: input.snapshot.revisionId,
      publicSnapshotId: input.snapshot.snapshotId,
      snapshotHash: input.snapshot.snapshotHash,
      rendererBuildId: input.snapshot.rendererBuildId,
      proofSuiteVersion: 'product-registration-v6-mobile-chrome-2',
      route: `${surfaceUrls.packages}|${surfaceUrls.lp}`,
      viewport: { width: 390, height: 844, deviceScaleFactor: 3 },
      locale: 'ko-KR',
      deviceProfile: 'mobile-customer',
      status: passed ? 'passed' : 'failed',
      result: { proof, chromeProof, surfaceUrls, tokenBound: true },
      checkedAt: new Date().toISOString(),
    },
  });
  if (!passed) throw new Error('V6_BROWSER_PROOF_FAILED');
  return { proofRunId: persisted.proofRunId, token };
}

export async function publishProductRegistrationV6Snapshot(input: {
  supabase: SupabaseClient;
  snapshot: ProductRegistrationV6CandidateSnapshot;
  proofRunId: string;
  outcome: 'published_verified' | 'published_degraded';
  policyVersion: string;
  idempotencyKey: string;
}): Promise<Record<string, unknown>> {
  const { data: pointer, error: pointerError } = await input.supabase
    .from('product_registration_v5_publication_pointers')
    .select('pointer_version')
    .eq('package_id', input.snapshot.packageId)
    .eq('channel', 'customer')
    .eq('locale', 'ko-KR')
    .maybeSingle();
  if (pointerError) throw pointerError;
  const { data, error } = await input.supabase.rpc('publish_product_registration_v6_snapshot_atomic', {
    p_package_id: input.snapshot.packageId,
    p_revision_id: input.snapshot.revisionId,
    p_snapshot_id: input.snapshot.snapshotId,
    p_snapshot_hash: input.snapshot.snapshotHash,
    p_proof_run_id: input.proofRunId,
    p_expected_pointer_version: Number(pointer?.pointer_version ?? 0),
    p_idempotency_key: input.idempotencyKey,
    p_policy_version: input.policyVersion,
    p_v6_outcome: input.outcome,
  });
  if (error) throw error;
  return data as Record<string, unknown>;
}
