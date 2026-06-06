import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MappingStatusDistributionPanel } from './MappingStatusDistributionPanel';

describe('Ad OS MappingStatusDistributionPanel', () => {
  it('renders mapping status rows with progress widths', () => {
    const html = renderToStaticMarkup(
      <MappingStatusDistributionPanel
        mappingsByStatus={{ candidate: 3, active: 1 }}
        total={4}
      />,
    );

    expect(html).toContain('Mapping status distribution');
    expect(html).toContain('후보');
    expect(html).toContain('집행');
    expect(html).toContain('75%');
    expect(html).toContain('25%');
  });
});
