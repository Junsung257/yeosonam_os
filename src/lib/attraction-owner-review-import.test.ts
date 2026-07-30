import { describe, expect, it } from 'vitest';

import {
  ATTRACTION_OWNER_REVIEW_CSV_HEADERS,
  buildAttractionOwnerReviewCsv,
  mergeOfficialVerificationSources,
  mergeOwnerReviewedAliases,
  parseAttractionOwnerReviewCsv,
  type AttractionOwnerReviewCsvItem,
} from './attraction-owner-review-import';

describe('attraction owner-review CSV', () => {
  it('keeps unapproved candidate rows non-writable', () => {
    const result = parseAttractionOwnerReviewCsv([
      'name,short_desc,long_desc,country,region,badge_type,emoji,aliases,official_source_url,owner_reviewed',
      '"석림","카르스트 지형 관광지","","중국","곤명","tour","📍","대소석림|자연조각공원 석림","https://www.unesco.org/en/iggp/shilin-unesco-global-geopark","no"',
    ].join('\n'));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: '석림',
      aliases: ['대소석림', '자연조각공원 석림'],
      owner_reviewed: false,
    });
  });

  it('accepts explicit owner approval values only', () => {
    const result = parseAttractionOwnerReviewCsv([
      'name,short_desc,long_desc,country,region,badge_type,emoji,aliases,official_source_url,owner_reviewed',
      '"삼협인가","","","중국","의창","tour","📍","","https://example.gov.cn/place","승인"',
      '"광부고성","","","중국","한단","tour","📍","","https://example.gov.cn/place2","검토"',
    ].join('\n'));

    expect(result.items.map(item => item.owner_reviewed)).toEqual([true, false]);
  });

  it('marks legacy CSV rows as unreviewed instead of silently importing them', () => {
    const result = parseAttractionOwnerReviewCsv([
      'name,short_desc,long_desc,country,region,badge_type,emoji',
      '"조운묘","","","중국","정정","tour","📍"',
    ].join('\n'));

    expect(result.legacyFormat).toBe(true);
    expect(result.items[0].owner_reviewed).toBe(false);
  });

  it('rejects invalid official evidence URLs before the API call', () => {
    const result = parseAttractionOwnerReviewCsv([
      'name,short_desc,long_desc,country,region,badge_type,emoji,aliases,official_source_url,owner_reviewed',
      '"스타의 거리","","","홍콩","홍콩","tour","📍","","javascript:alert(1)","yes"',
    ].join('\n'));

    expect(result.items).toHaveLength(0);
    expect(result.rejectedRows[0].reason).toContain('공식 근거 URL');
  });

  it('round-trips multiline descriptions and aliases', () => {
    const input: AttractionOwnerReviewCsvItem[] = [{
      name: '홍콩 고궁문화박물관',
      short_desc: '홍콩 서구룡 문화지구의 박물관',
      long_desc: '첫째 줄\n둘째 줄',
      country: '홍콩',
      region: '홍콩',
      badge_type: 'tour',
      emoji: '🏛️',
      aliases: ['고궁박물관내부', 'Hong Kong Palace Museum'],
      official_source_url: 'https://www.discoverhongkong.com/example',
      supporting_source_urls: ['https://www.legco.gov.hk/example'],
      source_phrases: ['고궁박물관내부'],
      verification_method: 'official_and_supplier_crosscheck',
      evidence_summary: '공급사 원문과 홍콩관광청의 공식 명칭 및 지역을 교차 확인했습니다.',
      owner_reviewed: false,
    }];

    const parsed = parseAttractionOwnerReviewCsv(buildAttractionOwnerReviewCsv(input));
    expect(parsed.rejectedRows).toEqual([]);
    expect(parsed.items).toEqual(input);
  });

  it('merges owner aliases and official sources without duplicates', () => {
    expect(mergeOwnerReviewedAliases(['석림'], '석림|대소석림')).toEqual(['석림', '대소석림']);
    expect(mergeOfficialVerificationSources(
      [{ kind: 'official_url', url: 'https://example.com/a' }],
      'https://example.com/a',
      ['https://example.com/b'],
      {
        verificationMethod: 'official_and_supplier_crosscheck',
        evidenceSummary: '공식 자료와 공급사 원문을 교차 확인했습니다.',
      },
    )).toEqual([
      expect.objectContaining({
        kind: 'official_url',
        url: 'https://example.com/a',
        review_channel: 'admin_csv_owner_confirmed',
        verification_method: 'official_and_supplier_crosscheck',
        evidence_summary: '공식 자료와 공급사 원문을 교차 확인했습니다.',
      }),
      expect.objectContaining({
        kind: 'supporting_url',
        url: 'https://example.com/b',
        verification_method: 'official_and_supplier_crosscheck',
      }),
    ]);
  });

  it('rejects malformed supporting URLs and unknown verification methods', () => {
    const invalidUrl = parseAttractionOwnerReviewCsv([
      ATTRACTION_OWNER_REVIEW_CSV_HEADERS.join(','),
      '"후보","","","태국","람푼","tour","📍","","https://example.com","javascript:alert(1)","원문","official_source_review","공식 자료 확인","yes"',
    ].join('\n'));
    expect(invalidUrl.rejectedRows[0].reason).toContain('보조 근거 URL');

    const invalidMethod = parseAttractionOwnerReviewCsv([
      ATTRACTION_OWNER_REVIEW_CSV_HEADERS.join(','),
      '"후보","","","태국","람푼","tour","📍","","https://example.com","","원문","guess","공식 자료 확인","yes"',
    ].join('\n'));
    expect(invalidMethod.rejectedRows[0].reason).toContain('지원하지 않는 검증 방식');
  });
});
