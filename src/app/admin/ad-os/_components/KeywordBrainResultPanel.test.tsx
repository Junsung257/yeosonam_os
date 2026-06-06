import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KeywordBrainResultPanel } from './KeywordBrainResultPanel';

const result = {
  summary: { candidates: 2 },
  candidates: [
    {
      keyword: 'tokyo private tour',
      matchType: 'phrase',
      intent: 'premium',
      tier: 'priority',
      score: 82,
      suggestedBidKrw: 1200,
    },
    {
      keyword: 'cheap bad fit',
      matchType: 'negative',
      intent: 'blocked',
      tier: 'negative',
      score: 10,
      suggestedBidKrw: 0,
    },
  ],
};

describe('Ad OS KeywordBrainResultPanel', () => {
  it('renders keyword brain candidates with bid and tier labels', () => {
    const html = renderToStaticMarkup(<KeywordBrainResultPanel result={result} />);

    expect(html).toContain('Keyword Brain result');
    expect(html).toContain('2 candidates');
    expect(html).toContain('tokyo private tour');
    expect(html).toContain('premium');
    expect(html).toContain('phrase');
    expect(html).toContain('cheap bad fit');
    expect(html).toContain('negative');
  });

  it('renders nothing before keyword brain data exists', () => {
    const html = renderToStaticMarkup(<KeywordBrainResultPanel result={null} />);

    expect(html).toBe('');
  });
});
