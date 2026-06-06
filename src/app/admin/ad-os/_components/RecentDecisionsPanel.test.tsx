import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RecentDecisionsPanel } from './RecentDecisionsPanel';

describe('Ad OS RecentDecisionsPanel', () => {
  it('renders recent decisions and empty state', () => {
    const html = renderToStaticMarkup(
      <RecentDecisionsPanel
        rows={[
          {
            id: 'decision-1',
            decision_type: 'budget_guardrail',
            applied: true,
            reason: 'Daily cap stayed within policy.',
          },
        ]}
      />,
    );

    expect(html).toContain('Recent decisions');
    expect(html).toContain('budget_guardrail');
    expect(html).toContain('Applied');
    expect(html).toContain('Daily cap stayed within policy.');

    const empty = renderToStaticMarkup(<RecentDecisionsPanel rows={[]} />);
    expect(empty).toContain('No recent automation decisions yet.');
  });
});
