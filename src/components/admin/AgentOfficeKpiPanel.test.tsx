import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import AgentOfficeKpiPanel from './AgentOfficeKpiPanel';

describe('AgentOfficeKpiPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders a clear authority boundary before the aggregate RPC is available', () => {
    const html = renderToStaticMarkup(<AgentOfficeKpiPanel />);
    expect(html).toContain('기간 KPI');
    expect(html).toContain('Shadow Run은 포함하지 않습니다');
    expect(html).toContain('기간 KPI 로딩 중');
  });

  it('keeps the aggregate refresh visible and tab-aware', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/admin/AgentOfficeKpiPanel.tsx'),
      'utf8',
    );
    expect(source).toContain('KPI_AUTO_REFRESH_MS');
    expect(source).toContain('visibilitychange');
  });
});
