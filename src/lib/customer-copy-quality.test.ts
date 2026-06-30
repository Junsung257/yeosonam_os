import { describe, expect, it } from 'vitest';

import {
  customerCopyQualityIssues,
  normalizeCustomerVisibleCopy,
} from './customer-copy-quality';

function issueCodes(value: string) {
  return customerCopyQualityIssues(value).map(issue => issue.code);
}

describe('customer visible copy quality', () => {
  it('normalizes supplier shorthand and awkward notation into customer-facing copy', () => {
    expect(normalizeCustomerVisibleCopy('RMK 불포함 / P.P $60 / \\90,000 추가 됩니다')).toBe(
      '참고사항 불포함 / 1인 $60 / 90,000원 추가됩니다',
    );
    expect(normalizeCustomerVisibleCopy('TAX(5월기준), 유류할증료(6월기준), 기사가이드경비')).toBe(
      'TAX(5월 기준), 유류할증료(6월 기준), 가이드/기사 경비',
    );
  });

  it('normalizes Ba Na Hills summit and OR wording without leaving supplier notation', () => {
    const normalized = normalizeCustomerVisibleCopy('특식 – 바나산 정산 레스토랑에서 저녁식사(맥주OR음료 1잔)');

    expect(normalized).toBe('특식 – 바나산 정상 레스토랑에서 저녁식사(맥주 또는 음료 1잔)');
    expect(issueCodes(normalized)).toEqual([]);
  });

  it('detects low-information action sentences and normalizes them safely', () => {
    expect(issueCodes('바나힐 방문합니다')).toContain('low_information_action_sentence');
    expect(normalizeCustomerVisibleCopy('바나힐 방문합니다')).toBe('바나힐 방문');
    expect(normalizeCustomerVisibleCopy('다낭으로 이동합니다')).toBe('다낭 이동');
    expect(normalizeCustomerVisibleCopy('호이안 갑니다')).toBe('호이안 이동');
  });

  it('collapses duplicated customer-facing words in schedule copy', () => {
    expect(normalizeCustomerVisibleCopy('실크로드쇼 관람 관람 일정을 진행합니다.')).toBe(
      '실크로드쇼 관람 일정을 진행합니다.',
    );
  });

  it('detects generic marketing fallback and incomplete sentence noise', () => {
    expect(issueCodes('여행의 피로를 풀어 줄 아름다운 시간')).toContain('generic_marketing_fallback');
    expect(issueCodes('/ 바나힐 관광..')).toEqual(expect.arrayContaining([
      'incomplete_or_noisy_sentence',
    ]));
    expect(normalizeCustomerVisibleCopy('/ 바나힐 관광..')).toBe('바나힐 관광.');
  });

  it('blocks internal operator terms from customer-visible fields', () => {
    const codes = issueCodes('랜드사 NET 기준으로 마진 확인 후 담당자 확인');

    expect(codes).toContain('customer_forbidden_internal_terms');
  });

  it('does not flag attraction names that only contain similar syllables', () => {
    expect(issueCodes('원가계곡 풍경구 천문산 관광 후 호텔로 이동')).toEqual([]);
    expect(issueCodes('상품 원가 기준으로 마진을 확인합니다')).toContain('customer_forbidden_internal_terms');
  });

  it('does not mistake internal field keys containing pp for per-person shorthand', () => {
    expect(issueCodes('supplier_raw_facts')).toEqual([]);
    expect(normalizeCustomerVisibleCopy('P.P $60')).toBe('1인 $60');
  });

  it('detects mojibake and visible html entities', () => {
    expect(issueCodes('???? &#xAC00;')).toEqual(expect.arrayContaining([
      'placeholder_or_mojibake',
      'html_entity_visible',
    ]));
  });
});
