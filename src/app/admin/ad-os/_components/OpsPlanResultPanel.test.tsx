import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OpsPlanResultPanel } from './OpsPlanResultPanel';

const opsPlan = {
  inserted_change_requests: 2,
  publisher: {
    naver: { state: 'executable', defaultMutationMode: 'dry_run' },
    google: { state: 'integration_ready' },
  },
  measurement: { margin_roas_pct: 120 },
  keyword_mining: {
    candidates: [
      { keyword: 'jeju family tour', intent: 'family', bidKrw: 800 },
    ],
    duplicate_content_action: {
      action: 'dedupe',
      reason: 'Same landing page cluster.',
    },
  },
  tenant_packaging: { productReadinessLabel: 'ready' },
};

describe('Ad OS OpsPlanResultPanel', () => {
  it('renders ops plan metrics, candidates, and duplicate action', () => {
    const html = renderToStaticMarkup(<OpsPlanResultPanel opsPlan={opsPlan} />);

    expect(html).toContain('Ops plan result');
    expect(html).toContain('CR 2');
    expect(html).toContain('executable');
    expect(html).toContain('120%');
    expect(html).toContain('jeju family tour');
    expect(html).toContain('dedupe');
    expect(html).toContain('Same landing page cluster.');
  });

  it('renders nothing before ops plan data exists', () => {
    const html = renderToStaticMarkup(<OpsPlanResultPanel opsPlan={null} />);

    expect(html).toBe('');
  });
});
