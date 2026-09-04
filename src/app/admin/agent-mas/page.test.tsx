import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AgentMasPage from './page';

describe('AgentMasPage', () => {
  it('renders the operating model and a visible loading state', () => {
    const html = renderToStaticMarkup(<AgentMasPage />);

    expect(html).toContain('AI 운영실');
    expect(html).toContain('실행은 백엔드에서');
    expect(html).toContain('AI 운영실 로딩 중');
  });

  it('keeps V1 observation-only until durable resume is connected', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/admin/agent-mas/page.tsx'),
      'utf8',
    );

    expect(source).toContain('관찰 전용 V1');
    expect(source).toContain('처리 잠금');
    expect(source).toContain('외부 조사 근거');
    expect(source).toContain('상품 사실 근거 불가');
    expect(source).toContain('snapshot.freshness.isStale');
    expect(source).toContain('OFFICE_AUTO_REFRESH_MS');
    expect(source).toContain('visibilitychange');
    expect(source).not.toContain("fetch(`/api/agent/approvals/");
  });
});
