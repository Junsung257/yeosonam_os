import type { NaverSetupPacket } from './types';

const DEFAULT_NAVER_KEYWORD_CSV_BASENAME = 'naver';

export function getNaverKeywordCsv(packet: NaverSetupPacket | null): string | null {
  if (!packet) return null;
  const csv = packet?.packet.keyword_csv?.trim();
  return csv ? packet.packet.keyword_csv : null;
}

export function buildNaverKeywordCsvFilename(campaignName: string | null | undefined): string {
  const safeBase = String(campaignName || DEFAULT_NAVER_KEYWORD_CSV_BASENAME)
    .trim()
    .replace(/[\\/:*?"<>|\r\n]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return `${safeBase || DEFAULT_NAVER_KEYWORD_CSV_BASENAME}-keywords.csv`;
}
