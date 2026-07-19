import { describe, expect, it } from 'vitest';
import { isCustomerOptionalTourCandidate, isNonCustomerOptionText } from './customer-option-classifier';

describe('customer option classifier', () => {
  it('keeps local paid options but excludes tips, surcharges, and no-option notices', () => {
    expect(isCustomerOptionalTourCandidate('현지지불옵션 : 삼겹살 무제한 $30/인')).toBe(true);
    expect(isCustomerOptionalTourCandidate('관광 : 5D비행체험 $40, 북파 VIP $65')).toBe(true);
    expect(isCustomerOptionalTourCandidate('마사지 팁 [60분- $3/인 / 90분- $4/인]')).toBe(false);
    expect(isCustomerOptionalTourCandidate('* 싱글카트비 18홀 기준 빈펄 450,000동 / 에스츄리 500,000동 추가 됩니다.')).toBe(false);
    expect(isCustomerOptionalTourCandidate('해당 상품은 쇼핑2회 / 노옵션 상품입니다.')).toBe(false);
  });

  it('treats catalog table fragments as non-customer option noise', () => {
    expect(isNonCustomerOptionText('기 간')).toBe(true);
    expect(isNonCustomerOptionText('상 품 가')).toBe(true);
    expect(isNonCustomerOptionText('6/26까지 발권')).toBe(true);
    expect(isNonCustomerOptionText('▶ 여권유효기간은 반드시 6개월 이상 남아 있어야 합니다')).toBe(true);
  });

  it('blocks supplier price-table fragments from no-option products', () => {
    expect(isCustomerOptionalTourCandidate('7월 5')).toBe(false);
    expect(isCustomerOptionalTourCandidate('12일 [일요일] 출발')).toBe(false);
    expect(isCustomerOptionalTourCandidate('599')).toBe(false);
    expect(isCustomerOptionalTourCandidate('000원/인')).toBe(false);
    expect(isCustomerOptionalTourCandidate('포 함 내 역')).toBe(false);
    expect(isCustomerOptionalTourCandidate('차량')).toBe(false);
    expect(isCustomerOptionalTourCandidate('가이드')).toBe(false);
    expect(isCustomerOptionalTourCandidate('식사')).toBe(false);
    expect(isCustomerOptionalTourCandidate('특식4회')).toBe(false);
    expect(isCustomerOptionalTourCandidate('기사/가이드경비. $50/인')).toBe(false);
    expect(isCustomerOptionalTourCandidate('노옵션')).toBe(false);
  });
});
