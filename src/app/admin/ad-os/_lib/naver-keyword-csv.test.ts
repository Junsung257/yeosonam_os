import { describe, expect, it } from 'vitest';
import type { NaverSetupPacket } from './types';
import { buildNaverKeywordCsvFilename, getNaverKeywordCsv } from './naver-keyword-csv';

const packet: NaverSetupPacket = {
  existing_assets: {
    campaigns: 1,
    adgroups: 1,
    channels: 1,
    stored_adgroup_id: null,
  },
  required_external: [],
  packet: {
    campaign_name: 'Seoul / Parents: Pilot?',
    ad_group_name: 'Parents',
    daily_budget_krw: 30000,
    monthly_budget_krw: 500000,
    max_cpc_krw: 500,
    landing_url: '/packages/seoul',
    final_url: '/packages/seoul',
    keyword_count: 1,
    keyword_csv: 'keyword,bid\nseoul,500',
    keyword_samples: [],
  },
  next_action: 'Review packet.',
};

describe('Ad OS Naver keyword CSV helpers', () => {
  it('returns CSV content only when a packet has non-empty CSV rows', () => {
    expect(getNaverKeywordCsv(packet)).toBe('keyword,bid\nseoul,500');
    expect(getNaverKeywordCsv(null)).toBeNull();
    expect(getNaverKeywordCsv({
      ...packet,
      packet: { ...packet.packet, keyword_csv: '   ' },
    })).toBeNull();
  });

  it('builds a filesystem-safe Naver keyword CSV filename', () => {
    expect(buildNaverKeywordCsvFilename(packet.packet.campaign_name)).toBe('Seoul-Parents-Pilot-keywords.csv');
    expect(buildNaverKeywordCsvFilename('  네이버 파일럿  ')).toBe('네이버-파일럿-keywords.csv');
    expect(buildNaverKeywordCsvFilename(null)).toBe('naver-keywords.csv');
    expect(buildNaverKeywordCsvFilename('***')).toBe('naver-keywords.csv');
  });
});
