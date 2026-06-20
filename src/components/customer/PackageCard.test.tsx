import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PackageCard from './PackageCard';

describe('PackageCard', () => {
  it('renders the package decision hierarchy for discovery cards', () => {
    const html = renderToStaticMarkup(
      <PackageCard
        pkg={{
          id: 'sample-danang-family',
          title: '부산 출발 다낭 가족여행 3박5일',
          destination: '다낭',
          duration: 5,
          nights: 3,
          price: 699000,
          product_type: '실속|가족',
          departure_airport: '부산',
          airline: '진에어',
          avg_rating: 4.8,
          review_count: 18,
          seats_held: 20,
          seats_confirmed: 8,
          price_dates: [
            { date: '2026-08-15', price: 699000, confirmed: true },
            { date: '2026-09-12', price: 729000 },
          ],
          product_highlights: ['노쇼핑', '가족 추천'],
        }}
      />,
    );

    expect(html).toContain('data-testid="package-card-hierarchy"');
    expect(html).toContain('다낭');
    expect(html).toContain('실속');
    expect(html).toContain('8/15(토) 출발');
    expect(html).toContain('3박5일');
    expect(html).toContain('부산 출발');
    expect(html).toContain('진에어');
    expect(html).toContain('699,000');
    expect(html).toContain('후기 4.8');
    expect(html).toContain('출발일 2개');
    expect(html).toContain('확정 1회');
  });
});
