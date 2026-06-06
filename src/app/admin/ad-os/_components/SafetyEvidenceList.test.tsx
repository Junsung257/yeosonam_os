import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SafetyEvidenceList } from './SafetyEvidenceList';

describe('Ad OS SafetyEvidenceList', () => {
  it('renders empty evidence state', () => {
    const html = renderToStaticMarkup(<SafetyEvidenceList items={[]} empty="No evidence loaded." />);

    expect(html).toContain('No evidence loaded.');
  });

  it('renders evidence rows with status, link, and meta', () => {
    const html = renderToStaticMarkup(
      <SafetyEvidenceList
        items={[
          {
            id: 'surface',
            label: 'Admin surface',
            evidence: '/admin/ad-os · ready',
            nextAction: 'Open the surface',
            status: 'pass',
            tone: 'good',
            href: '/admin/ad-os',
            hrefLabel: '화면 보기',
            meta: 'ready / empty / error',
          },
        ]}
        empty="No evidence loaded."
      />,
    );

    expect(html).toContain('Admin surface');
    expect(html).toContain('/admin/ad-os · ready');
    expect(html).toContain('Open the surface');
    expect(html).toContain('pass');
    expect(html).toContain('href="/admin/ad-os"');
    expect(html).toContain('화면 보기');
    expect(html).toContain('ready / empty / error');
  });
});
