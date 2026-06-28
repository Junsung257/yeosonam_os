import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AutomationCommandCenterCard } from './AutomationCommandCenterCard';

describe('AutomationCommandCenterCard', () => {
  it('renders a visible loading state before the command center snapshot arrives', () => {
    const html = renderToStaticMarkup(<AutomationCommandCenterCard />);

    expect(html).toContain('AI command center');
    expect(html).toContain('Loading automation command center snapshot.');
  });
});
