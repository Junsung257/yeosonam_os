/**
 * A4/모바일 공통 약관 요약 추출 유틸.
 * - 법무/취소 관련 문구만 선별
 * - 화면 노출 길이 제한(기본 3줄)
 */

const LEGAL_NOTICE_RE = /(취소|환불|수수료|약관|면책|변경)/;

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
  const itineraryData = pkg.itinerary_data as { highlights?: { remarks?: unknown } } | null | undefined;
  const remarks = Array.isArray(itineraryData?.highlights?.remarks)
    ? (itineraryData.highlights?.remarks as unknown[])
    : [];
  return extractLegalNoticeLines(remarks, max);
}
