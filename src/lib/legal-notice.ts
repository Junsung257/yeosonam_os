/**
 * A4/모바일 공통 약관 요약 추출 유틸.
 * - 법무/취소 관련 문구만 선별
 * - 화면 노출 길이 제한(기본 3줄)
 */

const LEGAL_NOTICE_RE = /(취소|환불|수수료|약관|면책|변경)/;
const SOURCE_PREP_NOTICE_RE = /(여권|비짓재팬|visit\s*japan|출발인원|인원\s*미달|라운딩|락커|더블|트윈|사용하지|골프장|18\s*(?:h|홀))/i;

export const DEFAULT_LEGAL_NOTICE_LINES = [
  '예약 확정 후 취소 시 출발일 기준 특별약관에 따른 수수료가 적용될 수 있습니다.',
  '항공/현지 사정 및 기상 악화 등 불가항력 상황에서는 일정이 조정될 수 있습니다.',
  '상세 환불 기준은 결제 시점 약관을 기준으로 적용됩니다.',
];

export function extractLegalNoticeLines(lines: unknown[], max = 3): string[] {
  return lines
    .map((line) => String(line ?? '').trim())
    .filter(Boolean)
    .filter((line) => LEGAL_NOTICE_RE.test(line))
    .slice(0, max);
}

export function getLegalNoticeLinesOrDefault(lines: unknown[], max = 3): string[] {
  const extracted = extractLegalNoticeLines(lines, max);
  return extracted.length > 0 ? extracted : DEFAULT_LEGAL_NOTICE_LINES.slice(0, max);
}

export function extractLegalNoticeLinesFromPkg(pkg: Record<string, unknown>, max = 3): string[] {
  return extractLegalNoticeLines(readPackageRemarks(pkg), max);
}

/**
 * Product-specific preparation facts are not legal cancellation copy, but
 * they are still customer-critical source evidence. Keep them separate from
 * the generic legal extractor so LPs can show both without dropping passport,
 * Visit Japan Web, room-type, or course-preparation notes.
 */
export function extractSourcePreparationNoticeLinesFromPkg(pkg: Record<string, unknown>, max = 12): string[] {
  const remarks = readPackageRemarks(pkg);
  const seen = new Set<string>();
  return remarks
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .filter(line => SOURCE_PREP_NOTICE_RE.test(line))
    .filter(line => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .slice(0, max);
}

function readPackageRemarks(pkg: Record<string, unknown>): unknown[] {
  const itineraryData = pkg.itinerary_data as { highlights?: { remarks?: unknown } } | null | undefined;
  const canonicalView = pkg._canonical_view as { highlights?: { remarks?: unknown } } | null | undefined;
  const sourceRemarks = Array.isArray(itineraryData?.highlights?.remarks)
    ? itineraryData.highlights.remarks
    : [];
  const canonicalRemarks = Array.isArray(canonicalView?.highlights?.remarks)
    ? canonicalView.highlights.remarks
    : [];
  return [...canonicalRemarks, ...sourceRemarks];
}
