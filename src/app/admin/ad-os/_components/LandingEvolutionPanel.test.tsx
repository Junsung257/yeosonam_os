import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LandingEvolutionPanel } from './LandingEvolutionPanel';

describe('Ad OS LandingEvolutionPanel', () => {
  it('renders landing evolution candidates and empty state', () => {
    const html = renderToStaticMarkup(
      <LandingEvolutionPanel
        count={1}
        rows={[
          {
            id: 'landing-1',
            action: 'rewrite_hero',
            status: 'candidate',
            reason: 'Scroll depth is low.',
          },
        ]}
      />,
    );

    expect(html).toContain('Blog landing evolution');
    expect(html).toContain('rewrite_hero');
    expect(html).toContain('candidate');
    expect(html).toContain('Scroll depth is low.');

    const empty = renderToStaticMarkup(<LandingEvolutionPanel count={0} rows={[]} />);
    expect(empty).toContain('No landing evolution candidates yet.');
  });
});
