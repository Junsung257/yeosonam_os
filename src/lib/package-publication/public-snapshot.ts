import { createHash } from 'crypto';

import { sanitizeCustomerPackageForClient } from '@/lib/customer-package-payload';
import { buildCustomerPackageDisplayCopy } from '@/lib/customer-package-display-copy';
import {
  hasRiskyCustomerPromiseCopy,
  stripRiskyCustomerPromiseCopy,
} from '@/lib/customer-risky-copy';
import {
  customerCopyQualityIssues,
  normalizeCustomerVisibleCopy,
} from '@/lib/customer-copy-quality';
import { normalizeCustomerAirlineCodeCopy } from '@/lib/airline-display';
import { isSafeImageSrc } from '@/lib/image-url';
import { postProcessItineraryData } from '@/lib/package-post-process';
import { renderPackage } from '@/lib/render-contract';
import { buildSourceBackedPriceDateRepair } from '@/lib/source-price-date-repair';
import { buildSupplierRawDeterministicItinerary } from '@/lib/supplier-raw-deterministic-facts';
import {
  composeCustomerPublicSubtitle,
  composeCustomerPublicSummary,
} from './public-summary-policy';
import { buildPublicTermsPolicy } from './public-terms-policy';
import { composeCustomerPublicTitle } from './public-title-policy';
import type { OptionalTourStatus, PublicPackageSnapshot } from './types';

type AnyRecord = Record<string, unknown>;
type PublicImageCandidate = {
  url: string;
  source: 'package_hero' | 'package_thumbnail' | 'product_thumbnail' | 'attraction_photo' | 'content_og' | 'brand_fallback';
  alt: string | null;
};
type PublicNoticeTemplateKey =
  | 'reservation_availability_check'
  | 'cancellation_policy_check'
  | 'shopping_disclosure_check'
  | 'passport_validity_check';
type PublicNoticeCandidate = {
  type: 'INFO' | 'POLICY' | 'CRITICAL';
  title: string;
  text: string;
  category: 'reservation' | 'cancellation' | 'shopping' | 'passport';
  values: Record<string, unknown>;
  template_key: PublicNoticeTemplateKey;
  review_status: 'auto_clean';
  source_line: null;
};

const SNAPSHOT_VERSION = 'public-package-snapshot-v1' as const;
const BRAND_FALLBACK_IMAGE = '/logo.png';

const OPTIONAL_TOUR_FRAGMENT_PATTERNS = [
  /노옵션/,
  /포\s*함\s*내\s*역/,
  /불\s*포\s*함\s*내\s*역/,
  /^(?:차량|가이드|기사|상품가|출발일|예약금|유류할증료|포함|불포함)$/,
  /^\d{1,3}$/,
  /^\d{1,2}\s*월\s*\d{1,2}/,
  /^\d{1,3}(?:,\d{3})*\s*원\s*\/?\s*인?$/,
  /^000\s*원\s*\/?\s*인?$/,
];

const RISKY_COPY_PATTERNS = [
  /예약\s*즉시\s*항공\s*[·ㆍ,]\s*숙박\s*확보/,
  /즉시\s*확정/,
  /무조건\s*출발/,
  /최저가\s*보장/,
  /좌석\s*확보\s*완료/,
  /숙박\s*확정/,
  /100%\s*보장/,
  /Decision\s*guide/i,
];

const PUBLIC_TEXT_BLOCKING_ISSUES = new Set([
  'placeholder_or_mojibake',
  'internal_source_copy',
  'customer_forbidden_internal_terms',
  'raw_supplier_shorthand',
  'supplier_notation',
  'raw_filename_or_hash_title',
]);

const HIGH_RISK_OPERATIONAL_COPY_RE =
  /환불\s*(?:은|이)?\s*절대\s*불가|환불\s*불가|취소\s*수수료.{0,12}100%|100%\s*차지|예약금|입금.{0,18}(?:좌석|예약|자동\s*취소|확정)|항공\s*요금.{0,12}입금|좌석.{0,12}(?:확정|확보|보장)|발권\s*마감|Decision\s*guide/i;
const LOW_INFORMATION_RISK_RESIDUE_RE = /^(?:후|전)?\s*안내(?:드립니다|합니다)?\.?$/;
const LOW_INFORMATION_PUBLIC_ROUTE_TEXT_RE =
  /^(?:x{2,}|n\/a|none|null|undefined|unknown|미정|없음|-|\.{1,3})$/i;
const PUBLIC_ROUTE_TEXT_STATUS_COPY_RE =
  /(?:\bUNKNOWN\b|^※|요금표|선착순|무료\s*증정|팀\s*한정|방당|옵션\s*사전\s*포함|출발일별\s*가격\s*등록|(?:포함사항|불포함사항)\s*\d+\s*개\s*등록|세부\s*일정은\s*상품\s*상담\s*시\s*안내|사진\s*준비\s*중|이미지\s*준비\s*중)/i;
const PUBLIC_ROUTE_TEXT_FRAGMENT_RE =
  /^(?:\d{1,2}:\d{2}|[A-Z0-9]{2}\d{2,4}|[월화수목금토일](?:요일)?|호텔|패키지|여소남|또는 동급|[1-5]성)$/;
const PUBLIC_STRUCTURE_STRING_KEY_RE =
  /(?:^|_)(?:id|ids|hash|url|urls|src|slug|icon|date|day|count|status|source|type|currency)$/i;

const SAFE_RESERVATION_NOTICE = '예약 가능 여부는 담당자 확인 후 안내됩니다.';
const APPROVED_OPERATIONAL_NOTICE_TEMPLATES: Record<PublicNoticeTemplateKey, PublicNoticeCandidate> = {
  reservation_availability_check: {
    type: 'INFO',
    title: '예약 전 확인',
    text: '항공 좌석과 요금은 상담 후 최종 확인됩니다.',
    category: 'reservation',
    values: {},
    template_key: 'reservation_availability_check',
    review_status: 'auto_clean',
    source_line: null,
  },
  cancellation_policy_check: {
    type: 'POLICY',
    title: '취소 규정 안내',
    text: '취소·환불 규정은 예약 단계에서 담당자가 다시 안내합니다.',
    category: 'cancellation',
    values: {},
    template_key: 'cancellation_policy_check',
    review_status: 'auto_clean',
    source_line: null,
  },
  shopping_disclosure_check: {
    type: 'INFO',
    title: '쇼핑 일정 안내',
    text: '쇼핑 일정이 포함될 수 있습니다. 방문 횟수와 품목은 상담 시 확인해 주세요.',
    category: 'shopping',
    values: {},
    template_key: 'shopping_disclosure_check',
    review_status: 'auto_clean',
    source_line: null,
  },
  passport_validity_check: {
    type: 'INFO',
    title: '여권 확인',
    text: '여권 유효기간과 입국 조건은 출발 전 담당자가 다시 확인해드립니다.',
    category: 'passport',
    values: {},
    template_key: 'passport_validity_check',
    review_status: 'auto_clean',
    source_line: null,
  },
};

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item ?? '').trim()).filter(Boolean)
    : [];
}

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isCustomerRouteTextDisplayable(value: string): boolean {
  const text = normalizeText(value);
  if (!text) return false;
  if (LOW_INFORMATION_PUBLIC_ROUTE_TEXT_RE.test(text)) return false;
  if (PUBLIC_ROUTE_TEXT_STATUS_COPY_RE.test(text)) return false;
  if (PUBLIC_ROUTE_TEXT_FRAGMENT_RE.test(text)) return false;
  return true;
}

function isEmptyPublicValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return normalizeText(value) === '';
  return false;
}

function sanitizePublicCustomerString(value: string): string | null {
  let candidate = normalizeCustomerAirlineCodeCopy(normalizeCustomerVisibleCopy(value));
  if (!candidate) return null;

  if (hasRiskyCustomerPromiseCopy(candidate)) {
    candidate = stripRiskyCustomerPromiseCopy(candidate) ?? SAFE_RESERVATION_NOTICE;
    if (LOW_INFORMATION_RISK_RESIDUE_RE.test(candidate)) {
      candidate = SAFE_RESERVATION_NOTICE;
    }
  }

  if (HIGH_RISK_OPERATIONAL_COPY_RE.test(candidate)) {
    return SAFE_RESERVATION_NOTICE;
  }

  const blockingIssue = customerCopyQualityIssues(candidate)
    .find(issue => PUBLIC_TEXT_BLOCKING_ISSUES.has(issue.code));
  if (blockingIssue) return null;

  return normalizeText(candidate);
}

function sanitizePublicCustomerValue(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    return PUBLIC_STRUCTURE_STRING_KEY_RE.test(key) ? value : sanitizePublicCustomerString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    const sanitized = value
      .map(item => sanitizePublicCustomerValue(item, key))
      .filter(item => !isEmptyPublicValue(item));
    return sanitized;
  }

  const record = asRecord(value);
  if (!record) return value;

  const sanitized: AnyRecord = {};
  for (const [key, childValue] of Object.entries(record)) {
    const publicValue = sanitizePublicCustomerValue(childValue, key);
    if (!isEmptyPublicValue(publicValue)) sanitized[key] = publicValue;
  }
  return sanitized;
}

function sanitizePublicHighlightList(value: unknown): string[] {
  return stringList(value)
    .filter(item => !hasRiskyCustomerPromiseCopy(item) && !HIGH_RISK_OPERATIONAL_COPY_RE.test(item))
    .filter(item => !/컴\s*\d+\s*%|com\s*\d+\s*%/i.test(item))
    .filter(item => !customerCopyQualityIssues(item).some(issue => PUBLIC_TEXT_BLOCKING_ISSUES.has(issue.code)))
    .map(item => sanitizePublicCustomerString(item))
    .filter((item): item is string => Boolean(item) && item !== SAFE_RESERVATION_NOTICE);
}

function walkSourceStrings(
  value: unknown,
  visit: (text: string, path: string) => void,
  path = '',
  depth = 0,
) {
  if (depth > 6) return;
  if (typeof value === 'string') {
    const text = normalizeText(value);
    if (text) visit(text, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkSourceStrings(item, visit, `${path}.${index}`.replace(/^\./, ''), depth + 1));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, item] of Object.entries(record)) {
    walkSourceStrings(item, visit, `${path}.${key}`.replace(/^\./, ''), depth + 1);
  }
}

function noticeTemplatesForSourceText(text: string, path: string): PublicNoticeTemplateKey[] {
  const keys: PublicNoticeTemplateKey[] = [];
  const isOperationalPath = /itinerary_data\.highlights\.(?:remarks|shopping)/.test(path)
    || /itinerary_data\.days\.\d+\.schedule\.\d+\.(?:activity|note|a4_sentence|landing_sentence|attraction_names\.\d+)/.test(path)
    || /itinerary_data\.meta\.title/.test(path)
    || /^product_highlights\.\d+/.test(path)
    || /^product_summary/.test(path)
    || /^hero_tagline/.test(path)
    || /^customer_notes/.test(path)
    || /^notices_parsed/.test(path);
  if (!isOperationalPath) return keys;

  if (/\uC608\uC57D\s*\uC989\uC2DC|\uC989\uC2DC\s*\uD655\uC815|\uCD9C\uBC1C\s*\uD655\uC815|\uC88C\uC11D\s*(?:\uD655\uBCF4|\uD655\uC815|\uBCF4\uC7A5)|\uD56D\uACF5\s*\uC694\uAE08|\uBC1C\uAD8C|\uC608\uC57D\uAE08|\uC785\uAE08|\uBBF8\s*\uD655\uBCF4|\uAC00\uB2A5\s*\uC5EC\uBD80|\uBB38\uC758/i.test(text)) {
    keys.push('reservation_availability_check');
  }
  if (/\uCDE8\uC18C|\uD658\uBD88|\uC218\uC218\uB8CC|\uCC28\uC9C0|\uC704\uC57D/i.test(text)) {
    keys.push('cancellation_policy_check');
  }
  if (/\uC1FC\uD551|\uB77C\uD14D\uC2A4|\uCE68\uD5A5|\uBCF4\uC774\uCC28|\uBCF4\uC11D|\uC7A1\uD654|\uB18D\uC0B0\uBB3C|\uD734\uAC8C\uC18C/i.test(text)) {
    keys.push('shopping_disclosure_check');
  }
  if (/\uC5EC\uAD8C|\uBE44\uC790|\uC785\uAD6D|\uCD9C\uAD6D/i.test(text)) {
    keys.push('passport_validity_check');
  }

  if (/예약\s*즉시|즉시\s*확정|출발\s*확정|좌석\s*(?:확보|확정|보장)|항공\s*요금|발권|예약금|입금/i.test(text)) {
    keys.push('reservation_availability_check');
  }
  if (/취소|환불|수수료|차지|위약/i.test(text)) {
    keys.push('cancellation_policy_check');
  }
  if (/쇼핑|라텍스|침향|보이차|보석|잡화|농산물|휴게소/i.test(text)) {
    keys.push('shopping_disclosure_check');
  }
  if (/여권|비자|입국|출국/i.test(text)) {
    keys.push('passport_validity_check');
  }
  return keys;
}

function isHandledUnsafePublicSourceText(text: string, path: string): boolean {
  if (!/^product_highlights\.\d+/.test(path)) return false;
  return hasRiskyCustomerPromiseCopy(text)
    || HIGH_RISK_OPERATIONAL_COPY_RE.test(text)
    || /컴\s*\d+\s*%|com\s*\d+\s*%/i.test(text)
    || customerCopyQualityIssues(text).some(issue => PUBLIC_TEXT_BLOCKING_ISSUES.has(issue.code));
}

function buildPublicOperationalNotices(pkg: AnyRecord): {
  notices: PublicNoticeCandidate[];
  sourcePaths: string[];
} {
  const notices: PublicNoticeCandidate[] = [];
  const sourcePaths: string[] = [];
  const seenTemplates = new Set<string>();
  const seenPaths = new Set<string>();
  const sources: Array<{ root: string; value: unknown }> = [
    { root: 'itinerary_data', value: pkg.itinerary_data },
    { root: 'product_highlights', value: pkg.product_highlights },
    { root: 'product_summary', value: pkg.product_summary },
    { root: 'hero_tagline', value: pkg.hero_tagline },
    { root: 'customer_notes', value: pkg.customer_notes },
    { root: 'notices_parsed', value: pkg.notices_parsed },
  ];

  for (const source of sources) {
    walkSourceStrings(source.value, (text, path) => {
      const fullPath = `${source.root}${path ? `.${path}` : ''}`;
      const templates = noticeTemplatesForSourceText(text, fullPath);
      if (templates.length === 0) {
        if (isHandledUnsafePublicSourceText(text, fullPath) && !seenPaths.has(fullPath)) {
          seenPaths.add(fullPath);
          sourcePaths.push(fullPath);
        }
        return;
      }
      if (!seenPaths.has(fullPath)) {
        seenPaths.add(fullPath);
        sourcePaths.push(fullPath);
      }
      for (const template of templates) {
        if (seenTemplates.has(template)) continue;
        seenTemplates.add(template);
        notices.push({ ...APPROVED_OPERATIONAL_NOTICE_TEMPLATES[template] });
      }
    });
  }

  return { notices, sourcePaths };
}

function itineraryHasPublicDays(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  const itinerary = asRecord(value);
  return Array.isArray(itinerary?.days) && itinerary.days.length > 0;
}

function normalizePublicItineraryShape(value: unknown): unknown {
  if (Array.isArray(value)) return { days: value };
  return value;
}

function buildSourceBackedItineraryCandidate(pkg: AnyRecord, existingItinerary: unknown): unknown {
  const normalizedExisting = normalizePublicItineraryShape(existingItinerary);
  if (itineraryHasPublicDays(normalizedExisting)) {
    return normalizedExisting;
  }

  const rawText = asString(pkg.raw_text);
  if (!rawText) return normalizedExisting;

  const parsedItinerary = normalizePublicItineraryShape(buildSupplierRawDeterministicItinerary(rawText));
  if (!itineraryHasPublicDays(parsedItinerary)) {
    return normalizedExisting;
  }

  return {
    ...(asRecord(parsedItinerary) ?? {}),
    optional_tours: [],
  };
}

function addPublicImageCandidate(
  candidates: PublicImageCandidate[],
  seen: Set<string>,
  rawUrl: unknown,
  source: PublicImageCandidate['source'],
  alt: unknown = null,
) {
  if (!isSafeImageSrc(rawUrl)) return;
  const url = rawUrl.trim();
  if (seen.has(url)) return;
  seen.add(url);
  candidates.push({
    url,
    source,
    alt: asString(alt),
  });
}

function addPublicImageUrlList(
  candidates: PublicImageCandidate[],
  seen: Set<string>,
  value: unknown,
  source: PublicImageCandidate['source'],
  alt: unknown = null,
) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    addPublicImageCandidate(candidates, seen, item, source, alt);
  }
}

function addPublicPhotoArray(
  candidates: PublicImageCandidate[],
  seen: Set<string>,
  value: unknown,
  alt: unknown = null,
) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    const photo = asRecord(item);
    if (!photo) continue;
    addPublicImageCandidate(
      candidates,
      seen,
      photo.src_large ?? photo.src_medium ?? photo.url ?? photo.image_url,
      'attraction_photo',
      photo.alt ?? alt,
    );
  }
}

function collectNestedPublicPhotos(
  value: unknown,
  candidates: PublicImageCandidate[],
  seen: Set<string>,
  depth = 0,
) {
  if (depth > 6 || candidates.length >= 8) return;
  if (Array.isArray(value)) {
    for (const item of value) collectNestedPublicPhotos(item, candidates, seen, depth + 1);
    return;
  }

  const record = asRecord(value);
  if (!record) return;
  const alt = record.name ?? record.title ?? record.activity ?? record.label ?? null;
  addPublicPhotoArray(candidates, seen, record.photos, alt);

  for (const [key, child] of Object.entries(record)) {
    if (key === 'raw_text' || key === 'audit_report') continue;
    collectNestedPublicPhotos(child, candidates, seen, depth + 1);
  }
}

function collectProductThumbnailImages(
  candidates: PublicImageCandidate[],
  seen: Set<string>,
  products: unknown,
) {
  if (Array.isArray(products)) {
    for (const product of products) collectProductThumbnailImages(candidates, seen, product);
    return;
  }
  const product = asRecord(products);
  if (!product) return;
  addPublicImageUrlList(
    candidates,
    seen,
    product.thumbnail_urls,
    'product_thumbnail',
    product.display_name,
  );
}

function collectPublicImages(pkg: AnyRecord): PublicImageCandidate[] {
  const candidates: PublicImageCandidate[] = [];
  const seen = new Set<string>();
  const title = pkg.display_title ?? pkg.title ?? pkg.destination ?? null;

  for (const key of ['lp_hero_image_url', 'hero_image_url', 'main_image', 'thumbnail_url']) {
    addPublicImageCandidate(candidates, seen, pkg[key], 'package_hero', title);
  }
  addPublicImageUrlList(candidates, seen, pkg.thumbnail_urls, 'package_thumbnail', title);
  collectProductThumbnailImages(candidates, seen, pkg.products);

  addPublicImageCandidate(candidates, seen, pkg.og_image_url, 'content_og', title);
  addPublicImageUrlList(candidates, seen, pkg.slide_image_urls, 'content_og', title);

  collectNestedPublicPhotos(pkg.attractions, candidates, seen);
  collectNestedPublicPhotos(pkg.matched_attractions, candidates, seen);
  collectNestedPublicPhotos(pkg.destination_attractions, candidates, seen);
  collectNestedPublicPhotos(pkg.itinerary_data, candidates, seen);

  if (candidates.length === 0) {
    addPublicImageCandidate(
      candidates,
      seen,
      BRAND_FALLBACK_IMAGE,
      'brand_fallback',
      '여소남 브랜드 이미지',
    );
  }

  return candidates.slice(0, 8);
}

const ROUTE_TEXT_SKIP_KEYS = new Set([
  'admin_note',
  'admin_notes',
  'audit_report',
  'category',
  'commission_rate',
  'confidence',
  'created_at',
  'currency',
  'entity_kind',
  'field',
  'field_path',
  'hash',
  'id',
  'internal_note',
  'internal_notes',
  'margin_rate',
  'match_confidence',
  'match_method',
  'net_price',
  'operator',
  'package_id',
  'package_revision',
  'public_snapshot_hash',
  'raw_text',
  'review_status',
  'revision',
  'snapshot_version',
  'slug',
  'source',
  'source_context',
  'source_evidence',
  'source_line',
  'status',
  'supplier',
  'supplier_note',
  'template_key',
  'thumbnail_url',
  'thumbnail_urls',
  'type',
  'updated_at',
  'url',
  'values',
  'vendor',
]);

function collectCustomerVisibleStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') {
    const text = normalizeText(value);
    if (text) output.push(text);
    return output;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach(item => collectCustomerVisibleStrings(item, output));
    return output;
  }

  const record = asRecord(value);
  if (!record) return output;

  for (const [key, childValue] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase();
    if (
      ROUTE_TEXT_SKIP_KEYS.has(normalizedKey)
      || /(?:^|_)id$|(?:^|_)ids$|hash|revision|created_at|updated_at/.test(normalizedKey)
      || /(?:^|_)url$|(?:^|_)urls$/.test(normalizedKey)
    ) {
      continue;
    }
    collectCustomerVisibleStrings(childValue, output);
  }

  return output;
}

function optionalTourText(tour: unknown): string {
  if (typeof tour === 'string') return normalizeText(tour);
  const record = asRecord(tour);
  if (!record) return '';
  return [
    record.name,
    record.displayName,
    record.title,
    record.label,
    record.price,
    record.price_usd,
    record.price_krw,
    record.note,
  ].map(normalizeText).filter(Boolean).join(' ');
}

export function isOptionalTourFragment(tour: unknown): boolean {
  const text = optionalTourText(tour);
  if (!text) return true;
  return OPTIONAL_TOUR_FRAGMENT_PATTERNS.some(pattern => pattern.test(text));
}

function hasOptionalTourPrice(tour: unknown): boolean {
  const record = asRecord(tour);
  if (!record) return /\$\s*\d+|USD\s*\d+|\d{1,3}(?:,\d{3})*\s*원/.test(String(tour ?? ''));
  return ['price', 'price_usd', 'price_krw', 'price_jpy', 'amount'].some((key) => {
    const candidate = record[key];
    if (typeof candidate === 'number') return candidate > 0;
    return typeof candidate === 'string' && /\d/.test(candidate);
  });
}

export function classifyOptionalTours(input: {
  optionalTours: unknown;
  rawText?: string | null;
}): {
  status: OptionalTourStatus;
  publicTours: unknown[];
  pollutedTours: unknown[];
  badges: string[];
} {
  const rawText = input.rawText ?? '';
  const tours = Array.isArray(input.optionalTours) ? input.optionalTours : [];
  const noOptionExplicit = /(?:선택\s*관광|선택옵션|옵션)\s*[:：]?\s*노옵션|노옵션\s*상품|노팁\s*[·ㆍ/&]?\s*노옵션/.test(rawText);
  const pollutedTours = tours.filter(isOptionalTourFragment);
  const publicTours = tours.filter(tour => !isOptionalTourFragment(tour) && hasOptionalTourPrice(tour));

  if (pollutedTours.length > 0) {
    return {
      status: noOptionExplicit ? 'none_explicit' : 'polluted',
      publicTours: noOptionExplicit ? [] : publicTours,
      pollutedTours,
      badges: noOptionExplicit ? ['노옵션'] : [],
    };
  }
  if (noOptionExplicit) return { status: 'none_explicit', publicTours: [], pollutedTours: [], badges: ['노옵션'] };
  if (publicTours.length > 0) return { status: 'paid_options', publicTours, pollutedTours: [], badges: [] };
  return { status: 'unknown', publicTours: [], pollutedTours: [], badges: [] };
}

function destinations(pkg: AnyRecord): string[] {
  const destination = asString(pkg.destination);
  if (!destination) return [];
  return destination.split(/[\/,·&]+/).map(part => part.trim()).filter(Boolean);
}

function priceDisplay(pkg: AnyRecord): string | null {
  const price = asNumber(pkg.price);
  if (!price || price <= 0) return null;
  return `${price.toLocaleString('ko-KR')}원~`;
}

function formatPriceEvidenceToken(price: number): string {
  return price.toLocaleString('ko-KR');
}

function hasSourceBackedPriceTierEvidence(tier: AnyRecord, sourcePkg: AnyRecord): boolean {
  const price = asNumber(tier.adult_price ?? tier.adult_selling_price ?? tier.price);
  if (!price || price <= 0) return false;

  const departureDates = Array.isArray(tier.departure_dates)
    ? tier.departure_dates.filter(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
    : [];
  if (departureDates.length > 0) return true;

  const rawText = normalizeText(sourcePkg.raw_text);
  if (!rawText) return false;
  const departureDays = normalizeText(sourcePkg.departure_days);
  const sourceText = `${rawText}\n${departureDays}`;
  const priceToken = formatPriceEvidenceToken(price);
  const rawHasPrice = sourceText.includes(priceToken) || sourceText.includes(String(price));
  if (!rawHasPrice) return false;

  const periodLabel = normalizeText(tier.period_label);
  const rawHasPeriodBasis = /전\s*출발일|출발\s*요일|매주|요일|기본/i.test(sourceText)
    || (periodLabel.length > 1 && periodLabel !== '기본' && sourceText.includes(periodLabel));
  const tierHasBasis = periodLabel.length > 0 || departureDays.length > 0 || normalizeText(tier.departure_day_of_week).length > 0;
  return rawHasPeriodBasis && tierHasBasis;
}

function representativeCustomerPrice(pkg: AnyRecord, sourcePkg: AnyRecord = pkg): number | null {
  const productPrices = Array.isArray(pkg.product_prices) ? pkg.product_prices : [];
  const sellingPrices = productPrices
    .map(row => asNumber(asRecord(row)?.adult_selling_price))
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0);
  if (sellingPrices.length > 0) return Math.min(...sellingPrices);

  const priceDates = Array.isArray(pkg.price_dates) ? pkg.price_dates : [];
  const datePrices = priceDates
    .map(row => {
      const record = asRecord(row);
      return asNumber(record?.adult_selling_price ?? record?.price ?? record?.selling_price);
    })
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0);
  if (datePrices.length > 0) return Math.min(...datePrices);

  const priceTiers = Array.isArray(pkg.price_tiers) ? pkg.price_tiers : [];
  const tierPrices = priceTiers
    .map(row => {
      const record = asRecord(row);
      if (!record || !hasSourceBackedPriceTierEvidence(record, sourcePkg)) return null;
      return asNumber(record?.adult_price ?? record?.adult_selling_price ?? record?.price);
    })
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0);
  if (tierPrices.length > 0) return Math.min(...tierPrices);

  return null;
}

function hasValidPublicPriceDates(value: unknown): boolean {
  const rows = Array.isArray(value) ? value : [];
  if (rows.length === 0) return false;
  return rows.every((item) => {
    const record = asRecord(item);
    const date = typeof record?.date === 'string' ? record.date.trim() : '';
    const price = asNumber(record?.adult_selling_price ?? record?.price ?? record?.selling_price);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof price === 'number' && price > 0;
  });
}

function productPriceRowsFromPublicPriceDates(value: unknown): Array<{
  target_date: string;
  adult_selling_price: number;
  note: null;
}> {
  const rows = Array.isArray(value) ? value : [];
  const output: Array<{ target_date: string; adult_selling_price: number; note: null }> = [];
  const seen = new Set<string>();
  for (const item of rows) {
    const record = asRecord(item);
    const date = typeof record?.date === 'string' ? record.date.trim() : '';
    const price = asNumber(record?.adult_selling_price ?? record?.price ?? record?.selling_price);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !price || price <= 0) continue;
    const key = `${date}:${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ target_date: date, adult_selling_price: price, note: null });
  }
  return output;
}

function applySourceBackedPublicPriceRepair(sourcePackage: AnyRecord, publicPackage: AnyRecord): void {
  const repair = buildSourceBackedPriceDateRepair({
    ...sourcePackage,
    price_dates: Array.isArray(publicPackage.price_dates)
      ? publicPackage.price_dates as never
      : sourcePackage.price_dates as never,
  });

  if (repair.status === 'repaired') {
    publicPackage.price_dates = repair.priceDates;
    publicPackage.product_prices = productPriceRowsFromPublicPriceDates(repair.priceDates);
    publicPackage.public_price_source = {
      source: repair.source,
      reason: repair.reason,
      expected_count: repair.expectedCount,
      added_count: repair.addedCount,
    };
    return;
  }

  if (hasValidPublicPriceDates(publicPackage.price_dates)) {
    const currentProductPrices = Array.isArray(publicPackage.product_prices)
      ? publicPackage.product_prices
      : [];
    if (currentProductPrices.length === 0) {
      publicPackage.product_prices = productPriceRowsFromPublicPriceDates(publicPackage.price_dates);
    }
  }
}

function normalizeRawTitleEchoes(value: unknown, publicTitle: string, rawTitles: Set<string>): unknown {
  if (typeof value === 'string') {
    return rawTitles.has(normalizeText(value)) ? publicTitle : value;
  }
  if (Array.isArray(value)) {
    return value.map(item => normalizeRawTitleEchoes(item, publicTitle, rawTitles));
  }
  const record = asRecord(value);
  if (!record) return value;

  const normalized: AnyRecord = {};
  for (const [key, childValue] of Object.entries(record)) {
    normalized[key] = normalizeRawTitleEchoes(childValue, publicTitle, rawTitles);
  }
  return normalized;
}

function rawTitleEchoCandidates(pkg: AnyRecord): Set<string> {
  return new Set([
    pkg.title,
    pkg.display_title,
    asRecord(pkg.products)?.display_name,
  ].map(normalizeText).filter(Boolean));
}

function formatDuration(pkg: AnyRecord): string | null {
  const nights = asNumber(pkg.nights);
  const duration = asNumber(pkg.duration);
  if (nights && duration) return `${nights}박${duration}일`;
  if (duration && duration > 1) return `${duration - 1}박${duration}일`;
  if (duration) return `${duration}일`;
  const source = [pkg.trip_style, pkg.title, pkg.display_title].map(normalizeText).join(' ');
  const match = source.match(/\d+\s*박\s*\d+\s*일|\d+\s*일/);
  return match ? match[0].replace(/\s+/g, '') : null;
}

function sourceBundle(pkg: AnyRecord): string {
  return [
    pkg.raw_text,
    pkg.title,
    pkg.display_title,
    pkg.product_summary,
    ...(Array.isArray(pkg.product_highlights) ? pkg.product_highlights : []),
    JSON.stringify(pkg.itinerary_data ?? {}),
  ].map(normalizeText).filter(Boolean).join(' ');
}

function titleDestination(pkg: AnyRecord, sourceText: string): string | null {
  const destination = firstNonEmpty(pkg.destination);
  const cleanDestination = destination
    ?.replace(/\s*\/\s*/g, '·')
    .replace(/\s+/g, ' ')
    .trim() ?? '';

  if (/연길|백두산|장백산/.test(cleanDestination + sourceText)) return '연길·백두산';
  if (/하노이|하롱|하롱베이/.test(cleanDestination + sourceText)) return '하노이·하롱베이';
  if (/나트랑|달랏/.test(cleanDestination + sourceText)) return '나트랑·달랏';
  if (/다낭|호이안/.test(cleanDestination + sourceText)) return '다낭·호이안';
  if (/후쿠오카|유후인|벳부|규슈|큐슈/.test(cleanDestination + sourceText)) return /규슈|큐슈/.test(cleanDestination) ? '규슈' : '후쿠오카·규슈';
  if (/북해도|홋카이도|삿포로/.test(cleanDestination + sourceText)) return '북해도';
  if (/보홀/.test(cleanDestination + sourceText)) return '보홀';
  if (/세부/.test(cleanDestination + sourceText)) return '세부';
  return cleanDestination || null;
}

function titleCondition(sourceText: string, optionBadges: string[]): string | null {
  if (/노팁/.test(sourceText) && (/노옵션/.test(sourceText) || optionBadges.includes('노옵션'))) return '노팁·노옵션';
  if (/노옵션/.test(sourceText) || optionBadges.includes('노옵션')) return '노옵션';
  if (/노쇼핑/.test(sourceText)) return '노쇼핑';
  return null;
}

function titleTheme(sourceText: string, destination: string): string {
  const onsenCount = (sourceText.match(/온천/g) ?? []).length;
  const hasStrongOnsen = onsenCount >= 2 && /온천(?:호텔|료칸|숙박|마을|지구|대표|테마)/.test(sourceText);
  if (hasStrongOnsen && !/연길·백두산/.test(destination)) return '온천·관광';
  if (/골프|CC|라운딩/.test(sourceText)) return '골프';
  if (/호핑|스노클|해변|리조트|자유일정|자유시간/.test(sourceText)) return '휴양관광';
  return '핵심관광';
}

function composePublicTitle(pkg: AnyRecord, optionBadges: string[]): string {
  const policyTitle = composeCustomerPublicTitle(pkg, optionBadges);
  if (policyTitle) return policyTitle;

  const sourceText = sourceBundle(pkg);
  const destination = titleDestination(pkg, sourceText);
  const duration = formatDuration(pkg);
  if (!destination || !duration) return '';
  const condition = titleCondition(sourceText, optionBadges);
  const theme = titleTheme(sourceText, destination);
  const parts = [destination, condition, theme, duration].filter(Boolean) as string[];
  return [...new Set(parts)].join(' ').replace(/\s+/g, ' ').trim();
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return null;
}

function routeTextDump(snapshot: Omit<PublicPackageSnapshot, 'route_text_dump'>): string[] {
  const values = [
    snapshot.public_title,
    snapshot.public_subtitle,
    snapshot.price_display,
    snapshot.cta_copy.primary,
    snapshot.cta_copy.helper,
    ...snapshot.option_policy.badges,
    ...stringList(snapshot.package.product_highlights),
    ...collectCustomerVisibleStrings(snapshot.package.marketing_copies),
    ...stringList(snapshot.package.inclusions),
    ...stringList(snapshot.package.excludes),
    ...collectCustomerVisibleStrings(snapshot.card_projection),
    ...collectCustomerVisibleStrings(snapshot.lp_projection),
    ...collectCustomerVisibleStrings(snapshot.itinerary_public),
    ...collectCustomerVisibleStrings(snapshot.public_notices),
    ...collectCustomerVisibleStrings(snapshot.optional_tours_public),
    ...collectCustomerVisibleStrings(snapshot.canonical_view),
  ];
  return [...new Set(values.map(normalizeText).filter(isCustomerRouteTextDisplayable))];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const record = value as AnyRecord;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function hashPublicPackageSnapshot(snapshot: PublicPackageSnapshot): string {
  return createHash('sha256').update(stableStringify(snapshot)).digest('hex');
}

export function hasRiskyCustomerCopy(value: unknown): boolean {
  const text = typeof value === 'string'
    ? value
    : JSON.stringify(value ?? '');
  return hasRiskyCustomerPromiseCopy(text) || RISKY_COPY_PATTERNS.some(pattern => pattern.test(text));
}

export function buildPublicPackageSnapshot(pkg: AnyRecord): {
  snapshot: PublicPackageSnapshot;
  snapshotHash: string;
  optionalTourClassification: ReturnType<typeof classifyOptionalTours>;
} {
  const publicPackage = sanitizeCustomerPackageForClient(pkg) ?? {};
  applySourceBackedPublicPriceRepair(pkg, publicPackage);
  const imagesPublic = collectPublicImages({ ...pkg, ...publicPackage });
  const imageUrls = imagesPublic.map(image => image.url);
  if (imageUrls.length > 0) {
    publicPackage.hero_image_url = imageUrls[0];
    publicPackage.lp_hero_image_url = imageUrls[0];
    publicPackage.thumbnail_urls = imageUrls;
  }
  const customerPrice = representativeCustomerPrice(publicPackage, pkg);
  if (customerPrice !== null) {
    publicPackage.price = customerPrice;
  } else {
    delete publicPackage.price;
  }
  const optionalTourClassification = classifyOptionalTours({
    optionalTours: publicPackage.optional_tours,
    rawText: asString(pkg.raw_text),
  });
  const publicTerms = buildPublicTermsPolicy({
    inclusions: publicPackage.inclusions,
    exclusions: publicPackage.excludes,
    rawText: asString(pkg.raw_text),
  });
  const sourceBackedItinerary = postProcessItineraryData(
    buildSourceBackedItineraryCandidate(pkg, publicPackage.itinerary_data) as Parameters<typeof postProcessItineraryData>[0],
  );
  const publicOperationalNotices = buildPublicOperationalNotices({
    ...pkg,
    itinerary_data: sourceBackedItinerary,
  });
  const publicItinerary = sanitizePublicCustomerValue(sourceBackedItinerary);
  publicPackage.inclusions = publicTerms.inclusionsPublic;
  publicPackage.excludes = publicTerms.exclusionsPublic;
  publicPackage.optional_tours = optionalTourClassification.publicTours;
  publicPackage.itinerary_data = publicItinerary;
  publicPackage.product_highlights = sanitizePublicHighlightList(publicPackage.product_highlights);
  publicPackage.marketing_copies = sanitizePublicCustomerValue(publicPackage.marketing_copies);
  publicPackage.notices_parsed = publicOperationalNotices.notices;
  publicPackage.customer_notes = publicOperationalNotices.notices.length > 0
    ? publicOperationalNotices.notices.map(notice => notice.text).join('\n')
    : sanitizePublicCustomerValue(publicPackage.customer_notes);
  const displayCopy = buildCustomerPackageDisplayCopy({
    title: asString(publicPackage.title),
    display_title: asString(publicPackage.display_title),
    product_display_name: asString(asRecord(publicPackage.products)?.display_name),
    hero_tagline: asString(publicPackage.hero_tagline),
    product_summary: asString(publicPackage.product_summary),
    destination: asString(publicPackage.destination),
    duration: asNumber(publicPackage.duration),
    nights: asNumber(publicPackage.nights),
    trip_style: asString(publicPackage.trip_style),
    product_type: asString(publicPackage.product_type),
    airline: asString(publicPackage.airline),
    product_highlights: stringList(publicPackage.product_highlights),
    inclusions: stringList(publicPackage.inclusions),
    optional_tours: Array.isArray(publicPackage.optional_tours)
      ? publicPackage.optional_tours as Array<{ name?: string | null; displayName?: string | null; note?: string | null }>
      : [],
  });
  const publicTitle = composePublicTitle(
    { ...pkg, ...publicPackage },
    optionalTourClassification.badges,
  );
  const publicSummary = composeCustomerPublicSummary({
    publicTitle,
    pkg: publicPackage,
    optionBadges: optionalTourClassification.badges,
    optionalTourStatus: optionalTourClassification.status,
  }) || null;
  const publicSubtitle = composeCustomerPublicSubtitle({
    publicTitle,
    pkg: publicPackage,
    optionBadges: optionalTourClassification.badges,
    optionalTourStatus: optionalTourClassification.status,
  }) || displayCopy.heroSubline || null;
  const rawTitleEchoes = rawTitleEchoCandidates(pkg);
  publicPackage.itinerary_data = normalizeRawTitleEchoes(
    publicPackage.itinerary_data,
    publicTitle,
    rawTitleEchoes,
  );
  publicPackage.products = normalizeRawTitleEchoes(
    publicPackage.products,
    publicTitle,
    rawTitleEchoes,
  );
  const duration = asNumber(publicPackage.duration);
  const snapshotPackage = {
    ...publicPackage,
    title: publicTitle,
    display_title: publicTitle,
    product_summary: publicSummary,
    inclusions: publicTerms.inclusionsPublic,
    excludes: publicTerms.exclusionsPublic,
    optional_tours: optionalTourClassification.publicTours,
    notices_parsed: publicOperationalNotices.notices,
    customer_notes: publicOperationalNotices.notices.length > 0
      ? publicOperationalNotices.notices.map(notice => notice.text).join('\n')
      : publicPackage.customer_notes,
    images_public: imagesPublic,
    hero_image_url: imageUrls[0] ?? null,
    lp_hero_image_url: imageUrls[0] ?? null,
    thumbnail_urls: imageUrls,
    publication_state: pkg.publication_state ?? publicPackage.publication_state ?? null,
    package_revision: asNumber(pkg.package_revision) ?? 1,
  };
  const canonicalView = sanitizePublicCustomerValue(
    renderPackage(snapshotPackage as Parameters<typeof renderPackage>[0]),
  ) as Record<string, unknown>;
  const snapshotBase: Omit<PublicPackageSnapshot, 'route_text_dump'> = {
    snapshot_version: SNAPSHOT_VERSION,
    package_id: String(pkg.id ?? publicPackage.id ?? ''),
    package_revision: asNumber(pkg.package_revision) ?? 1,
    public_title: publicTitle,
    public_subtitle: publicSubtitle,
    duration,
    destinations: destinations(publicPackage),
    price_display: priceDisplay(publicPackage),
    option_policy: {
      status: optionalTourClassification.status,
      badges: optionalTourClassification.badges,
    },
    canonical_view: canonicalView,
    package: snapshotPackage,
    inclusions_public: publicTerms.inclusionsPublic,
    exclusions_public: publicTerms.exclusionsPublic,
    itinerary_public: publicPackage.itinerary_data ?? null,
    public_notices: publicOperationalNotices.notices,
    public_notice_source_paths: publicOperationalNotices.sourcePaths,
    optional_tours_public: optionalTourClassification.publicTours,
    images_public: imagesPublic,
    cta_copy: {
      primary: '예약 가능 여부 확인',
      helper: '출발일과 객실 상황에 따라 요금이 달라질 수 있습니다.',
    },
    card_projection: {
      id: publicPackage.id,
      title: publicTitle,
      destination: publicPackage.destination ?? null,
      duration,
      nights: asNumber(publicPackage.nights),
      price: asNumber(publicPackage.price),
      price_display: priceDisplay(publicPackage),
      hero_image_url: imageUrls[0] ?? null,
      thumbnail_urls: imageUrls,
      badges: displayCopy.badges,
    },
    lp_projection: {
      id: publicPackage.id,
      title: publicTitle,
      subtitle: publicSubtitle,
      destination: publicPackage.destination ?? null,
      summary: publicSummary,
      price: asNumber(publicPackage.price),
      price_display: priceDisplay(publicPackage),
      hero_image_url: imageUrls[0] ?? null,
      lp_hero_image_url: imageUrls[0] ?? null,
      thumbnail_urls: imageUrls,
      cta_copy: '예약 가능 여부 확인',
    },
  };
  const snapshot: PublicPackageSnapshot = {
    ...snapshotBase,
    route_text_dump: routeTextDump(snapshotBase),
  };
  return {
    snapshot,
    snapshotHash: hashPublicPackageSnapshot(snapshot),
    optionalTourClassification,
  };
}
