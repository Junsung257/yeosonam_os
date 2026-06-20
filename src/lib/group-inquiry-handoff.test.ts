import { describe, expect, it } from 'vitest';
import { buildConciergeHandoffHref, buildGroupInquiryHandoffHref } from './group-inquiry-handoff';

describe('handoff href builders', () => {
  it('carries package filter context into concierge', () => {
    const href = buildConciergeHandoffHref({
      source: 'packages',
      intent: 'filial_trip',
      partyType: 'senior_family',
      query: 'Da Nang family trip',
      destination: 'Da Nang',
      budget: 'under 1,000,000 KRW',
      selectedProducts: ['Package A', 'Package B'],
    });
    const url = new URL(href, 'https://example.com');

    expect(url.pathname).toBe('/concierge');
    expect(url.searchParams.get('source')).toBe('packages');
    expect(url.searchParams.get('intent')).toBe('filial_trip');
    expect(url.searchParams.get('party_type')).toBe('senior_family');
    expect(url.searchParams.get('query')).toBe('Da Nang family trip');
    expect(url.searchParams.get('destination')).toBe('Da Nang');
    expect(url.searchParams.get('budget')).toBe('under 1,000,000 KRW');
    expect(url.searchParams.get('selected_products')).toBe('Package A,Package B');
  });

  it('keeps group inquiry defaults for direct handoff', () => {
    const href = buildGroupInquiryHandoffHref({ source: 'concierge' });
    const url = new URL(href, 'https://example.com');

    expect(url.pathname).toBe('/group-inquiry');
    expect(url.searchParams.get('source')).toBe('concierge');
    expect(url.searchParams.get('intent')).toBe('group_trip');
    expect(url.searchParams.get('party_type')).toBe('group');
    expect(url.searchParams.get('selected_products')).toBeTruthy();
  });
});
