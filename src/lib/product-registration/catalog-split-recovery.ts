import type { ExtractedData, MultiProductResult } from '@/lib/parser';
import { splitCatalogByItineraryHeaders } from '@/lib/parser/catalog-pre-split';
import {
  standardizeKnownMojibakeSupplierText,
  standardizeKnownMojibakeTitle,
} from './supplier-mojibake-standardization';

const KOREAN_DURATION_RE = /(\d+)\s*박\s*(\d+)\s*일/;
const MOJIBAKE_NIGHT_RE = /(\d+)\s*諛/;
const DAY_ONLY_DURATION_RE = /(?:^|[^\d])(\d{1,2})\s*일(?:\s*\/\s*(\d{1,2})\s*일)?(?:$|[^\d])/u;
const PRICE_TABLE_LINE_RE = /(?:\d{1,2}[./]\d{1,2}|\d{1,2}\s+\d{1,2}).*\d{1,3}(?:,\d{3})+/;
const CUSTOMER_SCHEDULE_DAY_MARKER_RE =
  /(?:^|\n)\s*(?:DAY\s*\d{1,2}|제\s*\d{1,2}\s*(?:일차|일)|제\s*일\s*\d{1,2}|일\s*\d{1,2}|\d{1,2}\s*일(?:차)?)(?:\b|[\s가-힣])/i;
const FLIGHT_CUSTOMER_TEXT_RE = /\b[A-Z]{2}\d{2,4}\b[\s\S]{0,120}(?:공항|출발|도착)|(?:공항|출발|도착)[\s\S]{0,120}\b[A-Z]{2}\d{2,4}\b/;

function hasDurationSignal(line: string): boolean {
  return KOREAN_DURATION_RE.test(line) || DAY_ONLY_DURATION_RE.test(line) || MOJIBAKE_NIGHT_RE.test(line);
}

function hasReadableTitleText(line: string): boolean {
  const withoutDuration = line
    .replace(KOREAN_DURATION_RE, ' ')
    .replace(DAY_ONLY_DURATION_RE, ' ')
    .replace(/\b(?:PKG|PACKAGE)\b/gi, ' ')
    .trim();
  return (withoutDuration.match(/[\p{Script=Hangul}A-Za-z]/gu) ?? []).length >= 2;
}

function usableDurationTitle(line: string): boolean {
  if (!hasDurationSignal(line)) return false;
  if (PRICE_TABLE_LINE_RE.test(line)) return false;
  if (KOREAN_DURATION_RE.test(line) || DAY_ONLY_DURATION_RE.test(line)) {
    return hasReadableTitleText(line);
  }
  return true;
}

function inferTitle(section: string, index: number): string {
  const lines = section
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const specialPriceIndex = lines.findIndex(line => /SPECIAL\s+PRICE/i.test(line));
  if (specialPriceIndex >= 0) {
    const titleAfterSpecialPrice = lines
      .slice(specialPriceIndex + 1, Math.min(lines.length, specialPriceIndex + 6))
      .find(line => !/^\d{1,2}[./]\d{1,2}\b/.test(line) && /[가-힣]/.test(line));
    if (titleAfterSpecialPrice) return titleAfterSpecialPrice;
  }
  const inlinePkgTitle = lines.find(line => /\bPKG\b/i.test(line) && usableDurationTitle(line));
  if (inlinePkgTitle) return inlinePkgTitle;

  const pkgIndex = lines.findIndex(line => /^PKG$/i.test(line));
  const pkgTitle = pkgIndex >= 0
    ? lines.slice(pkgIndex + 1).find(usableDurationTitle)
    : undefined;

  return pkgTitle
    ?? lines.find(usableDurationTitle)
    ?? `카탈로그 상품 ${index + 1}`;
}

function inferTripStyle(title: string, section?: string): { nights?: number; duration?: number; tripStyle?: string } {
  const match = title.match(KOREAN_DURATION_RE) ?? section?.match(KOREAN_DURATION_RE);
  if (match) {
    return {
      nights: Number(match[1]),
      duration: Number(match[2]),
      tripStyle: match[0].replace(/\s+/g, ''),
    };
  }
  const dayOnly = title.match(DAY_ONLY_DURATION_RE) ?? section?.match(DAY_ONLY_DURATION_RE);
  if (dayOnly) {
    const days = Number(dayOnly[2] ?? dayOnly[1]);
    return Number.isFinite(days) && days > 1
      ? { nights: Math.max(0, days - 1), duration: days, tripStyle: `${days - 1}박${days}일` }
      : {};
  }
  const mojibakeNight = title.match(MOJIBAKE_NIGHT_RE);
  if (!mojibakeNight) return {};
  const nights = Number(mojibakeNight[1]);
  return {
    nights,
    duration: nights + 2,
    tripStyle: `${nights}박${nights + 2}일`,
  };
}

function inferDestination(title: string): string | undefined {
  const normalizedTitle = standardizeKnownMojibakeTitle(title);
  const known = [
    '클락', '후쿠오카', '푸꾸옥', '세부', '다낭', '나트랑', '방콕', '파타야', '오사카', '도쿄', '나리타', '치바', '서안', '화산',
    '?대씫', '?꾩퓼?ㅼ뭅', '?멸씀??', '?몃?', '?ㅻ궘', '?섑듃??', '諛⑹퐬', '?뚰???', '?ㅼ궗移?', '?꾩퓙', '?섎━?', '移섎컮', '二좎떆', '?쒖븞', '?붿궛',
  ];
  return known.find(name => normalizedTitle.includes(name) || title.includes(name));
}

function hasCustomerScheduleEvidence(sectionRawText: string): boolean {
  if (sectionRawText.length < 350) return false;
  if (CUSTOMER_SCHEDULE_DAY_MARKER_RE.test(sectionRawText)) return true;
  return FLIGHT_CUSTOMER_TEXT_RE.test(sectionRawText);
}

export function recoverCatalogSplitFromRawText(rawText: string | null | undefined): MultiProductResult[] {
  if (!rawText?.trim()) return [];

  const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(rawText);
  if (sections.length < 2) return [];

  const products = sections.map((section, index) => {
    const sectionRawText = standardizeKnownMojibakeSupplierText(((sharedPrefix ? `${sharedPrefix}\n\n---\n\n` : '') + section).trim());
    const title = standardizeKnownMojibakeTitle(inferTitle(section, index));
    const trip = inferTripStyle(title, sectionRawText);
    const extractedData: ExtractedData = {
      title,
      category: 'package',
      product_type: 'package',
      trip_style: trip.tripStyle,
      destination: inferDestination(title),
      duration: trip.duration,
      nights: trip.nights,
      rawText: sectionRawText,
      price_tiers: [],
      product_summary: title,
      product_highlights: [title],
    };

    return {
      extractedData,
      itineraryData: null,
      sectionRawText,
    };
  });
  const productsWithCustomerScheduleEvidence = products.filter((product, index) => {
    const ownSection = standardizeKnownMojibakeSupplierText(sections[index] ?? '');
    return hasCustomerScheduleEvidence(ownSection || (product.sectionRawText ?? ''));
  });
  return productsWithCustomerScheduleEvidence.length >= 2 ? productsWithCustomerScheduleEvidence : products;
}
