import type { ExtractedData, MultiProductResult } from '@/lib/parser';
import { splitCatalogByItineraryHeaders } from '@/lib/parser/catalog-pre-split';
import {
  standardizeKnownMojibakeSupplierText,
  standardizeKnownMojibakeTitle,
} from './supplier-mojibake-standardization';

const KOREAN_DURATION_RE = /(\d+)\s*박\s*(\d+)\s*일/;
const MOJIBAKE_NIGHT_RE = /(\d+)\s*諛/;

function hasDurationSignal(line: string): boolean {
  return KOREAN_DURATION_RE.test(line) || MOJIBAKE_NIGHT_RE.test(line);
}

function inferTitle(section: string, index: number): string {
  const lines = section
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const pkgIndex = lines.findIndex(line => /^PKG$/i.test(line));
  const pkgTitle = pkgIndex >= 0
    ? lines.slice(pkgIndex + 1).find(hasDurationSignal)
    : undefined;

  return pkgTitle
    ?? lines.find(hasDurationSignal)
    ?? `카탈로그 상품 ${index + 1}`;
}

function inferTripStyle(title: string): { nights?: number; duration?: number; tripStyle?: string } {
  const match = title.match(KOREAN_DURATION_RE);
  if (match) {
    return {
      nights: Number(match[1]),
      duration: Number(match[2]),
      tripStyle: match[0].replace(/\s+/g, ''),
    };
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

export function recoverCatalogSplitFromRawText(rawText: string | null | undefined): MultiProductResult[] {
  if (!rawText?.trim()) return [];

  const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(rawText);
  if (sections.length < 2) return [];

  return sections.map((section, index) => {
    const sectionRawText = standardizeKnownMojibakeSupplierText(((sharedPrefix ? `${sharedPrefix}\n\n---\n\n` : '') + section).trim());
    const title = standardizeKnownMojibakeTitle(inferTitle(section, index));
    const trip = inferTripStyle(title);
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
}
