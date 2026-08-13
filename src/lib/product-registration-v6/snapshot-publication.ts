import type { SupabaseClient } from '@supabase/supabase-js';

import { buildPublicPackageSnapshot } from '@/lib/package-publication/public-snapshot';
import {
  buildPackageProjectionFromRevision,
  loadProductRegistrationRevisionAggregate,
} from '@/lib/product-registration-authority/revision-aggregate';
import { createCandidateSnapshot } from '@/lib/product-registration-authority/repository';
import { persistProductRegistrationV5ProofRun } from '@/lib/product-registration-v4/proof';
import { PRODUCT_SOURCE_BUCKET } from '@/lib/product-registration-v4/source-documents';
import { runProductRegistrationV6ChromeProof } from './browser-proof';
import { createProductRegistrationV6ProofToken } from './proof-token';
import { currentProductRegistrationRendererBuildId } from './renderer-build';
import type { ProductRegistrationV6Decision } from './types';
import type { ResolvedTransportForSnapshot } from './shared-fact-orchestrator';

type JsonObject = Record<string, unknown>;

export function productRegistrationProofScreenshotPath(input: {
  tenantId: string;
  snapshotId: string;
  rendererBuildId: string;
  surface: 'packages' | 'lp';
  screenshotHash: string;
}): string {
  const safeBuild = input.rendererBuildId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${input.tenantId}/proofs/${input.snapshotId}/${safeBuild}/${input.surface}-${input.screenshotHash}.png`;
}

async function persistPrivateProofScreenshots(input: {
  supabase: SupabaseClient;
  snapshot: ProductRegistrationV6CandidateSnapshot;
  chromeProof: Awaited<ReturnType<typeof runProductRegistrationV6ChromeProof>>;
}) {
  const surfaces = [];
  for (const captured of input.chromeProof.surfaces) {
    const { screenshotPng, ...surface } = captured;
    if (!screenshotPng || !surface.screenshotHash) {
      surfaces.push({ ...surface, screenshotStorage: null });
      continue;
    }
    const storagePath = productRegistrationProofScreenshotPath({
      tenantId: input.snapshot.tenantId,
      snapshotId: input.snapshot.snapshotId,
      rendererBuildId: input.snapshot.rendererBuildId,
      surface: surface.surface,
      screenshotHash: surface.screenshotHash,
    });
    const upload = await input.supabase.storage.from(PRODUCT_SOURCE_BUCKET).upload(
      storagePath,
      Buffer.from(screenshotPng),
      { contentType: 'image/png', upsert: false },
    );
    if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) throw upload.error;
    surfaces.push({
      ...surface,
      screenshotStorage: {
        bucket: PRODUCT_SOURCE_BUCKET,
        path: storagePath,
        private: true,
      },
    });
  }
  return { ...input.chromeProof, surfaces };
}

export type ProductRegistrationV6CandidateSnapshot = {
  tenantId: string;
  catalogProductId: string;
  packageId: string;
  revisionId: string;
  snapshotId: string;
  snapshotHash: string;
  rendererBuildId: string;
  proofAssertions: {
    requiredText: string[];
    forbiddenText: string[];
  };
};

function customerProofAssertions(input: {
  snapshot: JsonObject;
  packageId: string;
  resolvedTransport: ResolvedTransportForSnapshot[];
}): ProductRegistrationV6CandidateSnapshot['proofAssertions'] {
  const pkg = input.snapshot.package && typeof input.snapshot.package === 'object' && !Array.isArray(input.snapshot.package)
    ? input.snapshot.package as JsonObject
    : {};
  const itinerary = pkg.itinerary_data && typeof pkg.itinerary_data === 'object' && !Array.isArray(pkg.itinerary_data)
    ? pkg.itinerary_data as JsonObject
    : {};
  const segments = Array.isArray(itinerary.flight_segments)
    ? itinerary.flight_segments.filter((item): item is JsonObject => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : [];
  const termsSnapshot = pkg.terms_snapshot && typeof pkg.terms_snapshot === 'object' && !Array.isArray(pkg.terms_snapshot)
    ? pkg.terms_snapshot as JsonObject
    : {};
  const notices = Array.isArray(termsSnapshot.notices)
    ? termsSnapshot.notices.filter((item): item is JsonObject => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : [];
  const price = typeof pkg.price === 'number' && Number.isFinite(pkg.price)
    ? `${pkg.price.toLocaleString('ko-KR')}원`
    : null;
  const requiredText = [
    typeof pkg.title === 'string' ? pkg.title : null,
    price,
    ...segments.map(segment => typeof segment.flight_no === 'string' ? segment.flight_no : null),
    ...(Array.isArray(pkg.inclusions) ? pkg.inclusions : []),
    ...(Array.isArray(pkg.excludes) ? pkg.excludes : []),
    ...notices.filter(notice => notice.type === 'AUTO_TICKETING').map(notice => notice.text),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const forbiddenText = input.resolvedTransport
    .filter(item => item.packageId === input.packageId && (!item.verifiedByCurrentProviders || item.state === 'conflicting'))
    .flatMap(item => [item.departureLocalTime, item.arrivalLocalTime])
    .filter((value): value is string => typeof value === 'string' && /^\d{2}:\d{2}$/.test(value));
  return {
    requiredText: [...new Set(requiredText)],
    forbiddenText: [...new Set(forbiddenText)],
  };
}

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

export function applyResolvedTransport(
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
    const matchingFacts = resolvedTransport.filter(item =>
      item.packageId === packageId
      && item.leg === leg
      && item.serviceNumber === serviceNumber,
    );
    if (matchingFacts.length === 0) return row;

    const candidates = matchingFacts.filter(item => {
      const sourceConfirmed = item.state === 'source_confirmed'
        && (item.resolutionBasis === 'source' || item.resolutionBasis === undefined);
      const independentProducts = item.state === 'corroborated'
        && item.resolutionBasis === 'independent_products'
        && (item.trustScore ?? 0) >= 0.8
        && (item.independentSourceCount ?? 0) >= 2;
      const currentProviders = item.verifiedByCurrentProviders
        && (item.state === 'source_confirmed' || item.state === 'corroborated');
      return (sourceConfirmed || independentProducts || currentProviders)
        && Boolean(item.departureLocalTime && item.arrivalLocalTime);
    });
    const variants = new Set(candidates.map(item => `${item.departureLocalTime}|${item.arrivalLocalTime}|${item.arrivalDayOffset}`));
    const hasConflict = matchingFacts.some(item => item.state === 'conflicting');
    if (hasConflict || variants.size !== 1) {
      const {
        dep_time: _departureTime,
        arr_time: _arrivalTime,
        arr_day_offset: _arrivalDayOffset,
        departure_local_time: _departureLocalTime,
        arrival_local_time: _arrivalLocalTime,
        arrival_day_offset: _arrivalLocalDayOffset,
        ...safeRow
      } = row;
      return {
        ...safeRow,
        v6_fact_state: hasConflict ? 'conflicting' : 'degraded',
        v6_schedule_notice: '운항일 기준 상담 시 최종 확인',
      };
    }
    const resolved = candidates[0]!;
    return {
      ...row,
      dep_time: resolved.departureLocalTime,
      arr_time: resolved.arrivalLocalTime,
      arr_day_offset: resolved.arrivalDayOffset,
      v6_fact_state: resolved.state,
      v6_fact_basis: resolved.resolutionBasis ?? (resolved.verifiedByCurrentProviders ? 'schedule_providers' : 'source'),
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
    const [{ data: identity, error: packageError }, aggregate] = await Promise.all([
      input.supabase
      .from('travel_packages')
      .select('id,tenant_id,catalog_product_id,short_code,land_operator,land_operator_id')
      .eq('id', pair.packageId)
      .single(),
      loadProductRegistrationRevisionAggregate({ supabase: input.supabase, revisionId: pair.revisionId }),
    ]);
    if (packageError || !identity) throw packageError ?? new Error('V6_PACKAGE_NOT_FOUND');
    const revision = aggregate.revision;
    const catalogProductId = typeof (identity as JsonObject).catalog_product_id === 'string'
      ? String((identity as JsonObject).catalog_product_id)
      : null;
    if (!catalogProductId || revision.catalog_product_id !== catalogProductId) {
      throw new Error('V6_SNAPSHOT_CATALOG_IDENTITY_MISMATCH');
    }
    const tenantId = typeof (identity as JsonObject).tenant_id === 'string'
      ? String((identity as JsonObject).tenant_id)
      : null;
    if (!tenantId || revision.tenant_id !== tenantId) throw new Error('V6_SNAPSHOT_TENANT_MISMATCH');

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

    const revisionPackage = buildPackageProjectionFromRevision({
      packageId: pair.packageId,
      aggregate,
      operationalIdentity: identity as JsonObject,
    });
    const source = degradedPackageCopy(
      applyResolvedTransport({
        ...revisionPackage,
        title: copy.title ?? revisionPackage.title,
        product_summary: copy.summary ?? revisionPackage.product_summary,
        product_highlights: copy.highlights ?? revisionPackage.product_highlights,
        product_registration_copy: copy,
        terms_snapshot: input.decision.termsPolicies?.find(policy => policy.revisionId === pair.revisionId),
      }, pair.packageId, input.resolvedTransport ?? []),
      input.decision,
    );
    if (!source.terms_snapshot) throw new Error('V6_TERMS_POLICY_SNAPSHOT_MISSING');
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot({
      ...source,
      canonical_revision_id: pair.revisionId,
      canonical_payload_hash: revision.payload_hash,
      package_revision: revision.revision_no,
    });
    const rendererBuildId = currentProductRegistrationRendererBuildId();
    const row = {
      package_id: pair.packageId,
      catalog_product_id: catalogProductId,
      package_revision: Number(revision.revision_no),
      canonical_revision_id: pair.revisionId,
      snapshot_hash: snapshotHash,
      snapshot_version: snapshot.snapshot_version,
      snapshot_json: snapshot,
      card_projection: snapshot.card_projection,
      lp_projection: snapshot.lp_projection,
      route_text_dump: snapshot.route_text_dump,
      source_raw_text_hash: revision.source_hash,
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
    const persistedSnapshot = await createCandidateSnapshot({ supabase: input.supabase, row });
    const snapshotId = persistedSnapshot.snapshotId;
    results.push({
      tenantId,
      catalogProductId,
      packageId: pair.packageId,
      revisionId: pair.revisionId,
      snapshotId,
      snapshotHash,
      rendererBuildId,
      proofAssertions: customerProofAssertions({
        snapshot: snapshot as unknown as JsonObject,
        packageId: pair.packageId,
        resolvedTransport: input.resolvedTransport ?? [],
      }),
    });
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
    packages: `${baseUrl}/product-registration-proof/packages/${input.snapshot.snapshotId}`,
    lp: `${baseUrl}/product-registration-proof/lp/${input.snapshot.snapshotId}`,
  };
  const chromeProof = await runProductRegistrationV6ChromeProof({
    surfaceUrls,
    proofToken: token,
    expectedSnapshotHash: input.snapshot.snapshotHash,
    expectedRendererBuildId: input.snapshot.rendererBuildId,
    requiredText: input.snapshot.proofAssertions.requiredText,
    forbiddenText: input.snapshot.proofAssertions.forbiddenText,
  });
  const persistedChromeProof = await persistPrivateProofScreenshots({
    supabase: input.supabase,
    snapshot: input.snapshot,
    chromeProof,
  });
  const passed = chromeProof.status === 'passed'
    && chromeProof.surfaces.length === 2
    && chromeProof.surfaces.every(surface => surface.status === 'passed'
      && surface.snapshotHash === input.snapshot.snapshotHash
      && surface.rendererBuildId === input.snapshot.rendererBuildId
      && surface.ctaOpened
      && surface.hydrationErrors.length === 0)
    && persistedChromeProof.surfaces.every(surface => Boolean(surface.screenshotStorage));
  const persisted = await persistProductRegistrationV5ProofRun({
    supabase: input.supabase,
    proof: {
      tenantId: input.snapshot.tenantId,
      packageId: input.snapshot.packageId,
      catalogProductId: input.snapshot.catalogProductId,
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
      result: {
        chromeProof: persistedChromeProof,
        surfaceUrls,
        tokenBound: true,
        legacyPackageMutation: false,
        screenshotArtifactsPrivate: true,
      },
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
  channel?: 'customer' | 'b2b' | 'partner';
  locale?: string;
}): Promise<Record<string, unknown>> {
  const channel = input.channel ?? 'customer';
  const locale = input.locale ?? 'ko-KR';
  const { data: pointer, error: pointerError } = await input.supabase
    .from('product_registration_v5_publication_pointers')
    .select('pointer_version')
    .eq('package_id', input.snapshot.packageId)
    .eq('channel', channel)
    .eq('locale', locale)
    .maybeSingle();
  if (pointerError) throw pointerError;
  const { data, error } = await input.supabase.rpc('publish_product_registration_snapshot_atomic', {
    p_payload: {
      tenant_id: input.snapshot.tenantId,
      catalog_product_id: input.snapshot.catalogProductId,
      package_id: input.snapshot.packageId,
      revision_id: input.snapshot.revisionId,
      snapshot_id: input.snapshot.snapshotId,
      snapshot_hash: input.snapshot.snapshotHash,
      proof_run_id: input.proofRunId,
      expected_pointer_version: Number(pointer?.pointer_version ?? 0),
      operation_key: input.idempotencyKey,
      policy_version: input.policyVersion,
      outcome: input.outcome,
      channel,
      locale,
    },
  });
  if (error) throw error;
  return data as Record<string, unknown>;
}
