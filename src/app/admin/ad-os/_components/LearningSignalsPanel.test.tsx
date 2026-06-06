import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LearningSignalsPanel } from './LearningSignalsPanel';

describe('Ad OS LearningSignalsPanel', () => {
  it('renders learning signals and empty state', () => {
    const html = renderToStaticMarkup(
      <LearningSignalsPanel
        count={1}
        rows={[
          {
            id: 'learn-1',
            signal_type: 'cta_drop',
            status: 'candidate',
            recommendation: 'Refresh the CTA copy.',
          },
        ]}
      />,
    );

    expect(html).toContain('Performance learning signals');
    expect(html).toContain('cta_drop');
    expect(html).toContain('candidate');
    expect(html).toContain('Refresh the CTA copy.');

    const empty = renderToStaticMarkup(<LearningSignalsPanel count={0} rows={[]} />);
    expect(empty).toContain('No learning signals yet.');
  });
});
