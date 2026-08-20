import { createHash } from 'node:crypto';

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
import {
  PRODUCT_REGISTRATION_V6_POLICY_VERSION,
  PRODUCT_REGISTRATION_V6_WORDING_RULES_VERSION,
  type ProductRegistrationV6Decision,
} from './types';
import type { ResolvedTransportForSnapshot } from './shared-fact-orchestrator';

type JsonObject = Record<string, unknown>;

function stableSurfaceJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSurfaceJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSurfaceJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function formatSupabaseError(prefix: string, error: unknown): Error {
  if (error && typeof error === 'object') {
    const value = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
    const parts = [
      typeof value.code === 'string' ? value.code : null,
      typeof value.message === 'string' ? value.message : null,
      typeof value.details === 'string' && value.details ? value.details : null,
      typeof value.hint === 'string' && value.hint ? value.hint : null,
    ].filter((part): part is string => Boolean(part));
    if (parts.length > 0) return new Error(`${prefix}:${parts.join(' | ')}`);
  }
  return new Error(`${prefix}:${String(error)}`);
}

export function customerSnapshotHygieneBlockers(value: unknown): string[] {
  const strings: string[] = [];
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') strings.push(candidate.normalize('NFKC').replace(/\s+/gu, ' ').trim());
    else if (Array.isArray(candidate)) candidate.forEach(visit);
    else if (candidate && typeof candidate === 'object') Object.values(candidate as JsonObject).forEach(visit);
  };
  visit(value);
  const blockers = new Set<string>();
  for (const text of strings) {
    if (!text) continue;
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) blockers.add('CUSTOMER_TEXT_CONTROL_CHARACTER');
    if (/(?:^|\s)(?:HOTEL|REMARK)\s*:/iu.test(text)) blockers.add('CUSTOMER_TEXT_SUPPLIER_MARKER');
    if (/\/\/\s*(?:지정\s*불가|미정)/u.test(text)) blockers.add('CUSTOMER_TEXT_RAW_DIRECTIVE');
    if (/^(?:조|중|석)\s*:/u.test(text)) blockers.add('CUSTOMER_TEXT_RAW_MEAL_MARKER');
    if (/(?:가이드\s*미팅\s*후|이동\s*후|식사\s*후)$/u.test(text)) blockers.add('CUSTOMER_TEXT_INCOMPLETE_FRAGMENT');
    if (/[→⇒]{2,}|(?:^|\s)=>?(?:\s|$)/u.test(text)) blockers.add('CUSTOMER_TEXT_CONTROL_ARROW');
  }
  return [...blockers];
}

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

export function productRegistrationProofSuiteVersion(
  chromeProof: Awaited<ReturnType<typeof runProductRegistrationV6ChromeProof>>,
): string {
  const evidence = chromeProof.surfaces.map(surface => ({
    surface: surface.surface,
    status: surface.status,
    snapshotHash: surface.snapshotHash,
    rendererBuildId: surface.rendererBuildId,
    screenshotHash: surface.screenshotHash,
    bodyTextHash: surface.bodyTextHash,
    ctaOpened: surface.ctaOpened,
    failures: surface.failures,
    missingRequiredText: surface.missingRequiredText,
    forbiddenTextFound: surface.forbiddenTextFound,
    hydrationErrors: surface.hydrationErrors,
  }));
  const resultHash = createHash('sha256').update(JSON.stringify({ status: chromeProof.status, evidence })).digest('hex');
  return `product-registration-v6-mobile-chrome-3+result.${resultHash.slice(0, 24)}`;
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
  revisionContentHash: string;
  customerSnapshotHash: string;
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
  const packageNotices = Array.isArray(pkg.notices_parsed)
    ? pkg.notices_parsed.filter((item): item is JsonObject => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
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
    ...packageNotices.filter(notice => notice.template_key === 'schedule_and_lodging_confirmation').map(notice => notice.text),
    ...packageNotices.filter(notice => notice.type === 'SOURCE_TICKETING_CONDITION').map(notice => notice.text),
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

const DEGRADED_SCHEDULE_LODGING_NOTICE = '항공 운항 시각과 미정 숙소는 상담 시 최종 확인해 드립니다.';

export function degradedPackageCopy(pkg: JsonObject, decision: ProductRegistrationV6Decision): JsonObject {
  if (decision.outcome !== 'degraded') return pkg;
  const ticketingReconfirmation = decision.degradedReasons.some(reason => reason.includes('TICKETING_'));
  const scheduleOrLodgingReconfirmation = decision.degradedReasons.some(reason =>
    /FLIGHT_|HOTEL|LODGING|숙소|항공/i.test(reason));
  const commercialTermsReconfirmation = decision.degradedReasons.some(reason =>
    /\.inclusions\b|\.exclusions\b|포함사항|불포함사항|GUIDE_TIP_SCOPE|OPTION_SCOPE|SHOPPING_SCOPE|가이드|기사|노옵션|노쇼핑|선택관광/i.test(reason));
  const notices = [
    ...(ticketingReconfirmation
      ? ['발권기한 경과 또는 출발일별 조건 차이로 현재 좌석과 요금은 상담 시 최종 확인해 드립니다.']
      : []),
    ...(scheduleOrLodgingReconfirmation ? [DEGRADED_SCHEDULE_LODGING_NOTICE] : []),
    ...(commercialTermsReconfirmation
      ? ['가이드비·노옵션·노쇼핑·선택관광 조건은 상품별 적용 범위가 달라 상담 시 최종 확인해 드립니다.']
      : []),
  ];
  if (notices.length === 0) notices.push('일부 정보는 상담 시 최종 확인해 드립니다.');
  const notice = notices.join('\n');
  const existingNotes = typeof pkg.customer_notes === 'string' ? pkg.customer_notes.trim() : '';
  const existingHighlights = Array.isArray(pkg.product_highlights)
    ? pkg.product_highlights.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  return {
    ...pkg,
    customer_notes: existingNotes ? `${existingNotes}\n${notice}` : notice,
    product_highlights: [...new Set([...existingHighlights, ...notices])],
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
    if (matchingFacts.length === 0) {
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
        v6_fact_state: 'degraded',
        v6_schedule_notice: '운항일 기준 상담 시 최종 확인',
      };
    }

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
  const unsafeServiceNumbers = new Set(segments
    .filter(segment => segment && typeof segment === 'object' && !Array.isArray(segment)
      && ['degraded', 'conflicting'].includes(String((segment as JsonObject).v6_fact_state ?? '')))
    .map(segment => String((segment as JsonObject).flight_no ?? (segment as JsonObject).code ?? '')
      .replace(/\s+/g, '').toUpperCase())
    .filter(Boolean));
  const days = Array.isArray(itinerary.days)
    ? itinerary.days.map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
        const day = value as JsonObject;
        if (!Array.isArray(day.schedule)) return day;
        const schedule = day.schedule.map(rawItem => {
          if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return rawItem;
          const item = rawItem as JsonObject;
          const serviceNumber = String(item.transport ?? item.flight_no ?? item.code ?? '')
            .replace(/\s+/g, '').toUpperCase();
          if (!unsafeServiceNumbers.has(serviceNumber)) return item;
          const scrubText = (value: unknown): unknown => {
            if (typeof value !== 'string') return value;
            return value
              .replace(/\([^)]*\b\d{1,2}:\d{2}\b[^)]*\)/g, '(운항일 기준 상담 시 최종 확인)')
              .replace(/\b\d{1,2}:\d{2}\b/g, '')
              .replace(/\s+/g, ' ')
              .trim();
          };
          const {
            time: _time,
            dep_time: _departureTime,
            arr_time: _arrivalTime,
            departure_local_time: _departureLocalTime,
            arrival_local_time: _arrivalLocalTime,
            ...safeItem
          } = item;
          return {
            ...safeItem,
            activity: scrubText(item.activity),
            note: scrubText(item.note),
            a4_sentence: scrubText(item.a4_sentence),
            landing_sentence: scrubText(item.landing_sentence),
            v6_schedule_notice: '운항일 기준 상담 시 최종 확인',
          };
        });
        return { ...day, schedule };
      })
    : itinerary.days;
  return { ...pkg, itinerary_data: { ...itinerary, flight_segments: segments, ...(days ? { days } : {}) } };
}

function isGenericUnconfirmedLodgingName(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^(?:해당\s*(?:숙소|호텔)|숙소\s*미정|호텔\s*미정|미정|추후\s*확정)$/i.test(value.trim());
}

export function applySafeLodgingCopy(pkg: JsonObject, lodgingStays: JsonObject[]): JsonObject {
  const itinerary = pkg.itinerary_data && typeof pkg.itinerary_data === 'object' && !Array.isArray(pkg.itinerary_data)
    ? { ...(pkg.itinerary_data as JsonObject) }
    : null;
  if (!itinerary || !Array.isArray(itinerary.days)) return pkg;
  const unsafeDays = new Set(lodgingStays
    .filter(row => ['to_be_confirmed', 'equivalent'].includes(String(row.lodging_state ?? '')))
    .map(row => Number(row.day_index))
    .filter(Number.isFinite));
  if (unsafeDays.size === 0) return pkg;
  const days = itinerary.days.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const day = value as JsonObject;
    const dayIndex = Number(day.day ?? index + 1);
    const publicRegions = Array.isArray(day.regions)
      ? day.regions.filter(region => typeof region !== 'string' || !/^HOTEL\s*:\s*해당\s*숙소$/i.test(region.trim()))
      : day.regions;
    if (!unsafeDays.has(dayIndex)) return publicRegions === day.regions ? day : { ...day, regions: publicRegions };
    const hotel = day.hotel;
    if (!hotel || typeof hotel !== 'object' || Array.isArray(hotel)) {
      return publicRegions === day.regions ? day : { ...day, regions: publicRegions };
    }
    const hotelRow = hotel as JsonObject;
    const rawName = hotelRow.name ?? hotelRow.raw_text;
    if (!isGenericUnconfirmedLodgingName(rawName)) {
      return publicRegions === day.regions ? day : { ...day, regions: publicRegions };
    }
    return {
      ...day,
      ...(publicRegions ? { regions: publicRegions } : {}),
      hotel: {
        ...hotelRow,
        name: '숙소 미정 · 상담 시 최종 확인',
        raw_text: '숙소 미정 · 상담 시 최종 확인',
        note: '원문에서 숙소가 확정되지 않아 상담 시 최종 안내합니다.',
      },
    };
  });
  return { ...pkg, itinerary_data: { ...itinerary, days } };
}

export async function buildProductRegistrationV6CandidateSnapshots(input: {
  supabase: SupabaseClient;
  decision: ProductRegistrationV6Decision;
  compatibilityBindings: Array<{
    catalogProductId: string;
    packageId: string;
    projectionHash: string;
    operationalIdentity?: JsonObject;
  }>;
  resolvedTransport?: ResolvedTransportForSnapshot[];
}): Promise<ProductRegistrationV6CandidateSnapshot[]> {
  const bindingByCatalogProduct = new Map(input.compatibilityBindings.map(binding => [binding.catalogProductId, binding]));
  const pairs = input.decision.packageIds.map((catalogProductId, index) => ({
    catalogProductId,
    binding: bindingByCatalogProduct.get(catalogProductId),
    revisionId: input.decision.revisionIds[index] ?? input.decision.revisionIds[0],
  })).filter((pair): pair is {
    catalogProductId: string;
    binding: { catalogProductId: string; packageId: string; projectionHash: string; operationalIdentity?: JsonObject };
    revisionId: string;
  } => Boolean(pair.catalogProductId && pair.binding?.packageId && pair.revisionId));
  if (pairs.length !== input.decision.packageIds.length) {
    throw new Error('V6_SNAPSHOT_COMPATIBILITY_BINDING_MISSING');
  }
  const results: ProductRegistrationV6CandidateSnapshot[] = [];
  for (const pair of pairs) {
    const aggregate = await loadProductRegistrationRevisionAggregate({
      supabase: input.supabase,
      revisionId: pair.revisionId,
    });
    const revision = aggregate.revision;
    if (revision.catalog_product_id !== pair.catalogProductId) {
      throw new Error('V6_SNAPSHOT_CATALOG_IDENTITY_MISMATCH');
    }
    const tenantId = revision.tenant_id;

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
      packageId: pair.binding.packageId,
      aggregate,
      operationalIdentity: pair.binding.operationalIdentity,
    });
    const source = degradedPackageCopy(
      applySafeLodgingCopy(applyResolvedTransport({
        ...revisionPackage,
        title: copy.title ?? revisionPackage.title,
        product_summary: copy.summary ?? revisionPackage.product_summary,
        product_highlights: copy.highlights ?? revisionPackage.product_highlights,
        product_registration_copy: copy,
        terms_snapshot: input.decision.termsPolicies?.find(policy => policy.revisionId === pair.revisionId),
      }, pair.catalogProductId, input.resolvedTransport ?? []), aggregate.lodgingStays),
      input.decision,
    );
    if (!source.terms_snapshot) throw new Error('V6_TERMS_POLICY_SNAPSHOT_MISSING');
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot({
      ...source,
      canonical_revision_id: pair.revisionId,
      canonical_payload_hash: revision.payload_hash,
      package_revision: revision.revision_no,
    });
    const hygieneBlockers = customerSnapshotHygieneBlockers(snapshot);
    if (hygieneBlockers.length > 0) {
      throw new Error(`V61_CUSTOMER_SNAPSHOT_HYGIENE_FAILED:${hygieneBlockers.join(',')}`);
    }
    const rendererBuildId = currentProductRegistrationRendererBuildId();
    const row = {
      tenant_id: tenantId,
      package_id: pair.binding.packageId,
      catalog_product_id: pair.catalogProductId,
      package_revision: Number(revision.revision_no),
      canonical_revision_id: pair.revisionId,
      snapshot_hash: snapshotHash,
      revision_content_hash: revision.payload_hash,
      customer_snapshot_hash: snapshotHash,
      publication_policy_version: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
      customer_wording_rules_version: PRODUCT_REGISTRATION_V6_WORDING_RULES_VERSION,
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
    for (const [surfaceName, projection] of [
      ['package_listing_card', snapshot.card_projection],
      ['a4_artifact', {
        package: snapshot.package,
        canonicalView: snapshot.canonical_view,
        artifactContract: 'canonical-a4-component-projection-v61',
      }],
    ] as const) {
      const surfaceRenderHash = createHash('sha256').update(stableSurfaceJson({
        customerSnapshotHash: snapshotHash,
        rendererBuildId,
        policyVersion: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
        wordingRulesVersion: PRODUCT_REGISTRATION_V6_WORDING_RULES_VERSION,
        surfaceName,
        projection,
      })).digest('hex');
      const { error: surfaceError } = await input.supabase.rpc(
        'record_product_registration_surface_render',
        { p_payload: {
          snapshot_id: snapshotId,
          revision_content_hash: revision.payload_hash,
          customer_snapshot_hash: snapshotHash,
          renderer_build_id: rendererBuildId,
          publication_policy_version: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
          customer_wording_rules_version: PRODUCT_REGISTRATION_V6_WORDING_RULES_VERSION,
          surface_name: surfaceName,
          artifact_kind: 'component_projection',
          surface_render_hash: surfaceRenderHash,
        } },
      );
      if (surfaceError) throw surfaceError;
    }
    const { error: projectionLinkError } = await input.supabase.rpc(
      'link_product_registration_projection_snapshot_atomic',
      { p_payload: {
        revision_id: pair.revisionId,
        snapshot_id: snapshotId,
        projection_hash: pair.binding.projectionHash,
      } },
    );
    if (projectionLinkError) throw projectionLinkError;
    results.push({
      tenantId,
      catalogProductId: pair.catalogProductId,
      packageId: pair.binding.packageId,
      revisionId: pair.revisionId,
      snapshotId,
      snapshotHash,
      revisionContentHash: revision.payload_hash,
      customerSnapshotHash: snapshotHash,
      rendererBuildId,
      proofAssertions: customerProofAssertions({
        snapshot: snapshot as unknown as JsonObject,
        packageId: pair.catalogProductId,
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
  const surfaceArtifacts: Array<{ surfaceRenderId: string; surfaceRenderHash: string }> = [];
  for (const surface of persistedChromeProof.surfaces) {
    if (!surface.bodyTextHash || !surface.screenshotHash) continue;
    const surfaceName = surface.surface === 'packages' ? 'package_detail' : 'landing_page';
    const surfaceRenderHash = createHash('sha256').update(JSON.stringify({
      customerSnapshotHash: input.snapshot.customerSnapshotHash,
      rendererBuildId: input.snapshot.rendererBuildId,
      publicationPolicyVersion: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
      wordingRulesVersion: PRODUCT_REGISTRATION_V6_WORDING_RULES_VERSION,
      surfaceName,
      normalizedDomTextHash: surface.bodyTextHash,
      screenshotHash: surface.screenshotHash,
    })).digest('hex');
    const { data: artifact, error: artifactError } = await input.supabase.rpc(
      'record_product_registration_surface_render',
      { p_payload: {
        snapshot_id: input.snapshot.snapshotId,
        revision_content_hash: input.snapshot.revisionContentHash,
        customer_snapshot_hash: input.snapshot.customerSnapshotHash,
        renderer_build_id: input.snapshot.rendererBuildId,
        publication_policy_version: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
        customer_wording_rules_version: PRODUCT_REGISTRATION_V6_WORDING_RULES_VERSION,
        surface_name: surfaceName,
        artifact_kind: 'normalized_dom_text',
        surface_render_hash: surfaceRenderHash,
        normalized_dom_text_hash: surface.bodyTextHash,
        artifact_bytes_hash: surface.screenshotHash,
        artifact_uri: surface.screenshotStorage?.path ?? null,
      } },
    );
    if (artifactError || !artifact || typeof artifact !== 'object') {
      throw artifactError ?? new Error('V61_SURFACE_RENDER_PERSIST_FAILED');
    }
    const surfaceRenderId = String((artifact as JsonObject).surface_render_id ?? '');
    if (!surfaceRenderId) throw new Error('V61_SURFACE_RENDER_ID_MISSING');
    surfaceArtifacts.push({ surfaceRenderId, surfaceRenderHash });
  }
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
      // Failed and successful attempts for the same immutable snapshot are
      // distinct immutable proof evidence. Fingerprinting the browser result
      // avoids reusing an earlier failed row after a transient retry succeeds.
      proofSuiteVersion: productRegistrationProofSuiteVersion(chromeProof),
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
        surfaceRenderHashes: surfaceArtifacts.map(item => item.surfaceRenderHash),
      },
      checkedAt: new Date().toISOString(),
    },
  });
  for (const artifact of surfaceArtifacts) {
    const { error: linkError } = await input.supabase.rpc(
      'link_product_registration_browser_proof_surface',
      { p_payload: { proof_id: persisted.proofRunId, surface_render_id: artifact.surfaceRenderId } },
    );
    if (linkError) throw linkError;
  }
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
  releaseAuthorizationId?: string | null;
  channel?: 'customer' | 'b2b' | 'partner';
  locale?: string;
}): Promise<Record<string, unknown>> {
  const channel = input.channel ?? 'customer';
  const locale = input.locale ?? 'ko-KR';
  const { data: pointer, error: pointerError } = await input.supabase
    .from('product_registration_v5_publication_pointers')
    .select('pointer_version')
    .eq('tenant_id', input.snapshot.tenantId)
    .eq('catalog_product_id', input.snapshot.catalogProductId)
    .eq('package_id', input.snapshot.packageId)
    .eq('channel', channel)
    .eq('locale', locale)
    .maybeSingle();
  if (pointerError) throw formatSupabaseError('REGISTRATION_PUBLICATION_POINTER_LOOKUP_FAILED', pointerError);
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
      release_authorization_id: input.releaseAuthorizationId ?? null,
      channel,
      locale,
    },
  });
  if (error) throw formatSupabaseError('REGISTRATION_PUBLICATION_RPC_FAILED', error);
  return data as Record<string, unknown>;
}
