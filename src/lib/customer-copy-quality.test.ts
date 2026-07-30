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
    expect(normalizeCustomerVisibleCopy('RMK 불포함 / P.P $60 / \\90,000 추가 합니다')).toBe(
      '참고사항 불포함 / 1인 $60 / 90,000원 추가합니다',
    );
    expect(normalizeCustomerVisibleCopy('TAX(5월기준), 유류할증료(6월 기준), 기사가이드경비')).toBe(
      '항공세 5월 기준, 유류할증료 6월 기준, 가이드/기사 경비',
    );
  });

  it('normalizes compact itinerary spacing without changing the facts', () => {
    expect(normalizeCustomerVisibleCopy('출발2시간30분전 김해공항 미팅 후 수속')).toBe(
      '출발 2시간 30분 전 김해공항 미팅 후 수속',
    );
    expect(normalizeCustomerVisibleCopy('출발2시간반전 부산 김해 국제공항 미팅')).toBe(
      '출발 2시간 30분 전 부산 김해 국제공항 미팅',
    );
    expect(normalizeCustomerVisibleCopy('출발3시간전까지 인천공항에 도착')).toBe(
      '출발 3시간 전까지 인천공항에 도착',
    );
    expect(normalizeCustomerVisibleCopy('티오프 15분전에는 체크인')).toBe(
      '티오프 15분 전에는 체크인',
    );
    expect(normalizeCustomerVisibleCopy('천문산,원가계+칠성산+부용진 3박4일')).toBe(
      '천문산, 원가계 + 칠성산 + 부용진 3박4일',
    );
  });

  it('normalizes Ba Na Hills summit and OR wording without leaving supplier notation', () => {
    const normalized = normalizeCustomerVisibleCopy('특식 - 바나산 정산 레스토랑에서 저녁식사 맥주OR음료 1잔');

    expect(normalized).toBe('특식 - 바나산 정상 레스토랑에서 저녁식사 맥주 또는 음료 1잔');
    expect(issueCodes(normalized)).toEqual([]);
  });

  it('normalizes supplier carrier tags and checkbox markers from customer titles', () => {
    const normalized = normalizeCustomerVisibleCopy('[VN] 베트남 하노이/하롱/옌뜨or메가or닌빈 3박5일 ☑실속');

    expect(normalized).toBe('베트남 하노이/하롱/옌뜨 또는 메가 또는 닌빈 3박5일 실속');
    expect(issueCodes(normalized)).toEqual([]);
    expect(issueCodes('[VN] 베트남 하노이/하롱/옌뜨or메가or닌빈 3박5일 ☑실속')).toContain('supplier_notation');
    expect(issueCodes('✓')).toEqual([]);
    expect(issueCodes('✓ 노팁·노옵션')).toEqual([]);
    expect(issueCodes('✓실속')).toContain('supplier_notation');
    expect(issueCodes('실속✓')).toContain('supplier_notation');
    expect(normalizeCustomerVisibleCopy('📍 [BX] 나트랑 3박5일 &#9745일정표')).toBe('📍 나트랑 3박5일 일정표');
    expect(normalizeCustomerVisibleCopy('나트랑 3박5일 &#974')).toBe('나트랑 3박5일');
  });

  it('detects and normalizes hash-like supplier file titles', () => {
    const raw = 'b4b8b8b7538b-[ZE]푸꾸옥_3박_♥특가♥맛집노노팩_0826_0910_(0717발권)_0701';

    expect(issueCodes(raw)).toContain('raw_filename_or_hash_title');
    expect(normalizeCustomerVisibleCopy(raw)).toBe('푸꾸옥 3박 ♥특가♥맛집노노팩 0701');
  });

  it('normalizes ticketing batch package title markers', () => {
    const raw = '7월 발권 [BX 품격 4일 PKG] 비에이 오타루 도야 노보리베츠 #온천 2박 #게뷔페';

    expect(issueCodes(raw)).toContain('supplier_notation');
    expect(normalizeCustomerVisibleCopy(raw)).toBe('품격 4일 비에이 오타루 도야 노보리베츠 #온천 2박 #게뷔페');
  });

  it('drops supplier ticketing basis fragments misclassified as options', () => {
    expect(issueCodes('“6월 선발권 기준 요금입니다.”')).toContain('supplier_notation');
    expect(normalizeCustomerVisibleCopy('“6월 선발권 기준 요금입니다.”')).toBe('');
  });

  it('detects low-information action sentences and normalizes them safely', () => {
    expect(issueCodes('바나힐 방문합니다')).toContain('low_information_action_sentence');
    expect(normalizeCustomerVisibleCopy('바나힐 방문합니다')).toBe('바나힐 방문');
    expect(normalizeCustomerVisibleCopy('다낭으로 이동합니다')).toBe('다낭 이동');
    expect(normalizeCustomerVisibleCopy('호이안 갑니다')).toBe('호이안 이동');
  });

  it('collapses duplicated customer-facing words in schedule copy', () => {
    expect(normalizeCustomerVisibleCopy('스카로드 전망 전망 일정')).toBe('스카로드 전망 일정');
  });

  it('detects generic marketing fallback and incomplete sentence noise', () => {
    expect(issueCodes('마사지 2시간으로 여행의 피로를 풀어봅니다.')).toContain('generic_marketing_fallback');
    expect(normalizeCustomerVisibleCopy('마사지 2시간으로 여행의 피로를 풀어봅니다.')).toBe('마사지 2시간');
    expect(issueCodes('/ 바나힐 관광.')).toEqual(expect.arrayContaining([
      'incomplete_or_noisy_sentence',
    ]));
    expect(normalizeCustomerVisibleCopy('/ 바나힐 관광.')).toBe('바나힐 관광.');
  });

  it('drops orphaned sentence fragments that were misclassified as optional tour names', () => {
    expect(issueCodes('경우가 종종 발생합니다')).toContain('incomplete_or_noisy_sentence');
    expect(normalizeCustomerVisibleCopy('경우가 종종 발생합니다')).toBe('');
  });

  it('blocks internal operator terms from customer-visible fields', () => {
    const codes = issueCodes('랜드사 NET 기준으로 마진 확인 후 담당자 확인');

    expect(codes).toContain('customer_forbidden_internal_terms');
    expect(issueCodes('랜드사: 투어비 / 커미션 9%')).toContain('customer_forbidden_internal_terms');
    expect(issueCodes('B2B 거래처 단가 기준으로 정산 확인')).toContain('customer_forbidden_internal_terms');
  });

  it('does not flag valid attraction copy as mojibake', () => {
    expect(issueCodes('후에 황룡동굴 천문산 관광 후 호텔로 이동')).toEqual([]);
    expect(issueCodes('상품 원가 기준으로 마진을 확인합니다')).toContain('customer_forbidden_internal_terms');
  });

  it('does not flag Yuanjiajie place names as internal cost copy', () => {
    expect(issueCodes('원가계로 이동합니다.')).not.toContain('customer_forbidden_internal_terms');
    expect(issueCodes('원가계 후화원 · 천태만상 봉우리 향연')).not.toContain('customer_forbidden_internal_terms');
    expect(issueCodes('원가 기준으로 마진 확인')).toContain('customer_forbidden_internal_terms');
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

  it('blocks Korean land-operator and admin notes from customer-visible fields', () => {
    expect(issueCodes('랜드사 커미션 9% 관리자노트')).toContain('customer_forbidden_internal_terms');
    expect(issueCodes('내부메모: 공급가 기준 마진 확인')).toContain('customer_forbidden_internal_terms');
    expect(issueCodes('land operator comm 10% supplier margin')).toContain('customer_forbidden_internal_terms');
    expect(issueCodes('가이드 경비 4만원 성인/아동 동일')).not.toContain('customer_forbidden_internal_terms');
  });

  it('does not block attraction names that contain internal-term substrings', () => {
    expect(issueCodes('원가계로 이동')).not.toContain('customer_forbidden_internal_terms');
    expect(issueCodes('아바타 촬영지 원가계 관광')).not.toContain('customer_forbidden_internal_terms');
    expect(issueCodes('중국 5대 불교명산 중 하나인 범정산')).not.toContain('customer_forbidden_internal_terms');
    expect(issueCodes('바나산 정상 뷔페')).not.toContain('customer_forbidden_internal_terms');

    expect(issueCodes('상품 원가 기준으로 마진 확인')).toContain('customer_forbidden_internal_terms');
    expect(issueCodes('정산 확인 후 판매자 확인')).toContain('customer_forbidden_internal_terms');
  });

  it('detects mojibake and visible html entities', () => {
    expect(issueCodes('???? &#xAC00;')).toEqual(expect.arrayContaining([
      'placeholder_or_mojibake',
      'html_entity_visible',
    ]));
  });

  it('keeps fuel surcharge timing while rewriting supplier shorthand for customers', () => {
    expect(normalizeCustomerVisibleCopy('유류할증료(7월발권기준)')).toBe(
      '유류할증료(7월에 발권하는 항공권 기준)',
    );
    expect(normalizeCustomerVisibleCopy('유류할증료(7월발권)')).toBe(
      '유류할증료(7월에 발권하는 항공권 기준)',
    );
    expect(issueCodes(normalizeCustomerVisibleCopy('유류할증료(7월발권기준)'))).toEqual([]);
  });

  it('removes generic filler from a source-backed massage benefit', () => {
    const normalized = normalizeCustomerVisibleCopy('여행의 피로를 풀어줄 발마사지 50분 (팁불포함)');
    expect(normalized).toBe('발마사지 50분 (팁불포함)');
    expect(issueCodes(normalized)).toEqual([]);
  });
});
