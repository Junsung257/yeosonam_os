/**
 * standard-terms 단위 테스트 (DB 미접속 부분만)
 *
 * 4-level 약관 우선순위 시스템의 순수 헬퍼:
 *   - formatCancellationDates: 출발일 기준 취소 날짜 자동 병기 (하나투어 방식)
 *   - getSourceBadgeColor: 출처 tier 별 UI 컬러
 *
 * 비커버 (DB 모킹 필요):
 *   - resolveTermsForPackage / buildTermsSnapshot — 4-level 머지 로직 (Supabase 의존)
 *
 * 회귀 위험:
 *   - ERR-HSN-cancel-date-pollution: "출발21일전" (발권 기한 안내)에 날짜 자동 주입 금지
 *   - ERR-HET-cancel-date-pollution-double-paren: "(~45)" 같은 기존 괄호 뒤에 새 괄호 중첩 금지
 */

import { describe, it, expect } from 'vitest';
import {
  type NoticeBlock,
  formatCancellationDates,
  getSourceBadgeColor,
  hasProductSpecialCancelPolicy,
  hasSpecialTermsBanner,
  shouldSuppressStandardCancelTable,
  filterNoticesForSurface,
  NOTICE_DOT_COLOR,
  NOTICE_CARD_TONE,
} from './standard-terms';

const notice = (overrides: Partial<NoticeBlock> & { type: string; text: string }): NoticeBlock => ({
  title: '취소 안내',
  ...overrides,
});

describe('shouldSuppressStandardCancelTable — P0 법적 충돌 방지', () => {
  it('AUTO_TICKETING 블록만 있어도 표준 일수표 숨김', () => {
    const notices = [
      notice({ type: 'AUTO_TICKETING', text: '발권 후 실비 위약금 최대 100%' }),
      notice({ type: 'RESERVATION', text: '출발 30일 전까지: 전액 환불' }),
    ];
    expect(shouldSuppressStandardCancelTable(notices)).toBe(true);
  });

  it('tier 4 취소/환불 제목 — 표준 일수표 숨김', () => {
    const notices = [
      notice({
        type: 'POLICY',
        text: '취소수수료 규정 안내서 참고',
        title: '취소/환불/여권/쇼핑',
        _tier: 4,
      }),
    ];
    expect(hasProductSpecialCancelPolicy(notices)).toBe(true);
    expect(shouldSuppressStandardCancelTable(notices)).toBe(true);
  });

  it('일반 RESERVATION만 — 표준 일수표 노출', () => {
    const notices = [notice({ type: 'RESERVATION', text: '출발 30일 전까지: 전액 환불' })];
    expect(shouldSuppressStandardCancelTable(notices)).toBe(false);
  });

  it('hasSpecialTermsBanner — AUTO_TICKETING 단독은 배너 미노출', () => {
    const notices = [notice({ type: 'AUTO_TICKETING', text: '실비 청구' })];
    expect(hasSpecialTermsBanner(notices)).toBe(false);
    expect(shouldSuppressStandardCancelTable(notices)).toBe(true);
  });

  it('hasSpecialTermsBanner — tier 4 상품 특약은 배너 노출', () => {
    const notices = [
      notice({ type: 'POLICY', title: '취소/환불/여권/쇼핑', text: '안내', _tier: 4 }),
    ];
    expect(hasSpecialTermsBanner(notices)).toBe(true);
  });
});

describe('filterNoticesForSurface — P2 A4·예약안내문·모바일 surface 분리', () => {
  const base = [
    notice({ type: 'AUTO_TICKETING', text: '발권 후 실비 100%', surfaces: ['mobile', 'booking_guide', 'a4'] }),
    notice({ type: 'RESERVATION', text: '출발 30일 전까지: 전액 환불', surfaces: ['a4', 'mobile', 'booking_guide'] }),
    notice({ type: 'PASSPORT', text: '6개월', surfaces: ['a4'] }),
  ];

  it('mobile — 특약 상품 RESERVATION 제거', () => {
    const r = filterNoticesForSurface(base, 'mobile');
    expect(r.some(n => n.type === 'RESERVATION')).toBe(false);
    expect(r.some(n => n.type === 'AUTO_TICKETING')).toBe(true);
  });

  it('booking_guide — mobile과 동일 억제', () => {
    const r = filterNoticesForSurface(base, 'booking_guide');
    expect(r.some(n => n.type === 'RESERVATION')).toBe(false);
  });

  it('a4 — RESERVATION·AUTO_TICKETING 모두 유지 (전문 참조)', () => {
    const r = filterNoticesForSurface(base, 'a4');
    expect(r.some(n => n.type === 'RESERVATION')).toBe(true);
    expect(r.some(n => n.type === 'AUTO_TICKETING')).toBe(true);
    expect(r.some(n => n.type === 'PASSPORT')).toBe(true);
  });

  it('surface 태그 없는 블록 — mobile·booking_guide 기본', () => {
    const r = filterNoticesForSurface(
      [notice({ type: 'PAYMENT', text: '잔금' })],
      'mobile',
    );
    expect(r).toHaveLength(1);
    expect(filterNoticesForSurface(
      [notice({ type: 'PAYMENT', text: '잔금' })],
      'a4',
    )).toHaveLength(0);
  });
});

describe('formatCancellationDates — 출발일 기준 날짜 자동 병기', () => {
  it('출발일 없으면 그대로', () => {
    const notices = [notice({ type: 'RESERVATION', text: '30일전 통보 시 위약금 10%' })];
    const r = formatCancellationDates(notices, null);
    expect(r).toBe(notices);
  });

  it('잘못된 출발일 → 그대로', () => {
    const notices = [notice({ type: 'RESERVATION', text: '30일전 통보 시 위약금 10%' })];
    const r = formatCancellationDates(notices, 'not-a-date');
    expect(r).toBe(notices);
  });

  it('RESERVATION type 에 "30일전" → 날짜 괄호 추가', () => {
    const notices = [notice({ type: 'RESERVATION', text: '30일전 통보 시 위약금 10%' })];
    const r = formatCancellationDates(notices, '2026-06-30');
    // 30일전 = 2026-05-31
    expect(r[0].text).toContain('30일전(2026.05.31까지)');
  });

  it('PAYMENT type 도 처리', () => {
    const notices = [notice({ type: 'PAYMENT', text: '15일전 잔금 입금' })];
    const r = formatCancellationDates(notices, '2026-06-30');
    // 15일전 = 2026-06-15
    expect(r[0].text).toContain('15일전(2026.06.15까지)');
  });

  it('다른 type 은 변경 없음', () => {
    const notices = [notice({ type: 'PASSPORT', text: '여권 30일전 발급' })];
    const r = formatCancellationDates(notices, '2026-06-30');
    expect(r[0].text).toBe('여권 30일전 발급'); // 변경 없음
  });

  it('"출발 30일전" 처럼 "출발" 접두사 → 스킵 (ERR-HSN-cancel-date-pollution)', () => {
    const notices = [notice({ type: 'RESERVATION', text: '출발 30일전 발권 기한' })];
    const r = formatCancellationDates(notices, '2026-06-30');
    // "출발" 뒤의 30일전 은 발권 기한 안내 — 날짜 주입 금지
    expect(r[0].text).toBe('출발 30일전 발권 기한');
  });

  it('기존 괄호 있으면 안쪽에 병합 (ERR-HET-cancel-date-pollution-double-paren)', () => {
    const notices = [notice({ type: 'RESERVATION', text: '45일전(~45)까지 통보시 무료' })];
    const r = formatCancellationDates(notices, '2026-06-30');
    // 45일전 = 2026-05-16
    // (~45) → (~45, 2026.05.16까지)
    expect(r[0].text).toContain('45일전(~45, 2026.05.16까지)까지 통보시 무료');
    // 절대 ")(~" 같은 괄호 중첩 없음
    expect(r[0].text).not.toMatch(/\)\s*\(/);
  });

  it('"365일전" 같은 큰 숫자도 처리', () => {
    const notices = [notice({ type: 'RESERVATION', text: '60일전 위약금 5%' })];
    const r = formatCancellationDates(notices, '2026-06-30');
    expect(r[0].text).toMatch(/60일전\(\d{4}\.\d{2}\.\d{2}까지\)/);
  });

  it('"500일전" 같은 비현실적 숫자 → 변경 없음 (sanity guard)', () => {
    const notices = [notice({ type: 'RESERVATION', text: '500일전 위약금 5%' })];
    const r = formatCancellationDates(notices, '2026-06-30');
    expect(r[0].text).toBe('500일전 위약금 5%');
  });

  it('변경 없는 notice 는 같은 객체 참조 유지 (메모리 효율)', () => {
    const original = notice({ type: 'PASSPORT', text: '여권 유효기간 6개월' });
    const r = formatCancellationDates([original], '2026-06-30');
    expect(r[0]).toBe(original);
  });

  it('한 텍스트 내 여러 "N일전" 모두 변환', () => {
    const notices = [notice({
      type: 'RESERVATION',
      text: '30일전 5%, 20일전 10%, 10일전 30%',
    })];
    const r = formatCancellationDates(notices, '2026-06-30');
    expect(r[0].text).toContain('30일전(2026.05.31까지)');
    expect(r[0].text).toContain('20일전(2026.06.10까지)');
    expect(r[0].text).toContain('10일전(2026.06.20까지)');
  });
});

describe('getSourceBadgeColor — tier 별 UI 컬러', () => {
  it('source 없거나 tier 1 → 회색', () => {
    expect(getSourceBadgeColor()).toBe('text-gray-400');
    expect(getSourceBadgeColor('플랫폼', 1)).toBe('text-gray-400');
  });

  it('tier 2 (랜드사 공통) → 파랑', () => {
    expect(getSourceBadgeColor('하나투어', 2)).toBe('text-blue-600');
  });

  it('tier 3 (랜드사 variant) → 보라', () => {
    expect(getSourceBadgeColor('하나투어 (효도)', 3)).toBe('text-purple-600');
  });

  it('tier 4 / "상품 특약" → 빨강 (가장 강조)', () => {
    expect(getSourceBadgeColor('상품 특약', 4)).toBe('text-red-600');
    expect(getSourceBadgeColor('상품 특약')).toBe('text-red-600');
  });
});

describe('NOTICE_DOT_COLOR / NOTICE_CARD_TONE — 표시 키 일관성', () => {
  it('필수 type 은 모두 도트 색상 정의', () => {
    const required = ['RESERVATION', 'PAYMENT', 'PASSPORT', 'LIABILITY', 'NOSHOW'];
    for (const t of required) {
      expect(NOTICE_DOT_COLOR[t]).toBeTruthy();
    }
  });

  it('NOTICE_CARD_TONE 키 = NOTICE_DOT_COLOR 키 (일관)', () => {
    const dotKeys = Object.keys(NOTICE_DOT_COLOR).sort();
    const toneKeys = Object.keys(NOTICE_CARD_TONE).sort();
    expect(toneKeys).toEqual(dotKeys);
  });

  it('각 카드 톤은 border + bg 두 필드 모두 존재', () => {
    for (const [, v] of Object.entries(NOTICE_CARD_TONE)) {
      expect(v.border).toMatch(/^border-l-/);
      expect(v.bg).toBeTruthy();
    }
  });
});
