import type { ExtractedData, MultiProductResult } from '@/lib/parser';
import { splitCatalogByItineraryHeaders } from '@/lib/parser/catalog-pre-split';

function inferTitle(section: string, index: number): string {
  const lines = section
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const pkgIndex = lines.findIndex(line => /^PKG$/i.test(line));
  const pkgTitle = pkgIndex >= 0
    ? lines.slice(pkgIndex + 1).find(line => /\d+\s*박\s*\d+\s*일/.test(line))
    : undefined;

  return pkgTitle
    ?? lines.find(line => /\d+\s*박\s*\d+\s*일/.test(line))
    ?? `카탈로그 상품 ${index + 1}`;
}

function inferTripStyle(title: string): { nights?: number; duration?: number; tripStyle?: string } {
  const match = title.match(/(\d+)\s*박\s*(\d+)\s*일/);
  if (!match) return {};
  return {
    nights: Number(match[1]),
    duration: Number(match[2]),
    tripStyle: match[0].replace(/\s+/g, ''),
  };
}

function inferDestination(title: string): string | undefined {
  const known = ['클락', '후쿠오카', '푸꾸옥', '세부', '다낭', '나트랑', '방콕', '파타야', '오사카', '도쿄'];
  return known.find(name => title.includes(name));
}

export function recoverCatalogSplitFromRawText(rawText: string | null | undefined): MultiProductResult[] {
  if (!rawText?.trim()) return [];

  const { sharedPrefix, sections } = splitCatalogByItineraryHeaders(rawText);
  if (sections.length < 2) return [];

  return sections.map((section, index) => {
    const sectionRawText = ((sharedPrefix ? `${sharedPrefix}\n\n---\n\n` : '') + section).trim();
    const title = inferTitle(section, index);
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
