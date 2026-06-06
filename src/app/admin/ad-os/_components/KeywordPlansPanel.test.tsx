import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { KeywordPlansPanel } from './KeywordPlansPanel';

describe('Ad OS KeywordPlansPanel', () => {
  it('renders keyword plans and candidate actions', () => {
    const html = renderToStaticMarkup(
      <KeywordPlansPanel
        loadingId="plan-1"
        onUpdate={vi.fn()}
        rows={[
          {
            id: 'plan-1',
            keyword_text: 'tokyo tour',
            platform: 'google',
            tier: 'priority',
            suggested_bid_krw: 1200,
            plan_status: 'candidate',
          },
        ]}
      />,
    );

    expect(html).toContain('Keyword plan samples');
    expect(html).toContain('/admin/search-ads');
    expect(html).toContain('tokyo tour');
    expect(html).toContain('priority');
    expect(html).toContain('Approve');
    expect(html).toContain('Archive');
  });

  it('renders empty state when no keyword plans exist', () => {
    const html = renderToStaticMarkup(
      <KeywordPlansPanel rows={[]} loadingId={null} onUpdate={vi.fn()} />,
    );

    expect(html).toContain('No keyword plans yet.');
  });
});
