import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NaverAssetPlanPanel } from './NaverAssetPlanPanel';

const plan = {
  summary: { inserted_change_requests: 1 },
  plan: {
    nextAction: 'Review generated mutation requests.',
    mutations: [
      {
        mutationType: 'create_ad_group',
        title: 'Create Seoul ad group',
        requestType: 'create',
      },
      {
        mutationType: 'pause_keyword',
        title: 'Pause waste keyword',
        requestType: 'pause',
      },
    ],
  },
};

describe('Ad OS NaverAssetPlanPanel', () => {
  it('renders asset plan mutations and next action', () => {
    const html = renderToStaticMarkup(<NaverAssetPlanPanel plan={plan} />);

    expect(html).toContain('Naver asset plan');
    expect(html).toContain('CR 1');
    expect(html).toContain('Create Seoul ad group');
    expect(html).toContain('Pause waste keyword');
    expect(html).toContain('guarded approval');
    expect(html).toContain('Review generated mutation requests.');
  });

  it('renders nothing before Naver asset plan data exists', () => {
    const html = renderToStaticMarkup(<NaverAssetPlanPanel plan={null} />);

    expect(html).toBe('');
  });
});
