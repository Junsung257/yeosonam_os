import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductScenariosPanel } from './ProductScenariosPanel';

describe('Ad OS ProductScenariosPanel', () => {
  it('renders product scenarios and empty state', () => {
    const html = renderToStaticMarkup(
      <ProductScenariosPanel
        count={1}
        rows={[
          {
            id: 'scenario-1',
            scenario_type: 'family_package',
            status: 'candidate',
            funnel_stage: 'consideration',
            landing_strategy: 'comparison',
            recommended_channel: 'naver',
          },
        ]}
      />,
    );

    expect(html).toContain('Product scenarios');
    expect(html).toContain('family_package');
    expect(html).toContain('consideration');
    expect(html).toContain('comparison');
    expect(html).toContain('naver');

    const empty = renderToStaticMarkup(<ProductScenariosPanel count={0} rows={[]} />);
    expect(empty).toContain('No product scenarios yet.');
  });
});
