import { describe, expect, it } from 'vitest';

import {
  customerCopyQualityIssues,
  normalizeCustomerVisibleCopy,
} from './customer-copy-quality';

function issueCodes(value: string) {
  return customerCopyQualityIssues(value).map(issue => issue.code);
}

describe('customer visible copy quality', () => {
  it('normalizes supplier shorthand and awkward spacing into customer-facing copy', () => {
    const normalized = normalizeCustomerVisibleCopy(
      'RMK 불 포 함 / 쇼 핑 2회 / P.P $60 / 7월기준 / 기사 가이드 경비는 현지에서 지불 하셔야 합니다. 예약 시 확인 부탁 드립니다. \\1,000 추가 됩니다.',
    );

    expect(normalized).toBe(
      '참고사항 불포함 / 쇼핑 2회 / 1인 $60 / 7월 기준 / 기사 가이드 경비는 현지에서 지불하셔야 합니다. 예약 시 확인 부탁드립니다. 1,000 추가됩니다.',
    );
  });

  it('blocks internal operator and supplier terms from customer-visible fields', () => {
    const codes = issueCodes('랜드사 NET 기준으로 수배 후 컨펌되면 대기 인폼 나가주세요. 마진은 내부 확인');

    expect(codes).toContain('customer_forbidden_internal_terms');
  });

  it('does not flag normal package terms used on customer-facing travel pages', () => {
    const codes = issueCodes(
      '선택관광은 현지에서 신청할 수 있으며, 디즈니랜드 일정과 최소 행사인원, 현지 가이드 안내가 포함됩니다. 예약대기 상품은 순차 안내됩니다.',
    );

    expect(codes).toEqual([]);
  });

  it('does not mistake internal field keys containing pp for per-person shorthand', () => {
    expect(issueCodes('supplier_raw_facts')).toEqual([]);
    expect(normalizeCustomerVisibleCopy('P.P $60')).toBe('1인 $60');
  });

  it('detects and removes dangling separators at the end of customer titles', () => {
    expect(issueCodes('[노옵션+노팁] 석가장 5일 –')).toContain('dangling_separator');
    expect(normalizeCustomerVisibleCopy('[노옵션+노팁] 석가장 5일 –')).toBe('[노옵션+노팁] 석가장 5일');
  });

  it('detects mojibake and visible html entities', () => {
    expect(issueCodes('???? &#xAC00;')).toEqual(expect.arrayContaining([
      'placeholder_or_mojibake',
      'html_entity_visible',
    ]));
  });
  it('flags internal comparison and point memo copy from supplier terms', () => {
    expect(issueCodes('타사비교필수★ POINT① 4명 이상 예약 시 무료 업그레이드')).toContain(
      'customer_forbidden_internal_terms',
    );
  });
});
