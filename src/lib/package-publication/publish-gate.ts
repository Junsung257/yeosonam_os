import type { CustomerMobileProofResult } from '@/lib/customer-mobile-proof';
import { customerCopyQualityIssues } from '@/lib/customer-copy-quality';
import { isSafeImageSrc } from '@/lib/image-url';
import type { PublishGateResult as LegacyPublishGateResult } from '@/lib/product-publish-gate';
import { hasRiskyCustomerCopy, isOptionalTourFragment } from './public-snapshot';
import type { PublicationState, PublishFinding } from './types';
import { unsupportedTitleClaims } from './title-claim-registry';

type AnyRecord = Record<string, unknown>;
type CustomerClaimSurface = {
  label: string;
  fieldPath: string;
  text: string;
};

export type PublicSnapshotGateInput = {
  pkg: AnyRecord;
  sourcePkg?: AnyRecord;
  legacyPublishGate?: LegacyPublishGateResult | null;
  mobileProof?: CustomerMobileProofResult | null;
  customerOpenContractOk?: boolean | null;
  customerOpenContractBlockers?: string[];
  publicSnapshotHash?: string | null;
  expectedPublicSnapshotHash?: string | null;
  expectedProofInputHash?: string | null;
  publicSnapshotTitle?: string | null;
  snapshotExists?: boolean;
  routeTextDump?: string[];
  auditQueryFailed?: string | null;
  invalidAttractionIds?: string[];
  publicNoticeSourcePaths?: string[];
  activeUnresolvedPollutionCount?: number;
  missingRequiredEvidenceFields?: string[];
};

export type PublicSnapshotGateResult = {
  publication_state: PublicationState;
  publishable: boolean;
  hard_blockers: PublishFinding[];
  soft_warnings: PublishFinding[];
  required_actions: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_TITLE_DURATION_RE = /\d+\s*박\s*\d+\s*일|\d+\s*일/;
const INTERNAL_ENGLISH_RE = /\bDecision\s*guide\b|\boperator\b|\binternal\b|\bpublish_gate\b/i;
const RAW_OPERATIONAL_POLLUTION_RE =
  /환불\s*(?:불가|안내|규정)|취소\s*수수료.{0,12}100%|100%\s*차지|예약금\s*입금.{0,18}(?:좌석|예약|자동\s*취소|확정)|항공\s*요금.{0,12}입금|좌석.{0,12}(?:확정|확보|보장)|발권\s*마감|Decision\s*guide/i;
const RAW_CUSTOMER_COPY_ROOTS = [
  'itinerary_data',
  'marketing_copies',
  'customer_notes',
  'hero_tagline',
  'product_summary',
  'product_highlights',
] as const;
const BLOCKING_CUSTOMER_COPY_CODES = new Set([
  'placeholder_or_mojibake',
  'internal_source_copy',
  'customer_forbidden_internal_terms',
]);

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function compactText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function addBlocker(blockers: PublishFinding[], code: string, message: string, fieldPath?: string) {
  blockers.push({ code, message, fieldPath, severity: 'critical' });
}

function walk(value: unknown, visit: (value: unknown, path: string) => void, path = '') {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visit, `${path}.${index}`.replace(/^\./, '')));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, item] of Object.entries(record)) {
    if (key === 'raw_text' || key === 'audit_report') continue;
    walk(item, visit, `${path}.${key}`.replace(/^\./, ''));
  }
}

function findBrokenAttractionId(pkg: AnyRecord): string | null {
  let broken: string | null = null;
  walk(pkg.itinerary_data, (value, path) => {
    if (broken || !path.endsWith('attraction_ids')) return;
    if (!Array.isArray(value)) return;
    const bad = value.find(item => typeof item !== 'string' || !UUID_RE.test(item));
    if (bad !== undefined) broken = `${path}: ${String(bad)}`;
  });
  return broken;
}

function hasOptionalTourPollution(pkg: AnyRecord): boolean {
  const tours = Array.isArray(pkg.optional_tours) ? pkg.optional_tours : [];
  return tours.some(isOptionalTourFragment);
}

function coveredPublicNoticeSourcePaths(input: PublicSnapshotGateInput): Set<string> {
  return new Set([
    ...(input.publicNoticeSourcePaths ?? []),
    ...(Array.isArray(input.pkg._public_notice_source_paths)
      ? input.pkg._public_notice_source_paths.map(item => String(item ?? ''))
      : []),
  ].filter(Boolean));
}

function findMaskedCustomerCopyPollution(
  pkg: AnyRecord,
  coveredSourcePaths = new Set<string>(),
): { path: string; text: string; risky: boolean } | null {
  let pollution: { path: string; text: string; risky: boolean } | null = null;

  for (const root of RAW_CUSTOMER_COPY_ROOTS) {
    if (pollution) break;
    walk(pkg[root], (value, path) => {
      if (pollution || typeof value !== 'string') return;
      const text = value.replace(/\s+/g, ' ').trim();
      if (!text) return;
      const qualityIssue = customerCopyQualityIssues(text)
        .find(issue => BLOCKING_CUSTOMER_COPY_CODES.has(issue.code));
      const risky = hasRiskyCustomerCopy(text) || RAW_OPERATIONAL_POLLUTION_RE.test(text);
      if (qualityIssue || risky) {
        const fullPath = `${root}${path ? `.${path}` : ''}`;
        if (coveredSourcePaths.has(fullPath)) return;
        pollution = {
          path: fullPath,
          text,
          risky,
        };
      }
    });
  }

  return pollution;
}

function formatPriceEvidenceToken(price: number): string {
  return price.toLocaleString('ko-KR');
}

function hasValidSourceBackedPriceTier(pkg: AnyRecord): boolean {
  const tiers = Array.isArray(pkg.price_tiers) ? pkg.price_tiers : [];
  if (tiers.length === 0) return false;

  const sourcePkg = asRecord(pkg._source_price_evidence) ?? pkg;
  const rawText = compactText(sourcePkg.raw_text ?? pkg.raw_text);
  const departureDays = compactText(sourcePkg.departure_days ?? pkg.departure_days);
  const sourceText = `${rawText}\n${departureDays}`;
  if (!rawText) return false;

  return tiers.some((item) => {
    const tier = asRecord(item);
    if (!tier) return false;
    const price = asNumber(tier.adult_price ?? tier.adult_selling_price ?? tier.price);
    if (!price || price <= 0) return false;

    const departureDates = Array.isArray(tier.departure_dates)
      ? tier.departure_dates.filter(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
      : [];
    if (departureDates.length > 0) return true;

    const periodLabel = compactText(tier.period_label);
    const priceToken = formatPriceEvidenceToken(price);
    const rawHasPrice = sourceText.includes(priceToken) || sourceText.includes(String(price));
    if (!rawHasPrice) return false;

    const rawHasPeriodBasis = /전\s*출발일|출발\s*요일|매주|요일|기본/i.test(sourceText)
      || (periodLabel.length > 1 && periodLabel !== '기본' && sourceText.includes(periodLabel));
    const tierHasBasis = periodLabel.length > 0 || departureDays.length > 0 || compactText(tier.departure_day_of_week).length > 0;
    return rawHasPeriodBasis && tierHasBasis;
  });
}

function sourceBackedPriceProblem(pkg: AnyRecord): string | null {
  const priceDates = Array.isArray(pkg.price_dates) ? pkg.price_dates : [];
  if (priceDates.length === 0) {
    if (hasValidSourceBackedPriceTier(pkg)) return null;
    return 'public package snapshot requires source-backed price_dates or source-backed period price_tiers before customer opening';
  }

  for (const [index, value] of priceDates.entries()) {
    const row = asRecord(value);
    const date = String(row?.date ?? '');
    const price = asNumber(row?.adult_selling_price ?? row?.price ?? row?.selling_price);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return `price_dates.${index} has no valid departure date`;
    }
    if (!price || price <= 0) {
      return `price_dates.${index} has no valid customer price`;
    }
  }

  return null;
}

function hasPublicImageCandidate(pkg: AnyRecord): boolean {
  const images = Array.isArray(pkg.images_public) ? pkg.images_public : [];
  for (const item of images) {
    if (isSafeImageSrc(item)) return true;
    const image = asRecord(item);
    if (isSafeImageSrc(image?.url ?? image?.src_large ?? image?.src_medium)) return true;
  }

  if (isSafeImageSrc(pkg.hero_image_url) || isSafeImageSrc(pkg.lp_hero_image_url)) return true;
  const thumbnails = Array.isArray(pkg.thumbnail_urls) ? pkg.thumbnail_urls : [];
  return thumbnails.some(isSafeImageSrc);
}

function hasInternalEnglishCopy(input: PublicSnapshotGateInput): string | null {
  const texts = [
    ...(input.routeTextDump ?? []),
    input.pkg.title,
    input.pkg.display_title,
    input.pkg.product_summary,
  ].map(value => String(value ?? ''));
  return texts.find(text => INTERNAL_ENGLISH_RE.test(text)) ?? null;
}

function findBlockingCustomerCopy(input: PublicSnapshotGateInput): { code: string; text: string } | null {
  const texts = [
    ...(input.routeTextDump ?? []),
    input.pkg.title,
    input.pkg.display_title,
    input.pkg.hero_tagline,
    input.pkg.product_summary,
    ...(Array.isArray(input.pkg.product_highlights) ? input.pkg.product_highlights : []),
    ...(Array.isArray(input.pkg.inclusions) ? input.pkg.inclusions : []),
    ...(Array.isArray(input.pkg.excludes) ? input.pkg.excludes : []),
    ...(Array.isArray(input.pkg.customer_notes) ? input.pkg.customer_notes : []),
  ].map(value => String(value ?? '')).filter(Boolean);

  for (const text of texts) {
    const issue = customerCopyQualityIssues(text).find(item => BLOCKING_CUSTOMER_COPY_CODES.has(item.code));
    if (issue) return { code: issue.code, text };
  }
  return null;
}

function unsupportedClaimInSurface(surface: CustomerClaimSurface, sourceText: string): string | null {
  const text = surface.text;
  if (!text) return null;
  const hasOnsen = /온천/.test(text);
  const onsenEvidenceCount = (sourceText.match(/온천/g) ?? []).length;
  const strongOnsenEvidence = onsenEvidenceCount >= 2
    && (/(?:온천\s*1박|온천욕)/.test(sourceText)
      || /온천\s*(?:호텔|료칸|숙박|마을|지구|테마|리조트|여행|관광)/.test(sourceText));
  if (hasOnsen && !strongOnsenEvidence) {
    return `${surface.label} claims onsen as a theme without strong source evidence`;
  }
  const hasHotelGrade = /(?:준\s*5성|특\s*5성|5성|오성|특급\s*호텔|특급호텔)/.test(text);
  const hotelGradeEvidence =
    /(?:호텔|리조트|숙박|동급).{0,16}(?:준\s*5성|특\s*5성|5성|오성)|(?:준\s*5성|특\s*5성|5성|오성).{0,16}(?:호텔|리조트|숙박|동급|월드체인)|특급\s*호텔|특급호텔/.test(sourceText);
  if (hasHotelGrade && !hotelGradeEvidence) {
    return `${surface.label} claims 5-star or premium hotel grade without hotel-grade evidence`;
  }
  if (/출발\s*확정|출발확정/.test(text)) {
    return `${surface.label} contains risky departure-confirmed claim`;
  }
  return null;
}
function customerClaimSurfaces(input: PublicSnapshotGateInput): CustomerClaimSurface[] {
  const pkg = input.pkg;
  const card = asRecord(pkg._card_projection);
  const lp = asRecord(pkg._lp_projection);
  const badgeSurfaces = [
    ...(Array.isArray(card?.badges)
      ? card.badges.map((badge, index) => ({
        label: 'card badge',
        fieldPath: `_card_projection.badges.${index}`,
        text: String(badge ?? ''),
      }))
      : []),
    ...(Array.isArray(lp?.badges)
      ? lp.badges.map((badge, index) => ({
        label: 'LP badge',
        fieldPath: `_lp_projection.badges.${index}`,
        text: String(badge ?? ''),
      }))
      : []),
    ...(Array.isArray(pkg.badges)
      ? pkg.badges.map((badge, index) => ({
        label: 'badge',
        fieldPath: `badges.${index}`,
        text: String(badge ?? ''),
      }))
      : []),
  ];

  return [
    { label: 'title', fieldPath: 'title', text: String(pkg.display_title || pkg.title || '') },
    { label: 'subtitle', fieldPath: 'hero_tagline', text: String(pkg.hero_tagline || '') },
    { label: 'summary', fieldPath: 'product_summary', text: String(pkg.product_summary || '') },
    { label: 'card title', fieldPath: '_card_projection.title', text: String(card?.title || '') },
    { label: 'card summary', fieldPath: '_card_projection.summary', text: String(card?.summary || '') },
    { label: 'LP title', fieldPath: '_lp_projection.title', text: String(lp?.title || '') },
    { label: 'LP summary', fieldPath: '_lp_projection.summary', text: String(lp?.summary || '') },
    ...badgeSurfaces,
  ].filter(surface => surface.text.trim());
}

function findUnsupportedCustomerClaim(input: PublicSnapshotGateInput): { message: string; fieldPath: string } | null {
  const pkg = input.sourcePkg ?? input.pkg;
  const raw = String(pkg.raw_text || '');
  const itinerary = JSON.stringify(pkg.itinerary_data ?? {});
  const sourceText = [
    pkg.destination,
    pkg.title,
    pkg.display_title,
    raw,
    pkg.product_summary,
    ...(Array.isArray(pkg.product_highlights) ? pkg.product_highlights : []),
    ...(Array.isArray(pkg.inclusions) ? pkg.inclusions : []),
    itinerary,
  ].map(value => String(value ?? '')).join(' ');

  const itineraryRecord = asRecord(pkg.itinerary_data);
  const days = Array.isArray(itineraryRecord?.days) ? itineraryRecord.days : [];
  const attractionTokens = JSON.stringify(pkg.itinerary_data ?? {}).match(/attraction_(?:id|name)s?/g) ?? [];
  const hasPaidOptionalTour = (Array.isArray(pkg.optional_tours) ? pkg.optional_tours : []).some(item => {
    const record = asRecord(item);
    const itemText = String(record?.name ?? record?.title ?? item ?? '');
    return Number(record?.price ?? record?.amount) > 0 || /(?:USD|KRW|달러|원|현지\s*별도\s*문의)/i.test(itemText);
  });
  const publicTitle = String(input.publicSnapshotTitle ?? input.pkg.display_title ?? input.pkg.title ?? '');
  const [unsupportedRegisteredClaim] = unsupportedTitleClaims(publicTitle, {
    sourceText,
    itineraryDayCount: days.length,
    attractionCount: attractionTokens.length,
    hasPaidOptionalTour,
  });
  if (unsupportedRegisteredClaim) {
    return {
      message: `title claim ${unsupportedRegisteredClaim.code} has no required source evidence`,
      fieldPath: 'title',
    };
  }

  for (const surface of customerClaimSurfaces(input)) {
    const message = unsupportedClaimInSurface(surface, sourceText);
    if (message) return { message, fieldPath: surface.fieldPath };
  }
  return null;
}

function legacyGateBlockers(input: PublicSnapshotGateInput): PublishFinding[] {
  const result: PublishFinding[] = [];
  const gate = input.legacyPublishGate;
  if (!gate) return result;
  if (gate.decision === 'block') {
    for (const reason of gate.reasons) {
      result.push({
        code: 'unsupported_customer_claim',
        message: reason,
        severity: 'critical',
      });
    }
  }
  return result;
}

function addMobileProofBlockers(input: PublicSnapshotGateInput, hard: PublishFinding[]): void {
  if (!input.mobileProof) {
    addBlocker(hard, 'stale_mobile_proof', 'actual /packages and /lp mobile browser proof is missing');
    return;
  }

  if (!input.mobileProof.ok) {
    addBlocker(hard, 'stale_mobile_proof', input.mobileProof.reason);
    return;
  }

  const expectedSnapshotHash = input.expectedPublicSnapshotHash?.trim() || input.publicSnapshotHash?.trim();
  if (!expectedSnapshotHash) return;

  const proof = input.mobileProof.proof;
  if (!proof?.public_snapshot_hash) {
    addBlocker(hard, 'public_snapshot_hash_mismatch', 'mobile proof is not bound to the public package snapshot hash');
    return;
  }

  if (proof.public_snapshot_hash !== expectedSnapshotHash) {
    addBlocker(hard, 'public_snapshot_hash_mismatch', 'mobile proof hash does not match the public package snapshot hash');
  }

  const expectedProofInputHash = input.expectedProofInputHash?.trim();
  if (expectedProofInputHash) {
    if (!proof.proof_input_hash) {
      addBlocker(hard, 'stale_mobile_proof', 'mobile proof input hash is missing');
    } else if (proof.proof_input_hash !== expectedProofInputHash) {
      addBlocker(hard, 'stale_mobile_proof', 'mobile proof is stale for the current content, render contract, assets, or route configuration');
    }
  }

  for (const surfaceResult of proof.surface_results ?? []) {
    if (!surfaceResult.public_snapshot_hash) {
      addBlocker(
        hard,
        'public_snapshot_hash_mismatch',
        `mobile proof ${surfaceResult.surface ?? 'surface'} result is not bound to the public package snapshot hash`,
      );
      continue;
    }
    if (surfaceResult.public_snapshot_hash !== expectedSnapshotHash) {
      addBlocker(
        hard,
        'public_snapshot_hash_mismatch',
        `mobile proof ${surfaceResult.surface ?? 'surface'} hash does not match the public package snapshot hash`,
      );
    }
  }
}

function requiredActionsForBlockers(blockers: PublishFinding[]): string[] {
  const actions: string[] = [];
  const add = (action: string) => {
    if (!actions.includes(action)) actions.push(action);
  };

  for (const blocker of blockers) {
    switch (blocker.code) {
      case 'price_source_missing':
      case 'price_fragment_display':
        add('원문 가격표에서 출발일·성인 판매가·1인 기준을 source-backed 값으로 다시 추출해 price_dates/product_prices를 재생성하세요.');
        break;
      case 'optional_tour_display_pollution':
      case 'masked_data_pollution':
      case 'inclusion_optional_mixup':
        add('선택관광·포함·불포함 섹션을 다시 분리하고 노옵션·가격표·헤더 조각은 quarantine한 뒤 public optional/terms 필드를 재생성하세요.');
        break;
      case 'unsupported_title_claim':
      case 'public_title_missing':
        add('목적지, 검증된 유리한 조건, 핵심 여행 성격, 기간만 사용해 public_title을 정책 기반으로 재생성하세요.');
        break;
      case 'unsupported_customer_claim':
      case 'risky_reservation_claim':
      case 'english_internal_copy':
      case 'placeholder_or_mojibake':
      case 'customer_forbidden_internal_terms':
      case 'internal_source_copy':
        add('CTA, 설명, 배지, route_text_dump를 승인된 고객용 템플릿으로 다시 만들고 확정·보장·내부·placeholder 문구를 제거하세요.');
        break;
      case 'broken_attraction_id':
        add('깨진 attraction_id를 quarantine하고 원문 관광지명을 기존 attractions DB에 재매칭하세요. 불확실하면 고객 이미지/설명에 연결하지 마세요.');
        break;
      case 'public_image_missing':
        add('상품 대표 관광지, 목적지 metadata, 상품 썸네일 중 실제 포함 경험을 암시하지 않는 승인 이미지를 연결하세요.');
        break;
      case 'itinerary_duration_mismatch':
        add('원문 일정 섹션을 DAY 단위로 재분리하고 상품 기간과 일정 일수를 맞춰 itinerary_public을 재생성하세요.');
        break;
      case 'audit_query_failed':
        add('감사 쿼리 실패 원인을 먼저 복구하세요. 감사가 실패하면 public snapshot은 fail-closed 상태를 유지합니다.');
        break;
      case 'stale_audit':
      case 'stale_mobile_proof':
      case 'public_snapshot_hash_mismatch':
      case 'public_snapshot_missing':
        add('public_package_snapshot을 다시 저장하고 현재 package_revision/snapshot_hash 기준으로 /packages와 /lp 모바일 proof를 재생성하세요.');
        break;
      default:
        add(`${blocker.code} 원인을 source evidence 기준으로 복구한 뒤 public snapshot을 재생성하세요.`);
        break;
    }
  }

  if (actions.length > 0) add('수정 후 publish gate를 다시 실행하세요.');
  return actions;
}
export function evaluatePublicSnapshotPublishGate(input: PublicSnapshotGateInput): PublicSnapshotGateResult {
  const hard: PublishFinding[] = [];
  const soft: PublishFinding[] = [];
  const sourcePkg = input.sourcePkg ?? input.pkg;

  if (input.auditQueryFailed) {
    addBlocker(hard, 'audit_query_failed', input.auditQueryFailed);
  }

  if ((input.activeUnresolvedPollutionCount ?? 0) > 0) {
    addBlocker(
      hard,
      'masked_data_pollution',
      `${input.activeUnresolvedPollutionCount} active unresolved quarantined field candidate(s) remain`,
    );
  }

  for (const fieldPath of input.missingRequiredEvidenceFields ?? []) {
    addBlocker(
      hard,
      'required_field_evidence_missing',
      `customer-visible field has no validated source or approved derivation evidence: ${fieldPath}`,
      fieldPath,
    );
  }

  if (input.customerOpenContractOk !== true) {
    for (const blocker of input.customerOpenContractBlockers ?? ['customer_open_contract missing or blocked']) {
      addBlocker(hard, 'unsupported_customer_claim', blocker);
    }
  }

  addMobileProofBlockers(input, hard);

  if (input.snapshotExists === false) {
    addBlocker(hard, 'public_snapshot_missing', 'approved public package snapshot is missing');
  }

  const priceDateProblem = sourceBackedPriceProblem({
    ...input.pkg,
    _source_price_evidence: sourcePkg,
  });
  if (priceDateProblem) {
    addBlocker(hard, 'price_source_missing', priceDateProblem, 'price_dates');
  }

  if (!hasPublicImageCandidate(input.pkg)) {
    addBlocker(
      hard,
      'public_image_missing',
      'public package snapshot requires at least one approved customer image candidate',
      'images_public',
    );
  }

  if (input.publicSnapshotTitle !== undefined) {
    const title = String(input.publicSnapshotTitle ?? '').trim();
    if (!title) {
      addBlocker(hard, 'public_title_missing', 'public package snapshot title is missing or not policy-generated', 'public_title');
    } else if (!PUBLIC_TITLE_DURATION_RE.test(title)) {
      addBlocker(hard, 'unsupported_title_claim', 'public package snapshot title must include the verified trip duration', 'public_title');
    }
  }

  if (
    input.expectedPublicSnapshotHash
    && input.publicSnapshotHash
    && input.expectedPublicSnapshotHash !== input.publicSnapshotHash
  ) {
    addBlocker(hard, 'public_snapshot_hash_mismatch', 'mobile proof hash does not match the public package snapshot hash');
  }

  if (hasOptionalTourPollution(sourcePkg)) {
    addBlocker(hard, 'optional_tour_display_pollution', 'optional_tours contains no-option, price-table, inclusion, or header fragments', 'optional_tours');
    addBlocker(hard, 'masked_data_pollution', 'renderer may hide optional_tours pollution, but source DB still contains polluted customer data', 'optional_tours');
  }

  const maskedCopyPollution = findMaskedCustomerCopyPollution(
    sourcePkg,
    coveredPublicNoticeSourcePaths(input),
  );
  if (maskedCopyPollution) {
    addBlocker(
      hard,
      'masked_data_pollution',
      `renderer may hide customer-copy pollution, but source DB still contains polluted text at ${maskedCopyPollution.path}: ${maskedCopyPollution.text.slice(0, 120)}`,
      maskedCopyPollution.path,
    );
    if (maskedCopyPollution.risky) {
      addBlocker(hard, 'risky_reservation_claim', 'source DB contains risky reservation/guarantee wording even if the public snapshot masks it', maskedCopyPollution.path);
    }
  }

  const brokenAttraction = findBrokenAttractionId(sourcePkg);
  if (brokenAttraction) {
    addBlocker(hard, 'broken_attraction_id', brokenAttraction, 'itinerary_data');
  }
  for (const id of input.invalidAttractionIds ?? []) {
    addBlocker(hard, 'broken_attraction_id', `itinerary_data references an inactive, missing, or non-customer-publishable attraction_id: ${id}`, 'itinerary_data');
  }

  const unsupportedClaim = findUnsupportedCustomerClaim(input);
  if (unsupportedClaim) {
    addBlocker(hard, 'unsupported_title_claim', unsupportedClaim.message, unsupportedClaim.fieldPath);
  }

  if (hasRiskyCustomerCopy(input.routeTextDump ?? input.pkg)) {
    addBlocker(hard, 'risky_reservation_claim', 'customer copy contains risky reservation/guarantee wording');
  }

  const blockingCopy = findBlockingCustomerCopy(input);
  if (blockingCopy) {
    addBlocker(
      hard,
      blockingCopy.code,
      `blocking customer-visible copy remains in public snapshot text: ${blockingCopy.text.slice(0, 120)}`,
    );
  }

  const internalCopy = hasInternalEnglishCopy(input);
  if (internalCopy) {
    addBlocker(hard, 'english_internal_copy', `internal or English operational copy is customer-visible: ${internalCopy.slice(0, 120)}`);
  }

  hard.push(...legacyGateBlockers(input));

  if (input.legacyPublishGate?.decision === 'force_required') {
    soft.push(...input.legacyPublishGate.warnings.map(message => ({
      code: 'legacy_publish_warning',
      message,
      severity: 'warning' as const,
    })));
  }

  const publishable = hard.length === 0;
  return {
    publication_state: publishable ? 'published' : 'blocked',
    publishable,
    hard_blockers: hard,
    soft_warnings: soft,
    required_actions: publishable ? [] : requiredActionsForBlockers(hard),
  };
}
