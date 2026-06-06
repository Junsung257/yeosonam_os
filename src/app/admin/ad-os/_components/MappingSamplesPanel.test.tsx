import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MappingSamplesPanel } from './MappingSamplesPanel';

describe('Ad OS MappingSamplesPanel', () => {
  it('renders mapping samples and admin link', () => {
    const html = renderToStaticMarkup(
      <MappingSamplesPanel
        rows={[
          {
            id: 'mapping-1',
            keyword: 'jeju package',
            platform: 'naver',
            operational_status: 'candidate',
          },
        ]}
      />,
    );

    expect(html).toContain('Mapping samples');
    expect(html).toContain('/admin/blog/ads');
    expect(html).toContain('jeju package');
    expect(html).toContain('후보');
  });
});
