import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MetricGrid } from './MetricGrid';

describe('Ad OS MetricGrid', () => {
  it('renders metric labels, values, and configured responsive columns', () => {
    const html = renderToStaticMarkup(
      <MetricGrid
        columns="md:grid-cols-5"
        metrics={[
          { label: 'Score', value: '98%' },
          { label: 'Live spend', value: '0원' },
        ]}
      />,
    );

    expect(html).toContain('md:grid-cols-5');
    expect(html).toContain('Score');
    expect(html).toContain('98%');
    expect(html).toContain('Live spend');
    expect(html).toContain('0원');
  });
});
