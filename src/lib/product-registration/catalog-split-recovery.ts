import type { ExtractedData, MultiProductResult } from '@/lib/parser';
import { splitCatalogByItineraryHeaders } from '@/lib/parser/catalog-pre-split';
import {
  standardizeKnownMojibakeSupplierText,
  standardizeKnownMojibakeTitle,
} from './supplier-mojibake-standardization';

const READABLE_KOREAN_DURATION_RE = /(\d+)\s*\uBC15\s*(\d+)\s*\uC77C/u;
const READABLE_KOREAN_DAY_ONLY_RE = /(?:^|[^\d])(\d{1,2})\s*\uC77C(?:$|[^\d])/u;

const KOREAN_DURATION_RE = /(\d+)\s*박\s*(\d+)\s*일/;
const MOJIBAKE_NIGHT_RE = /(\d+)\s*諛/;
const DAY_ONLY_DURATION_RE = /(?:^|[^\d])(\d{1,2})\s*일(?:\s*\/\s*(\d{1,2})\s*일)?(?:$|[^\d])/u;
const PRICE_TABLE_LINE_RE = /(?:\d{1,2}[./]\d{1,2}|\d{1,2}\s+\d{1,2}).*\d{1,3}(?:,\d{3})+/;
const KOREAN_DAY_ONLY_DURATION_RE = /(?:^|[^\d])(\d{1,2})\s*일(?:$|[^\d])/u;
const KOREAN_DAY_MARKER_RE = /(?:^|\n)\s*(?:제\s*\d{1,2}\s*일|\d{1,2}\s*일차)(?=$|[\s:])/u;
const BRACKETED_DAY_ONLY_PRODUCT_HEADER_RE =
  /^\s*\[[^\]\n]{2,100}\]\s*[^\n]{2,180}?(?:\d{1,2})\s*일\s*(?:[-–]\s*[A-Z]{2,3})?\s*$/u;
const CUSTOMER_SCHEDULE_DAY_MARKER_RE =
  /(?:^|\n)\s*(?:DAY\s*\d{1,2}|제\s*\d{1,2}\s*(?:일차|일)|제\s*일\s*\d{1,2}|일\s*\d{1,2}|\d{1,2}\s*일(?:차)?)(?:\b|[\s가-힣])/i;
const FLIGHT_CUSTOMER_TEXT_RE = /\b[A-Z]{2}\d{2,4}\b[\s\S]{0,120}(?:공항|출발|도착)|(?:공항|출발|도착)[\s\S]{0,120}\b[A-Z]{2}\d{2,4}\b/;

function hasDurationSignal(line: string): boolean {
  return READABLE_KOREAN_DURATION_RE.test(line)
    || READABLE_KOREAN_DAY_ONLY_RE.test(line)
    || KOREAN_DURATION_RE.test(line)
    || DAY_ONLY_DURATION_RE.test(line)
    || (KOREAN_DAY_ONLY_DURATION_RE.test(line) && (BRACKETED_DAY_ONLY_PRODUCT_HEADER_RE.test(line) || /\bPKG\b/i.test(line)))
    || MOJIBAKE_NIGHT_RE.test(line);
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
  if (KOREAN_DURATION_RE.test(line) || DAY_ONLY_DURATION_RE.test(line) || KOREAN_DAY_ONLY_DURATION_RE.test(line)) {
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
  const readableDurationTitle = lines.find(line =>
    usableDurationTitle(line) &&
    !/^\s*\uC81C\s*\d+\s*\uC77C\b/u.test(line) &&
    !/^\s*(?:\uC77C\s*\uC790|\uC2DD\s*\uC0AC|\uC2DC\s*\uAC04)\s*$/u.test(line)
  );
  if (readableDurationTitle) return readableDurationTitle;

  const pkgIndex = lines.findIndex(line => /^PKG$/i.test(line));
  const pkgTitle = pkgIndex >= 0
    ? lines.slice(pkgIndex + 1).find(usableDurationTitle)
    : undefined;

  return pkgTitle
    ?? lines.find(usableDurationTitle)
    ?? `카탈로그 상품 ${index + 1}`;
}

function inferTripStyle(title: string, section?: string): { nights?: number; duration?: number; tripStyle?: string } {
  const readableDuration = title.match(READABLE_KOREAN_DURATION_RE);
  if (readableDuration) {
    return {
      nights: Number(readableDuration[1]),
      duration: Number(readableDuration[2]),
      tripStyle: `${readableDuration[1]}\uBC15${readableDuration[2]}\uC77C`,
    };
  }
  const readableDayOnly = title.match(READABLE_KOREAN_DAY_ONLY_RE);
  if (readableDayOnly) {
    const days = Number(readableDayOnly[1]);
    return Number.isFinite(days) && days > 1
      ? { nights: Math.max(0, days - 2), duration: days, tripStyle: `${Math.max(0, days - 2)}\uBC15${days}\uC77C` }
      : {};
  }
  const sectionReadableDuration = section?.match(READABLE_KOREAN_DURATION_RE);
  if (sectionReadableDuration) {
    return {
      nights: Number(sectionReadableDuration[1]),
      duration: Number(sectionReadableDuration[2]),
      tripStyle: `${sectionReadableDuration[1]}\uBC15${sectionReadableDuration[2]}\uC77C`,
    };
  }
  const titleKoreanDayOnly = title.match(KOREAN_DAY_ONLY_DURATION_RE);
  if (!KOREAN_DURATION_RE.test(title) && titleKoreanDayOnly && BRACKETED_DAY_ONLY_PRODUCT_HEADER_RE.test(title)) {
    const days = Number(titleKoreanDayOnly[1]);
    return Number.isFinite(days) && days > 1
      ? { duration: days, tripStyle: `${days}일` }
      : {};
  }
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
  const koreanDayOnly = title.match(KOREAN_DAY_ONLY_DURATION_RE);
  if (koreanDayOnly) {
    const days = Number(koreanDayOnly[1]);
    return Number.isFinite(days) && days > 1
      ? { duration: days, tripStyle: `${days}일` }
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
  const readableKnown = [
    '석가장', '발리', '푸꾸옥', '다낭', '보홀', '나트랑', '달랏', '연길', '백두산', '시즈오카', '몽골',
  ];
  const readableDestination = readableKnown.find(name => title.includes(name) || normalizedTitle.includes(name));
  if (readableDestination) return readableDestination;
  const known = [
    '클락', '후쿠오카', '푸꾸옥', '세부', '다낭', '나트랑', '방콕', '파타야', '오사카', '도쿄', '나리타', '치바', '서안', '화산',
    '?대씫', '?꾩퓼?ㅼ뭅', '?멸씀??', '?몃?', '?ㅻ궘', '?섑듃??', '諛⑹퐬', '?뚰???', '?ㅼ궗移?', '?꾩퓙', '?섎━?', '移섎컮', '二좎떆', '?쒖븞', '?붿궛',
  ];
  return known.find(name => normalizedTitle.includes(name) || title.includes(name));
}

function hasCustomerScheduleEvidence(sectionRawText: string): boolean {
  if (sectionRawText.length < 350) return false;
  if (CUSTOMER_SCHEDULE_DAY_MARKER_RE.test(sectionRawText) || KOREAN_DAY_MARKER_RE.test(sectionRawText)) return true;
  return FLIGHT_CUSTOMER_TEXT_RE.test(sectionRawText);
}

function hasCustomerDayMarkerEvidence(sectionRawText: string): boolean {
  return sectionRawText.length >= 350 && (CUSTOMER_SCHEDULE_DAY_MARKER_RE.test(sectionRawText) || KOREAN_DAY_MARKER_RE.test(sectionRawText));
}

function splitRepeatedDayOnlyProductHeaders(rawText: string): { sharedPrefix: string; sections: string[] } | null {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const starts: number[] = [];
  let offset = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const lookahead = lines.slice(index, index + 90).join('\n');
    if (BRACKETED_DAY_ONLY_PRODUCT_HEADER_RE.test(line.trim()) && KOREAN_DAY_MARKER_RE.test(lookahead)) {
      starts.push(offset);
    }
    offset += line.length + 1;
  }

  if (starts.length < 2) return null;
  return {
    sharedPrefix: rawText.slice(0, starts[0]).trim(),
    sections: starts.map((start, index) => rawText.slice(start, starts[index + 1] ?? rawText.length).trim()),
  };
}

function splitReadableRepeatedProductHeaders(rawText: string): { sharedPrefix: string; sections: string[] } | null {
  const text = rawText.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }

  const starts: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]?.trim() ?? '';
    if (!/^\[[^\]\n]{2,120}\][^\n]{2,180}\d{1,2}\s*일(?:$|[\s&<\-–—])/u.test(line)) continue;
    const window = lines.slice(index, Math.min(lines.length, index + 110)).join('\n');
    if (/(?:^|\n)\s*제\s*1\s*일(?:$|[\s\n])/u.test(window) && /(?:^|\n)\s*제\s*[2-9]\s*일(?:$|[\s\n])/u.test(window)) {
      starts.push(offsets[index]);
    }
  }

  const sorted = [...new Set(starts)].sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  return {
    sharedPrefix: text.slice(0, sorted[0]).trim(),
    sections: sorted.map((start, index) => text.slice(start, sorted[index + 1] ?? text.length).trim()),
  };
}

function splitTransportVariantDetailBlocks(rawText: string): { sharedPrefix: string; sections: string[] } | null {
  const text = rawText.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }

  const starts: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    const current = lines[index]?.trim() ?? '';
    const next = lines[index + 1]?.trim() ?? '';
    const label = `${current}${next}`.replace(/\s+/g, '');
    const isTransportBlock =
      label === '\uB9AC\uBB34\uC9C4\uBC84\uC2A4\uC774\uB3D9' ||
      label === '\uACE0\uC18D\uCCA0\uC774\uB3D9' ||
      label === '\uACE0\uC18D\uC5F4\uCC28\uC774\uB3D9';
    if (!isTransportBlock) continue;

    const window = lines.slice(index, Math.min(lines.length, index + 90)).join('\n');
    const hasTitle = /[\p{Script=Hangul}A-Za-z][^\n]{0,80}\d{1,2}\s*\uC77C/u.test(window);
    const hasProductFacts =
      /\uCD5C\uC18C\uCD9C\uBC1C/u.test(window) &&
      /\uD3EC\s*\uD568\s*\uB0B4\s*\uC5ED/u.test(window) &&
      /\uBD88\uD3EC\uD568\s*\uB0B4\uC5ED/u.test(window);
    const hasItineraryTable =
      /\uC77C\s*\uC790/u.test(window) &&
      /\uC81C\s*1\s*\uC77C/u.test(window);

    if (hasTitle && hasProductFacts && hasItineraryTable) {
      starts.push(offsets[index]);
    }
  }

  const sorted = [...new Set(starts)].sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  return {
    sharedPrefix: text.slice(0, sorted[0]).trim(),
    sections: sorted.map((start, index) => text.slice(start, sorted[index + 1] ?? text.length).trim()),
  };
}

export function recoverCatalogSplitFromRawText(rawText: string | null | undefined): MultiProductResult[] {
  if (!rawText?.trim()) return [];

  let { sharedPrefix, sections } = splitCatalogByItineraryHeaders(rawText);
  const transportVariantSplit = splitTransportVariantDetailBlocks(rawText);
  if (transportVariantSplit && transportVariantSplit.sections.length > sections.length) {
    sharedPrefix = transportVariantSplit.sharedPrefix;
    sections = transportVariantSplit.sections;
  }
  if (sections.length < 2) {
    const repeatedDayOnlySplit = splitRepeatedDayOnlyProductHeaders(rawText);
    if (repeatedDayOnlySplit) {
      sharedPrefix = repeatedDayOnlySplit.sharedPrefix;
      sections = repeatedDayOnlySplit.sections;
    }
  }
  if (sections.length < 2) {
    const readableRepeatedProductSplit = splitReadableRepeatedProductHeaders(rawText);
    if (readableRepeatedProductSplit) {
      sharedPrefix = readableRepeatedProductSplit.sharedPrefix;
      sections = readableRepeatedProductSplit.sections;
    }
  }
  if (sections.length < 2) return [];

  let products = sections.map((section, index) => {
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
  const strongProductCount = products.filter(product => {
    const title = product.extractedData.title ?? '';
    return /^\[[^\]]+\]/.test(title) || /\bPKG\b/i.test(title);
  }).length;
  if (strongProductCount >= 2) {
    products = products.filter(product => !/\/\/.+\d+\s*박\s*\d+\s*일/u.test(product.extractedData.title ?? ''));
  }
  const productsWithCustomerDayEvidence = products.filter((product, index) => {
    const ownSection = standardizeKnownMojibakeSupplierText(sections[index] ?? '');
    return hasCustomerDayMarkerEvidence(ownSection || (product.sectionRawText ?? ''));
  });
  if (productsWithCustomerDayEvidence.length >= 2) return productsWithCustomerDayEvidence;
  if (productsWithCustomerDayEvidence.length === 1) return [];

  const productsWithCustomerScheduleEvidence = products.filter((product, index) => {
    const ownSection = standardizeKnownMojibakeSupplierText(sections[index] ?? '');
    return hasCustomerScheduleEvidence(ownSection || (product.sectionRawText ?? ''));
  });
  if (productsWithCustomerScheduleEvidence.length === 1) return [];
  return productsWithCustomerScheduleEvidence.length >= 2 ? productsWithCustomerScheduleEvidence : products;
}
