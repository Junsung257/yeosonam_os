import { describe, expect, it } from 'vitest';
import { buildCanonicalRevenueOffer } from './canonical-revenue-offer';

const now = new Date('2026-07-29T12:00:00.000Z');

describe('canonical revenue offer', () => {
  it('allows only a source-backed, fresh, confirmed Busan offer', () => {
    const offer = buildCanonicalRevenueOffer({
      id: '11111111-1111-4111-8111-111111111111',
      short_code: 'PUS-TEST-01',
      title: '부산출발 검증 상품',
      destination: '후쿠오카',
      trip_style: '2박 3일',
      return_date: '2026-08-03',
      price_dates: [{ date: '2026-08-01', price: 749000, confirmed: true }],
      price_checked_at: '2026-07-29T08:00:00.000Z',
      inventory_status: 'reconfirm_required',
      inventory_checked_at: '2026-07-29T08:00:00.000Z',
      airline: 'BX',
      hotel: '검증 호텔',
      inclusions: ['왕복 항공'],
      excludes: ['개인 경비'],
      cancellation_policy: { summary: '출발일 기준 취소 수수료 적용' },
      raw_text_hash: 'sha256:evidence',
      expected_contribution_margin: 70000,
      publication_state: 'approved',
      products: { departure_region: '부산', supplier_code: 'SUPPLIER-1' },
    }, { now });

    expect(offer.readyForPublication).toBe(true);
    expect(offer.blockers).toEqual([]);
  });

  it('blocks the current Hokkaido candidate without inventing price or seats', () => {
    const offer = buildCanonicalRevenueOffer({
      id: 'efcfd933-4561-4db0-9a35-062b724cf287',
      short_code: 'ETC-CTS-03-02',
      title: '북해도 알짜팩 2박3일',
      destination: '북해도',
      price_dates: [{ date: '2026-09-01', price: 749000, confirmed: false }],
      seats_held: 0,
      seats_confirmed: 0,
      inclusions: ['공급사 원문 포함사항'],
      excludes: ['공급사 원문 불포함사항'],
      cancellation_policy: { summary: '공급사 취소조건 원문 존재' },
      raw_text_hash: 'sha256:captured',
      publication_state: 'blocked',
      products: { departure_region: '부산', supplier_code: 'ETC' },
    }, { now });

    expect(offer.readyForPublication).toBe(false);
    expect(offer.blockers).toEqual(expect.arrayContaining([
      'return_date_missing',
      'confirmed_price_missing',
      'price_evidence_stale_or_missing',
      'inventory_unavailable_or_unknown',
      'inventory_evidence_stale_or_missing',
      'contribution_margin_missing',
      'publication_not_approved',
    ]));
  });
});
