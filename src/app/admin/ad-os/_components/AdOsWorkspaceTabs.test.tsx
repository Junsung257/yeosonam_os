import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdOsWorkspaceTabs, parseAdOsWorkspaceTab } from './AdOsWorkspaceTabs';

describe('AdOsWorkspaceTabs', () => {
  it('parses unknown tab values to the beginner run tab', () => {
    expect(parseAdOsWorkspaceTab(null)).toBe('run');
    expect(parseAdOsWorkspaceTab('advanced')).toBe('advanced');
    expect(parseAdOsWorkspaceTab('unknown')).toBe('run');
  });

  it('renders the four beginner workspace tabs', () => {
    const html = renderToStaticMarkup(
      <AdOsWorkspaceTabs activeTab="run" onTabChange={() => {}}>
        <div>content</div>
      </AdOsWorkspaceTabs>,
    );

    expect(html).toContain('바로 실행');
    expect(html).toContain('상세 설정');
    expect(html).toContain('성과/리포트');
    expect(html).toContain('고급/감사');
  });
});
